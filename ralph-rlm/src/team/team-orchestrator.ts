import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, writeFile, readFile } from 'node:fs/promises';
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

const execAsync = promisify(exec);

interface AgentSlot {
  featureId: string;
  description: string;
  worktree: Worktree;
}

export class TeamOrchestrator {
  private readonly featureListPath: string;
  private readonly progressPath: string;
  private readonly worktreeManager: WorktreeManager;

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
      const featureIds = level.featureIds.slice(0, this.config.teammates);

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
      `WORKFLOW: 1) Read ${implPromptPath} for coding guidelines ONLY (IGNORE any instructions about finding, selecting, or cycling through features — your feature is already assigned). 2) Read claude-progress.txt for codebase patterns. 3) Implement ONLY ${slot.featureId}. 4) Run tests. 5) If tests pass: git add . && git commit -m "feat: ${slot.featureId} - ${slot.description}", then EXIT. 6) If tests fail: log the error and EXIT.`,
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
      const { stdout } = await execAsync('git status --porcelain', { cwd: slot.worktree.path });
      if (stdout.trim()) {
        await execAsync('git add .', { cwd: slot.worktree.path });
        await execAsync(`git commit -m "feat: ${slot.featureId} - ${slot.description}"`, { cwd: slot.worktree.path });
      }
    } catch { /* may fail if nothing to commit */ }

    // Sync framework files in worktree to match main repo.
    // Both branches modify feature_list.json (framework updates status, agent updates status).
    // Overwrite the worktree's version with main repo's to prevent merge conflicts.
    // The framework is the source of truth for feature_list.json.
    await this.syncFrameworkFilesToWorktree(slot.worktree);

    // Commit framework state changes (feature_list.json, progress) before merge
    // Git refuses to merge when tracked files have uncommitted changes
    await this.commitFrameworkState('pre-merge state update');

    // Merge worktree branch into main
    const mergeResult = await this.worktreeManager.merge(slot.worktree, this.cwd);

    if (!mergeResult.success) {
      if (mergeResult.conflicted) {
        logger.warning(`Merge conflict for ${slot.featureId} — will retry next iteration`);
        await progressLog.append(this.progressPath, `MERGE CONFLICT: ${slot.featureId} — deferred to next iteration`);
      } else {
        logger.warning(`Merge failed for ${slot.featureId}: ${mergeResult.error}`);
      }
      logger.teamMerge(slot.featureId, false);
      await this.revertFeature(slot.featureId);
      return;
    }

    logger.teamMerge(slot.featureId, true);

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
        await execAsync(cmd, { cwd: this.cwd, timeout: 120_000 });
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

  private async syncFrameworkFilesToWorktree(worktree: Worktree): Promise<void> {
    try {
      // Copy main repo's feature_list.json and progress file into worktree
      // and commit the change so the worktree branch matches main on these files
      const mainFeatureList = await readFile(this.featureListPath, 'utf-8');
      await writeFile(path.join(worktree.path, FEATURE_LIST_FILE), mainFeatureList, 'utf-8');

      try {
        const mainProgress = await readFile(this.progressPath, 'utf-8');
        await writeFile(path.join(worktree.path, PROGRESS_FILE), mainProgress, 'utf-8');
      } catch { /* progress file may not exist */ }

      await execAsync(`git add ${FEATURE_LIST_FILE} ${PROGRESS_FILE}`, { cwd: worktree.path });
      const { stdout } = await execAsync('git status --porcelain', { cwd: worktree.path });
      if (stdout.trim()) {
        await execAsync('git commit -m "chore: sync framework files with main"', { cwd: worktree.path });
      }
    } catch {
      logger.warning(`Failed to sync framework files to worktree ${worktree.name}`);
    }
  }

  private async commitFrameworkState(message: string): Promise<void> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.cwd });
      if (stdout.trim()) {
        await execAsync('git add .', { cwd: this.cwd });
        await execAsync(`git commit -m "chore: ${message}"`, { cwd: this.cwd });
      }
    } catch { /* may fail if nothing to commit */ }
  }

  private async finalCommit(): Promise<void> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.cwd });
      if (stdout.trim()) {
        await execAsync('git add .', { cwd: this.cwd });
        await execAsync('git commit -m "feat: all features complete — final commit"', { cwd: this.cwd });
        logger.success('Final commit created');
        await progressLog.append(this.progressPath, 'ALL FEATURES COMPLETE — final commit');
      }
    } catch { /* ignore */ }
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
