import { copyFile, writeFile, readFile, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Runner, RalphConfig, FeatureList } from '../config/types.js';
import { FEATURE_LIST_FILE, PROGRESS_FILE } from '../config/defaults.js';
import { runPreflight } from '../core/preflight.js';
import * as featureStore from '../core/feature-store.js';
import { recalculateStats } from '../core/stats.js';
import * as progressLog from '../core/progress-log.js';
import * as logger from '../ui/logger.js';
import { buildExecutionPlan } from './dependency-graph.js';
import type { WorktreeManager, Worktree } from './worktree-manager.js';
import { WorktreeManagerImpl } from './worktree-manager.js';
import { gitExec, sanitizeCommitMessage, safeExecCommand } from '../core/safe-exec.js';

interface AgentSlot {
  featureId: string;
  description: string;
  worktree: Worktree;
}

export class TeamOrchestrator {
  private readonly featureListPath: string;
  private readonly progressPath: string;
  private readonly worktreeManager: WorktreeManager;
  /** Track features that have conflicted multiple times — serialize them next iteration */
  private conflictCounts = new Map<string, number>();

  constructor(
    private readonly runner: Runner,
    private readonly config: RalphConfig,
    private readonly promptsDir: string,
    private readonly cwd: string,
    worktreeManager?: WorktreeManager,
  ) {
    this.featureListPath = path.join(cwd, FEATURE_LIST_FILE);
    this.progressPath = path.join(cwd, PROGRESS_FILE);
    this.worktreeManager = worktreeManager ?? new WorktreeManagerImpl();
  }

  async run(): Promise<number> {
    logger.phase('PHASE 3: IMPLEMENT FEATURES (TEAM MODE)');
    logger.info(`Team mode: up to ${this.config.teammates} parallel agents`);

    if (!(await runPreflight('run', this.config.runner, this.promptsDir, this.cwd))) {
      return 1;
    }

    // Clean up orphaned worktrees from previous crashed runs
    await this.worktreeManager.cleanupAll(this.cwd);

    // Ensure framework files (.ralph/, .claude/) are tracked in the main repo.
    // Worktree branches commit these files; if they're untracked in main,
    // git merge refuses with "untracked working tree files would be overwritten".
    await this.ensureFrameworkFilesTracked();

    // Register graceful shutdown handler
    const shutdownHandler = async () => {
      logger.warning('Shutting down — cleaning up worktrees...');
      await this.worktreeManager.cleanupAll(this.cwd);
      process.exit(1);
    };
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

    try {
      return await this.runLoop();
    } finally {
      process.removeListener('SIGINT', shutdownHandler);
      process.removeListener('SIGTERM', shutdownHandler);
    }
  }

  private async runLoop(): Promise<number> {
    // Pre-loop check
    const initial = await featureStore.read(this.featureListPath);
    const initialRemaining = this.remaining(initial);
    const initialBlocked = this.blockedCount(initial);

    if (initialRemaining === 0) {
      if (initialBlocked > 0) {
        logger.warning(`No pending features, but ${initialBlocked} feature(s) are blocked`);
        return 2;
      }
      logger.success('All features are already complete! Nothing to do.');
      return 0;
    }

    logger.info(`${initialRemaining} feature(s) remaining to implement`);

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      logger.info(`--- Team Iteration ${iteration + 1} of ${this.config.maxIterations} ---`);

      const data = await featureStore.read(this.featureListPath);
      const plan = buildExecutionPlan(data.features);

      if (plan.hasCycles) {
        logger.warning(`Dependency cycles detected in: ${plan.cyclicFeatureIds.join(', ')}`);
        await progressLog.append(this.progressPath, `CYCLES: ${plan.cyclicFeatureIds.join(', ')} — excluded from execution`);
      }

      if (plan.levels.length === 0) {
        break;
      }

      // Process one level per iteration
      const level = plan.levels[0]!;
      let featureIds = level.featureIds.slice(0, this.config.teammates);

      // Serialize repeat-conflict features: if a feature has conflicted 2+ times,
      // run it solo in the next iteration to avoid repeated conflicts.
      const repeatConflicts = featureIds.filter(id => (this.conflictCounts.get(id) ?? 0) >= 2);
      if (repeatConflicts.length > 0 && featureIds.length > 1) {
        featureIds = [repeatConflicts[0]!];
        logger.info(`Serializing ${featureIds[0]} (conflicted ${this.conflictCounts.get(featureIds[0]!)} times)`);
      }

      logger.teamLevel(level.level, featureIds);

      const results = await this.dispatchBatch(data, featureIds);

      // Merge results sequentially
      for (const result of results) {
        if (result.completed) {
          await this.mergeAndVerify(result);
        } else {
          await this.handleFailure(result);
        }
      }

      // Cleanup all worktrees from this batch
      for (const result of results) {
        await this.worktreeManager.cleanup(result.slot.worktree, this.cwd);
      }

      // Recalculate and check completion
      const afterData = await featureStore.read(this.featureListPath);
      recalculateStats(afterData);
      await featureStore.write(this.featureListPath, afterData);

      const remaining = this.remaining(afterData);
      const blocked = this.blockedCount(afterData);
      const complete = afterData.stats.complete;
      const total = afterData.features.length;

      if (remaining === 0 && blocked === 0) {
        logger.success(`ALL FEATURES COMPLETE! (${complete}/${total})`);
        await this.finalCommit();
        return 0;
      }

      if (remaining === 0 && blocked > 0) {
        logger.warning(`BLOCKED - Human intervention needed. ${complete}/${total} complete, ${blocked} blocked`);
        return 2;
      }

      logger.info(`Progress: ${complete}/${total} complete, ${remaining} remaining`);

      if (this.config.sleepBetween > 0 && iteration < this.config.maxIterations - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.sleepBetween * 1000));
      }
    }

    logger.warning(`Max iterations reached (${this.config.maxIterations})`);
    return 1;
  }

  private async dispatchBatch(data: FeatureList, featureIds: string[]): Promise<BatchResult[]> {
    const slots: AgentSlot[] = [];

    // Create worktrees and prepare feature lists
    for (const featureId of featureIds) {
      try {
        const feature = featureStore.findById(data, featureId);
        if (!feature) continue;

        // Set feature to in_progress in main repo
        if (feature.status === 'pending') {
          feature.status = 'in_progress';
          recalculateStats(data);
          await featureStore.write(this.featureListPath, data);
        }

        const worktree = await this.worktreeManager.create(featureId, this.cwd);

        // Copy feature_list.json into worktree with only the assigned feature visible
        await this.prepareWorktreeFeatureList(worktree, data, featureId);

        // Copy progress file if it exists
        try {
          await copyFile(this.progressPath, path.join(worktree.path, PROGRESS_FILE));
        } catch { /* progress file may not exist yet */ }

        // Copy .ralph/prompts/ into worktree if not already there
        await this.copyPromptsToWorktree(worktree);

        slots.push({
          featureId,
          description: feature.description,
          worktree,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warning(`Failed to create worktree for ${featureId}: ${msg}`);
      }
    }

    if (slots.length === 0) {
      return [];
    }

    // Spawn agents in parallel
    const implPromptPath = path.join(this.promptsDir, 'implementer.md');
    const promises = slots.map(async (slot): Promise<BatchResult> => {
      const prompt = this.buildPrompt(slot, implPromptPath);

      logger.feature(slot.featureId, slot.description, {
        complete: data.features.filter(f => f.status === 'complete').length,
        total: data.features.length,
      });

      await this.runner.invoke(prompt, {
        verbose: this.config.verbose,
        debug: this.config.debug,
        dangerouslySkipPermissions: this.config.dangerouslySkipPermissions,
        stream: this.config.stream,
        cwd: slot.worktree.path,
      });

      // Check if agent completed the feature
      const completed = await this.checkCompletion(slot);
      return { slot, completed };
    });

    const settled = await Promise.allSettled(promises);
    return settled.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      return { slot: slots[i]!, completed: false };
    });
  }

  private async prepareWorktreeFeatureList(
    worktree: Worktree,
    data: FeatureList,
    featureId: string,
  ): Promise<void> {
    // Structural guard: only show the assigned feature (same pattern as single loop)
    const filtered: FeatureList = {
      ...data,
      features: data.features.filter(
        f => f.id === featureId || f.status === 'complete' || f.status === 'blocked',
      ),
    };
    recalculateStats(filtered);
    const wtFeatureListPath = path.join(worktree.path, FEATURE_LIST_FILE);
    await writeFile(wtFeatureListPath, JSON.stringify(filtered, null, 2), 'utf-8');
  }

  private buildPrompt(slot: AgentSlot, implPromptPath: string): string {
    return [
      `CRITICAL CONSTRAINT: You are assigned EXACTLY ONE feature. After completing it you MUST exit immediately. Do NOT look for or implement any other features.`,
      `YOUR ASSIGNED FEATURE: ${slot.featureId} — ${slot.description}.`,
      `WORKFLOW: 1) Read ${implPromptPath} for coding guidelines (if not accessible, follow steps below). 2) Read claude-progress.txt for codebase patterns. 3) Implement ONLY ${slot.featureId}. 4) Run quality gates (build + test commands from feature_list.json config). 5) If tests pass: update feature status with: npx ralph skill update-feature-status --id ${slot.featureId} --status complete, then git add . && git commit -m 'feat: ${slot.featureId} - ${slot.description}', then EXIT. 6) If tests fail: log the error and EXIT.`,
      `MANDATORY: After tests pass you MUST run the skill command above to mark ${slot.featureId} as complete in feature_list.json BEFORE committing. Never edit feature_list.json directly.`,
      `AFTER COMMITTING ${slot.featureId} YOU MUST EXIT IMMEDIATELY. The framework manages feature sequencing — it will start a new session for the next feature. Implementing more than one feature per session will cause errors.`,
    ].join(' ');
  }

  private async checkCompletion(slot: AgentSlot): Promise<boolean> {
    try {
      const wtFeatureListPath = path.join(slot.worktree.path, FEATURE_LIST_FILE);
      const raw = await readFile(wtFeatureListPath, 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      const feature = fl.features.find(f => f.id === slot.featureId);
      return feature?.status === 'complete';
    } catch {
      return false;
    }
  }

  private async mergeAndVerify(result: BatchResult): Promise<void> {
    const { slot } = result;

    // Ensure the worktree has committed changes
    try {
      const { stdout } = await gitExec(['status', '--porcelain'], slot.worktree.path);
      if (stdout.trim()) {
        await gitExec(['add', '.'], slot.worktree.path);
        const msg = sanitizeCommitMessage(`feat: ${slot.featureId} - ${slot.description}`);
        await gitExec(['commit', '-m', msg], slot.worktree.path);
      }
    } catch { /* may fail if nothing to commit */ }

    // Sync framework files in worktree to match main repo.
    await this.syncFrameworkFilesToWorktree(slot.worktree);

    // Commit framework state changes before merge
    await this.commitFrameworkState('pre-merge state update');

    // Merge worktree branch into main (with rebase fallback)
    const mergeResult = await this.worktreeManager.merge(slot.worktree, this.cwd);

    if (!mergeResult.success) {
      if (mergeResult.conflicted) {
        // Track conflict count for serialization logic
        const count = (this.conflictCounts.get(slot.featureId) ?? 0) + 1;
        this.conflictCounts.set(slot.featureId, count);
        logger.warning(`Merge conflict for ${slot.featureId} — will retry next iteration`);
        await progressLog.append(this.progressPath, `MERGE CONFLICT: ${slot.featureId} — deferred to next iteration (conflict #${count})`);
      } else {
        logger.warning(`Merge failed for ${slot.featureId}: ${mergeResult.error}`);
      }
      logger.teamMerge(slot.featureId, false);
      await this.revertFeature(slot.featureId);
      return;
    }

    logger.teamMerge(slot.featureId, true);
    // Clear conflict count on successful merge
    this.conflictCounts.delete(slot.featureId);

    // Verify build + tests after merge
    const verified = await this.verify(slot.featureId);
    if (!verified) {
      logger.warning(`Verification failed after merge for ${slot.featureId} — reverting`);
      await (this.worktreeManager as WorktreeManagerImpl).revertLastMerge(this.cwd);
      await this.revertFeature(slot.featureId);
      return;
    }

    // Update feature status in main repo
    const data = await featureStore.read(this.featureListPath);
    const feature = featureStore.findById(data, slot.featureId);
    if (feature) {
      feature.status = 'complete';
      recalculateStats(data);
      await featureStore.write(this.featureListPath, data);
    }

    logger.success(`${slot.featureId} merged and verified`);
    await progressLog.append(this.progressPath, `VERIFIED: ${slot.featureId} — merged, build and tests pass`);
  }

  private async verify(featureId: string): Promise<boolean> {
    const data = await featureStore.read(this.featureListPath);
    const { build_command, test_command } = data.config;

    if (!build_command && !test_command) return true;

    const commands = [build_command, test_command].filter((c): c is string => !!c);

    for (const cmd of commands) {
      try {
        await safeExecCommand(cmd, this.cwd, { timeout: 120_000 });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warning(`Verification failed for ${featureId}: ${cmd}`);
        await progressLog.append(this.progressPath, `VERIFICATION FAILED: ${featureId} — ${cmd}: ${errorMsg}`);
        return false;
      }
    }

    return true;
  }

  private async handleFailure(result: BatchResult): Promise<void> {
    const { slot } = result;
    const data = await featureStore.read(this.featureListPath);
    const feature = featureStore.findById(data, slot.featureId);

    if (feature && feature.status === 'in_progress') {
      feature.attempts++;
      if (feature.attempts >= data.config.max_attempts_per_feature) {
        feature.status = 'blocked';
        feature.last_error = `Max attempts (${data.config.max_attempts_per_feature}) reached`;
        logger.warning(`${slot.featureId} blocked after ${feature.attempts} attempts`);
      }
      recalculateStats(data);
      await featureStore.write(this.featureListPath, data);
    }

    await progressLog.append(this.progressPath, `${slot.featureId} — agent did not complete feature`);
  }

  private async revertFeature(featureId: string): Promise<void> {
    try {
      const data = await featureStore.read(this.featureListPath);
      const feature = featureStore.findById(data, featureId);
      if (feature) {
        feature.status = 'in_progress';
        feature.attempts++;
        feature.last_error = 'Merge or verification failed';
        if (feature.attempts >= data.config.max_attempts_per_feature) {
          feature.status = 'blocked';
          feature.last_error = `Max attempts (${data.config.max_attempts_per_feature}) reached after merge/verification failure`;
        }
        recalculateStats(data);
        await featureStore.write(this.featureListPath, data);
      }
    } catch { /* ignore */ }
  }

  private async copyPromptsToWorktree(worktree: Worktree): Promise<void> {
    const srcPrompts = path.join(this.cwd, '.ralph', 'prompts');
    const destPrompts = path.join(worktree.path, '.ralph', 'prompts');
    if (existsSync(srcPrompts) && !existsSync(destPrompts)) {
      await mkdir(path.join(worktree.path, '.ralph', 'prompts'), { recursive: true });
      await cp(srcPrompts, destPrompts, { recursive: true });
    }
  }

  private async syncFrameworkFilesToWorktree(worktree: Worktree): Promise<void> {
    try {
      const mainFeatureList = await readFile(this.featureListPath, 'utf-8');
      await writeFile(path.join(worktree.path, FEATURE_LIST_FILE), mainFeatureList, 'utf-8');

      try {
        const mainProgress = await readFile(this.progressPath, 'utf-8');
        await writeFile(path.join(worktree.path, PROGRESS_FILE), mainProgress, 'utf-8');
      } catch { /* progress file may not exist */ }

      await gitExec(['add', FEATURE_LIST_FILE, PROGRESS_FILE], worktree.path);
      const { stdout } = await gitExec(['status', '--porcelain'], worktree.path);
      if (stdout.trim()) {
        await gitExec(['commit', '-m', 'chore: sync framework files with main'], worktree.path);
      }
    } catch {
      logger.warning(`Failed to sync framework files to worktree ${worktree.name}`);
    }
  }

  private async commitFrameworkState(message: string): Promise<void> {
    try {
      const { stdout } = await gitExec(['status', '--porcelain'], this.cwd);
      if (stdout.trim()) {
        await gitExec(['add', FEATURE_LIST_FILE, PROGRESS_FILE], this.cwd);
        await gitExec(['commit', '-m', sanitizeCommitMessage(`chore: ${message}`)], this.cwd);
      }
    } catch { /* may fail if nothing to commit */ }
  }

  private async finalCommit(): Promise<void> {
    try {
      const { stdout } = await gitExec(['status', '--porcelain'], this.cwd);
      if (stdout.trim()) {
        await gitExec(['add', FEATURE_LIST_FILE, PROGRESS_FILE], this.cwd);
        await gitExec(['commit', '-m', 'feat: all features complete — final commit'], this.cwd);
        logger.success('Final commit created');
        await progressLog.append(this.progressPath, 'ALL FEATURES COMPLETE — final commit');
      }
    } catch { /* ignore */ }
  }

  /**
   * Commits untracked framework directories so worktree merges don't fail.
   * Without this, files like .ralph/prompts/*.md are untracked in main but
   * committed in worktree branches, causing "untracked working tree files
   * would be overwritten by merge" errors on every merge attempt.
   */
  private async ensureFrameworkFilesTracked(): Promise<void> {
    const dirs = ['.ralph/', '.claude/'];
    const toAdd: string[] = [];

    for (const dir of dirs) {
      if (existsSync(path.join(this.cwd, dir))) {
        toAdd.push(dir);
      }
    }

    if (toAdd.length === 0) return;

    try {
      await gitExec(['add', ...toAdd], this.cwd);
      const { stdout } = await gitExec(['status', '--porcelain'], this.cwd);
      if (stdout.trim()) {
        await gitExec(
          ['commit', '-m', 'chore: track framework files for team mode'],
          this.cwd,
        );
        logger.info('Committed framework files (.ralph/, .claude/) for clean merges');
      }
    } catch {
      // May fail if already tracked or nothing to commit — safe to ignore
    }
  }

  private remaining(data: FeatureList): number {
    return data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
  }

  private blockedCount(data: FeatureList): number {
    return data.features.filter(f => f.status === 'blocked').length;
  }
}

interface BatchResult {
  slot: AgentSlot;
  completed: boolean;
}
