import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Runner, RalphConfig, FeatureList } from '../config/types.js';
import { FEATURE_LIST_FILE, PROGRESS_FILE, RALPH_DIR, RALPH_FEATURES_DIR } from '../config/defaults.js';
import { runPreflight } from '../core/preflight.js';
import * as featureStore from '../core/feature-store.js';
import { recalculateStats } from '../core/stats.js';
import * as progressLog from '../core/progress-log.js';
import * as logger from '../ui/logger.js';
import { buildExecutionPlan } from './dependency-graph.js';
import type { WorktreeManager, Worktree } from './worktree-manager.js';
import { WorktreeManagerImpl } from './worktree-manager.js';
import { gitExec, sanitizeCommitMessage } from '../core/safe-exec.js';
import { runFeatureHarness, type FeatureHarnessResult } from '../core/harness-runner.js';
import {
  copyFeatureHarness,
  getFeatureHarnessPaths,
  writePostMergeVerificationReport,
} from '../core/feature-harness.js';
import {
  appendRuntimeEvent,
  beginRuntimeSession,
  setRuntimeSessionState,
  updateRuntimeFeatureState,
} from '../core/runtime-state.js';
import { runVerificationCommands, type VerificationResult } from '../core/verification.js';

interface AgentSlot {
  featureId: string;
  description: string;
  worktree: Worktree;
}

interface BatchResult {
  slot: AgentSlot;
  harnessResult: FeatureHarnessResult;
}

export class TeamOrchestrator {
  private readonly featureListPath: string;
  private readonly progressPath: string;
  private readonly worktreeManager: WorktreeManager;
  private conflictCounts = new Map<string, number>();
  private runtimeRunId = '';

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
    logger.phase('IMPLEMENT FEATURES (TEAM HARNESS)');
    logger.info(`Team mode: up to ${this.config.teammates} parallel feature harnesses`);

    const runtimeSession = await beginRuntimeSession(this.cwd, 'team');
    this.runtimeRunId = runtimeSession.run_id;
    await setRuntimeSessionState(this.cwd, {
      phase: 'preflight',
      summary: 'Running preflight checks for team harness.',
    });

    if (!(await runPreflight('run', this.config.runner, this.promptsDir, this.cwd))) {
      await setRuntimeSessionState(this.cwd, {
        status: 'failed',
        phase: 'preflight',
        summary: 'Preflight checks failed for team harness.',
        lessons: ['Preflight must pass before team execution can continue.'],
      });
      await this.recordRuntimeEvent('session_finished', 'preflight', 'Preflight checks failed for team harness.');
      return 1;
    }

    await this.worktreeManager.cleanupAll(this.cwd);
    await this.ensureFrameworkFilesTracked();

    const shutdownHandler = async () => {
      logger.warning('Shutting down — cleaning up worktrees...');
      await setRuntimeSessionState(this.cwd, {
        status: 'interrupted',
        phase: 'cleanup',
        summary: 'Team harness interrupted by signal.',
        lessons: ['Team harness interrupted before completion.'],
      });
      await this.recordRuntimeEvent('session_interrupted', 'cleanup', 'Team harness interrupted by signal.');
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
    const initial = await featureStore.read(this.featureListPath);
    const initialRemaining = this.remaining(initial);
    const initialBlocked = this.blockedCount(initial);

    if (initialRemaining === 0) {
      if (initialBlocked > 0) {
        logger.warning(`No pending features, but ${initialBlocked} feature(s) are blocked`);
        await setRuntimeSessionState(this.cwd, {
          status: 'blocked',
          phase: 'complete',
          summary: `${initialBlocked} blocked feature(s) remain and no ready team work is available.`,
          lessons: ['Blocked features require human intervention before team execution can resume.'],
        });
        await this.recordRuntimeEvent('session_finished', 'complete', `${initialBlocked} blocked feature(s) remain and no ready team work is available.`);
        return 2;
      }
      logger.success('All features are already complete! Nothing to do.');
      await setRuntimeSessionState(this.cwd, {
        status: 'completed',
        phase: 'complete',
        summary: 'All features were already complete before the team harness started.',
      });
      await this.recordRuntimeEvent('session_finished', 'complete', 'All features were already complete before the team harness started.');
      return 0;
    }

    logger.info(`${initialRemaining} feature(s) remaining to implement`);

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      logger.info(`--- Team Iteration ${iteration + 1} of ${this.config.maxIterations} ---`);

      const data = await featureStore.read(this.featureListPath);
      const plan = buildExecutionPlan(data.features);

      if (plan.hasCycles) {
        logger.warning(`Dependency cycles detected in: ${plan.cyclicFeatureIds.join(', ')}`);
        await progressLog.append(this.progressPath, `CYCLES: ${plan.cyclicFeatureIds.join(', ')}`);
      }

      if (plan.levels.length === 0) {
        return this.handleNoReadyTeamWork(data, plan.cyclicFeatureIds);
      }

      const level = plan.levels[0]!;
      let featureIds = level.featureIds.slice(0, this.config.teammates);

      const repeatConflicts = featureIds.filter(id => (this.conflictCounts.get(id) ?? 0) >= 2);
      if (repeatConflicts.length > 0 && featureIds.length > 1) {
        featureIds = [repeatConflicts[0]!];
        logger.info(`Serializing ${featureIds[0]} after repeated merge conflicts`);
      }

      logger.teamLevel(level.level, featureIds);
      await setRuntimeSessionState(this.cwd, {
        phase: 'select_feature',
        summary: `Selected batch for level ${level.level}: ${featureIds.join(', ')}`,
        activeFeatureIds: featureIds,
      });
      for (const featureId of featureIds) {
        await this.recordRuntimeEvent('feature_selected', 'select_feature', `Selected ${featureId} for team execution.`, featureId);
      }

      const results = await this.dispatchBatch(data, featureIds);
      for (const result of results) {
        await this.handleResult(result);
      }

      for (const result of results) {
        await this.worktreeManager.cleanup(result.slot.worktree, this.cwd);
      }
      await setRuntimeSessionState(this.cwd, {
        phase: 'cleanup',
        summary: `Cleaned up team worktrees for batch: ${featureIds.join(', ')}`,
        activeFeatureIds: [],
      });

      const afterData = await featureStore.read(this.featureListPath);
      recalculateStats(afterData);
      await featureStore.write(this.featureListPath, afterData);

      const remaining = this.remaining(afterData);
      const blocked = this.blockedCount(afterData);
      const complete = afterData.stats.complete;
      const total = afterData.features.length;

      if (remaining === 0 && blocked === 0) {
        logger.success(`ALL FEATURES COMPLETE! (${complete}/${total})`);
        await setRuntimeSessionState(this.cwd, {
          status: 'completed',
          phase: 'complete',
          summary: `All features complete (${complete}/${total}).`,
          activeFeatureIds: [],
        });
        await this.recordRuntimeEvent('session_finished', 'complete', `All features complete (${complete}/${total}).`);
        await this.commitManagedState(undefined, 'final harness state');
        return 0;
      }

      if (remaining === 0 && blocked > 0) {
        logger.warning(`BLOCKED - Human intervention needed. ${complete}/${total} complete, ${blocked} blocked`);
        await setRuntimeSessionState(this.cwd, {
          status: 'blocked',
          phase: 'complete',
          summary: `${blocked} feature(s) are blocked and no ready team work remains.`,
          activeFeatureIds: [],
          lessons: ['Human intervention is required before team execution can continue.'],
        });
        await this.recordRuntimeEvent('session_finished', 'complete', `${blocked} feature(s) are blocked and no ready team work remains.`);
        return 2;
      }

      logger.info(`Progress: ${complete}/${total} complete, ${remaining} remaining`);
      if (this.config.sleepBetween > 0 && iteration < this.config.maxIterations - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.sleepBetween * 1000));
      }
    }

    logger.warning(`Max iterations reached (${this.config.maxIterations})`);
    await setRuntimeSessionState(this.cwd, {
      status: 'failed',
      phase: 'complete',
      summary: `Max iterations reached (${this.config.maxIterations}).`,
      activeFeatureIds: [],
      lessons: ['The team harness hit its iteration budget before clearing the backlog.'],
    });
    await this.recordRuntimeEvent('session_finished', 'complete', `Max iterations reached (${this.config.maxIterations}).`);
    return 1;
  }

  private async dispatchBatch(data: FeatureList, featureIds: string[]): Promise<BatchResult[]> {
    const slots: AgentSlot[] = [];

    for (const featureId of featureIds) {
      const feature = featureStore.findById(data, featureId);
      if (!feature) continue;

      if (feature.status === 'pending') {
        feature.status = 'in_progress';
        recalculateStats(data);
        await featureStore.write(this.featureListPath, data);
      }

      const worktree = await this.worktreeManager.create(featureId, this.cwd);
      await this.prepareWorktree(worktree.path, featureId);
      const harnessPaths = getFeatureHarnessPaths(this.cwd, featureId);
      await updateRuntimeFeatureState(this.cwd, featureId, {}, {
        runId: this.runtimeRunId,
        attempt: feature.attempts + 1,
        phase: 'prepare_worktree',
        status: 'active',
        summary: `Preparing team worktree for ${featureId}.`,
        artifactPaths: Object.values(harnessPaths),
        worktreePath: worktree.path,
        branch: worktree.branch,
      });
      slots.push({ featureId, description: feature.description, worktree });
    }

    const settled = await Promise.allSettled(
      slots.map(async (slot): Promise<BatchResult> => {
        const featureList = await featureStore.read(this.featureListPath);
        const feature = featureStore.findById(featureList, slot.featureId);
        if (!feature) {
          return {
            slot,
            harnessResult: { outcome: 'retry', summary: 'Feature disappeared from feature_list.json' },
          };
        }

        logger.feature(slot.featureId, slot.description, {
          complete: featureList.features.filter(f => f.status === 'complete').length,
          total: featureList.features.length,
          attempt: feature.attempts + 1,
        });
        await updateRuntimeFeatureState(this.cwd, slot.featureId, {
          phase: 'feature_harness',
          summary: `Running planner/implementer/verifier harness for ${slot.featureId}.`,
          historyEntry: {
            phase: 'feature_harness',
            outcome: 'active',
            summary: `Running planner/implementer/verifier harness for ${slot.featureId}.`,
          },
        });

        const harnessResult = await runFeatureHarness({
          runner: this.runner,
          config: this.config,
          promptsDir: this.promptsDir,
          cwd: slot.worktree.path,
          feature,
        });

        return { slot, harnessResult };
      }),
    );

    return settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      return {
        slot: slots[index]!,
        harnessResult: { outcome: 'retry', summary: 'Feature harness threw before completion' },
      };
    });
  }

  private async handleNoReadyTeamWork(data: FeatureList, cyclicFeatureIds: string[]): Promise<number> {
    const remaining = this.remaining(data);
    const blocked = this.blockedCount(data);
    const complete = data.stats.complete;
    const total = data.features.length;

    if (total === 0) {
      logger.warning('feature_list.json appears corrupted (0 features found). Stopping team loop.');
      await setRuntimeSessionState(this.cwd, {
        status: 'failed',
        phase: 'complete',
        summary: 'feature_list.json appears corrupted (0 features found).',
        activeFeatureIds: [],
        lessons: ['feature_list.json must not be reduced to an empty feature set during runtime.'],
      });
      await this.recordRuntimeEvent('session_finished', 'complete', 'feature_list.json appears corrupted (0 features found).');
      return 1;
    }

    if (remaining === 0 && blocked === 0) {
      logger.success(`ALL FEATURES COMPLETE! (${complete}/${total})`);
      await setRuntimeSessionState(this.cwd, {
        status: 'completed',
        phase: 'complete',
        summary: `All features complete (${complete}/${total}).`,
        activeFeatureIds: [],
      });
      await this.recordRuntimeEvent('session_finished', 'complete', `All features complete (${complete}/${total}).`);
      await this.commitManagedState(undefined, 'final harness state');
      return 0;
    }

    const waitingFeatureIds = data.features
      .filter(feature => feature.status === 'pending' || feature.status === 'in_progress')
      .map(feature => feature.id);
    const cycleSuffix = cyclicFeatureIds.length > 0 ? ` Cycles: ${cyclicFeatureIds.join(', ')}` : '';
    const summary = waitingFeatureIds.length > 0
      ? `No ready team work remains. Waiting on blocked or cyclic dependencies: ${waitingFeatureIds.join(', ')}.${cycleSuffix}`.trim()
      : `${blocked} feature(s) are blocked and no ready team work remains.`;

    logger.warning(summary);
    await setRuntimeSessionState(this.cwd, {
      status: 'blocked',
      phase: 'complete',
      summary,
      activeFeatureIds: [],
      lessons: ['Human intervention is required before team execution can continue.'],
    });
    await this.recordRuntimeEvent('session_finished', 'complete', summary);
    return 2;
  }

  private async handleResult(result: BatchResult): Promise<void> {
    const { slot, harnessResult } = result;
    await this.recordRuntimeEvent(
      'feature_result',
      'feature_harness',
      `${slot.featureId} harness outcome: ${harnessResult.outcome} — ${harnessResult.summary}`,
      slot.featureId,
    );

    if (harnessResult.outcome === 'approved') {
      await updateRuntimeFeatureState(this.cwd, slot.featureId, {
        phase: 'feature_harness',
        status: 'approved',
        summary: harnessResult.summary,
        historyEntry: {
          phase: 'feature_harness',
          outcome: 'approved',
          summary: harnessResult.summary,
        },
      });
      await this.commitWorktreeArtifacts(slot.worktree.path, slot.featureId);
      const mergeResult = await this.worktreeManager.merge(slot.worktree, this.cwd);

      if (!mergeResult.success || !mergeResult.mergeCommit) {
        const reason = mergeResult.error ?? 'Merge failed';
        if (mergeResult.conflicted) {
          const count = (this.conflictCounts.get(slot.featureId) ?? 0) + 1;
          this.conflictCounts.set(slot.featureId, count);
        }
        const finalStatus = await this.markAttempt(slot.featureId, reason);
        await updateRuntimeFeatureState(this.cwd, slot.featureId, {
          phase: 'merge',
          status: finalStatus === 'blocked' ? 'blocked' : 'retry',
          summary: reason,
          lastError: reason,
          historyEntry: {
            phase: 'merge',
            outcome: 'failed',
            summary: reason,
          },
        });
        await setRuntimeSessionState(this.cwd, {
          phase: 'merge',
          summary: `Merge failed for ${slot.featureId}: ${reason}`,
          activeFeatureIds: [slot.featureId],
          lessons: [`Merge failed for ${slot.featureId}: ${reason}`],
        });
        await this.recordRuntimeEvent('merge_result', 'merge', `Merge failed for ${slot.featureId}: ${reason}`, slot.featureId);
        await progressLog.append(this.progressPath, `MERGE FAILED for ${slot.featureId}: ${reason}`);
        await this.copyHarnessBack(slot.featureId, slot.worktree.path);
      } else {
        this.conflictCounts.delete(slot.featureId);
        await updateRuntimeFeatureState(this.cwd, slot.featureId, {
          phase: 'merge',
          status: 'merged',
          summary: `Merged ${slot.featureId} into the main branch.`,
          mergeCommit: mergeResult.mergeCommit,
          historyEntry: {
            phase: 'merge',
            outcome: 'merged',
            summary: `Merged ${slot.featureId} into the main branch.`,
          },
        });
        await this.recordRuntimeEvent('merge_result', 'merge', `Merged ${slot.featureId} into the main branch.`, slot.featureId);
        await setRuntimeSessionState(this.cwd, {
          phase: 'post_merge_verification',
          summary: `Running post-merge verification for ${slot.featureId}.`,
          activeFeatureIds: [slot.featureId],
        });
        const verification = await this.verify(slot.featureId, mergeResult.mergeCommit);
        if (!verification.ok) {
          await this.worktreeManager.revertLastMerge(this.cwd, mergeResult.mergeCommit);
          await this.copyHarnessBack(slot.featureId, slot.worktree.path);
          await this.recordPostMergeVerification(slot.featureId, mergeResult.mergeCommit, verification);
          const finalStatus = await this.markAttempt(
            slot.featureId,
            `Verification failed${verification.command ? `: ${verification.command}` : ''}${verification.error ? ` — ${verification.error}` : ''}`,
          );
          await updateRuntimeFeatureState(this.cwd, slot.featureId, {
            phase: 'post_merge_verification',
            status: finalStatus === 'blocked' ? 'blocked' : 'retry',
            summary: `Verification failed${verification.command ? `: ${verification.command}` : ''}${verification.error ? ` — ${verification.error}` : ''}`,
            lastError: `Verification failed${verification.command ? `: ${verification.command}` : ''}${verification.error ? ` — ${verification.error}` : ''}`,
            commandResults: verification.commandResults,
            historyEntry: {
              phase: 'post_merge_verification',
              outcome: 'failed',
              summary: `Verification failed${verification.command ? `: ${verification.command}` : ''}${verification.error ? ` — ${verification.error}` : ''}`,
            },
          });
          await setRuntimeSessionState(this.cwd, {
            phase: 'post_merge_verification',
            summary: `Post-merge verification failed for ${slot.featureId}.`,
            activeFeatureIds: [slot.featureId],
            lessons: [`Post-merge verification failed for ${slot.featureId}${verification.command ? ` at ${verification.command}` : ''}.`],
          });
          await this.recordRuntimeEvent(
            'verification_result',
            'post_merge_verification',
            `Post-merge verification failed for ${slot.featureId}${verification.command ? ` at ${verification.command}` : ''}${verification.error ? `: ${verification.error}` : ''}`,
            slot.featureId,
          );
          await progressLog.append(
            this.progressPath,
            `VERIFICATION FAILED for ${slot.featureId}: ${verification.command ?? 'unknown command'}${verification.error ? ` — ${verification.error}` : ''}`,
          );
        } else {
          await this.recordPostMergeVerification(slot.featureId, mergeResult.mergeCommit, verification);
          await this.markComplete(slot.featureId);
          await updateRuntimeFeatureState(this.cwd, slot.featureId, {
            phase: 'complete',
            status: 'completed',
            summary: `Feature ${slot.featureId} completed successfully.`,
            mergeCommit: mergeResult.mergeCommit,
            commandResults: verification.commandResults,
            historyEntry: {
              phase: 'complete',
              outcome: 'completed',
              summary: `Feature ${slot.featureId} completed successfully.`,
            },
          });
          await setRuntimeSessionState(this.cwd, {
            phase: 'complete',
            summary: `Feature ${slot.featureId} completed successfully.`,
            activeFeatureIds: [],
            lastCompletedFeatureId: slot.featureId,
          });
          await this.recordRuntimeEvent('verification_result', 'post_merge_verification', `Post-merge verification passed for ${slot.featureId}.`, slot.featureId);
          await progressLog.append(this.progressPath, `APPROVED: ${slot.featureId} — merged and verified`);
        }
      }
    } else {
      await this.copyHarnessBack(slot.featureId, slot.worktree.path);
      const finalStatus = await this.markAttempt(slot.featureId, harnessResult.summary, harnessResult.outcome === 'blocked');
      await updateRuntimeFeatureState(this.cwd, slot.featureId, {
        phase: 'feature_harness',
        status: finalStatus === 'blocked' ? 'blocked' : 'retry',
        summary: harnessResult.summary,
        lastError: harnessResult.summary,
        historyEntry: {
          phase: 'feature_harness',
          outcome: finalStatus === 'blocked' ? 'blocked' : 'retry',
          summary: harnessResult.summary,
        },
      });
      await setRuntimeSessionState(this.cwd, {
        phase: 'feature_harness',
        summary: `Feature ${slot.featureId} needs another attempt: ${harnessResult.summary}`,
        activeFeatureIds: [slot.featureId],
        lessons: [`Feature ${slot.featureId} ${finalStatus === 'blocked' ? 'blocked' : 'retry'}: ${harnessResult.summary}`],
      });
      await progressLog.append(
        this.progressPath,
        `${harnessResult.outcome.toUpperCase()}: ${slot.featureId} — ${harnessResult.summary}`,
      );
    }

    await this.commitManagedState(slot.featureId, `record harness state for ${slot.featureId}`);
  }

  private async prepareWorktree(worktreePath: string, featureId: string): Promise<void> {
    const featureList = await featureStore.read(this.featureListPath);
    await writeFile(path.join(worktreePath, FEATURE_LIST_FILE), JSON.stringify(featureList, null, 2), 'utf-8');

    try {
      await copyFile(this.progressPath, path.join(worktreePath, PROGRESS_FILE));
    } catch {
      // Progress log may not exist yet.
    }

    const srcPrompts = path.join(this.cwd, RALPH_DIR, 'prompts');
    const destPrompts = path.join(worktreePath, RALPH_DIR, 'prompts');
    if (existsSync(srcPrompts) && !existsSync(destPrompts)) {
      await mkdir(destPrompts, { recursive: true });
      await cp(srcPrompts, destPrompts, { recursive: true });
    }

    await copyFeatureHarness(this.cwd, worktreePath, featureId);
  }

  private async copyHarnessBack(featureId: string, worktreePath: string): Promise<void> {
    await copyFeatureHarness(worktreePath, this.cwd, featureId);
  }

  private async commitWorktreeArtifacts(worktreePath: string, featureId: string): Promise<void> {
    const managedPaths = [path.join(RALPH_DIR, RALPH_FEATURES_DIR, featureId)];
    const existing = managedPaths.filter(managedPath => existsSync(path.join(worktreePath, managedPath)));
    if (existing.length === 0) return;

    await gitExec(['add', '--', ...existing], worktreePath);
    const { stdout } = await gitExec(['status', '--porcelain', '--', ...existing], worktreePath);
    if (!stdout.trim()) return;

    await gitExec(
      ['commit', '-m', sanitizeCommitMessage(`chore: record evaluation for ${featureId}`)],
      worktreePath,
    );
  }

  private async verify(featureId: string, mergeCommit?: string): Promise<VerificationResult> {
    const data = await featureStore.read(this.featureListPath);
    const { install_command } = data.config;
    const commands = [data.config.build_command, data.config.test_command].filter((command): command is string => !!command);
    const result = await runVerificationCommands(this.cwd, commands, { mergeCommit, installCommand: install_command });

    if (result.ok) {
      logger.success(`${featureId} verified successfully`);
    }

    return result;
  }

  private async recordPostMergeVerification(
    featureId: string,
    mergeCommit: string,
    verification: VerificationResult,
  ): Promise<void> {
    const paths = getFeatureHarnessPaths(this.cwd, featureId);
    await mkdir(paths.featureDir, { recursive: true });
    await writePostMergeVerificationReport(paths.postMergeVerificationPath, {
      feature_id: featureId,
      merge_commit: mergeCommit,
      outcome: verification.ok ? 'approved' : 'retry',
      summary: verification.ok
        ? 'Post-merge verification passed on the main branch.'
        : `Post-merge verification failed${verification.command ? ` at ${verification.command}` : ''}${verification.error ? `: ${verification.error}` : ''}`,
      command_results: verification.commandResults,
    });
  }

  private async markAttempt(featureId: string, error: string, forceBlocked: boolean = false): Promise<'in_progress' | 'blocked' | null> {
    const data = await featureStore.read(this.featureListPath);
    const feature = featureStore.findById(data, featureId);
    if (!feature) return null;

    feature.attempts++;
    feature.last_error = error;

    if (forceBlocked || feature.attempts >= data.config.max_attempts_per_feature) {
      feature.status = 'blocked';
    } else {
      feature.status = 'in_progress';
    }

    recalculateStats(data);
    await featureStore.write(this.featureListPath, data);
    return feature.status;
  }

  private async markComplete(featureId: string): Promise<void> {
    const data = await featureStore.read(this.featureListPath);
    const feature = featureStore.findById(data, featureId);
    if (!feature) return;

    feature.status = 'complete';
    feature.last_error = null;
    recalculateStats(data);
    await featureStore.write(this.featureListPath, data);
  }

  private async ensureFrameworkFilesTracked(): Promise<void> {
    const dirs = [RALPH_DIR, '.claude/'];
    const toAdd = dirs.filter(dir => existsSync(path.join(this.cwd, dir)));
    if (toAdd.length === 0) return;

    try {
      await gitExec(['add', '--', ...toAdd], this.cwd);
      const { stdout } = await gitExec(['status', '--porcelain', '--', ...toAdd], this.cwd);
      if (stdout.trim()) {
        await gitExec(['commit', '-m', 'chore: track framework directories'], this.cwd);
      }
    } catch {
      // Best effort.
    }
  }

  private async commitManagedState(featureId?: string, message?: string): Promise<void> {
    const managed = [FEATURE_LIST_FILE, PROGRESS_FILE, path.join(RALPH_DIR, 'runtime')];
    if (featureId) {
      managed.push(path.join(RALPH_DIR, RALPH_FEATURES_DIR, featureId));
    }

    const existing = managed.filter(managedPath => existsSync(path.join(this.cwd, managedPath)));
    if (existing.length === 0) return;

    try {
      await gitExec(['add', '--', ...existing], this.cwd);
      const { stdout } = await gitExec(['status', '--porcelain', '--', ...existing], this.cwd);
      if (stdout.trim()) {
        await gitExec(
          ['commit', '-m', sanitizeCommitMessage(`chore: ${message ?? 'update harness state'}`)],
          this.cwd,
        );
      }
    } catch {
      // Best effort.
    }
  }

  private remaining(data: FeatureList): number {
    return data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
  }

  private blockedCount(data: FeatureList): number {
    return data.features.filter(f => f.status === 'blocked').length;
  }

  private async recordRuntimeEvent(
    type: 'session_started' | 'feature_selected' | 'feature_result' | 'merge_result' | 'verification_result' | 'session_finished' | 'session_interrupted',
    phase: 'startup' | 'preflight' | 'select_feature' | 'prepare_worktree' | 'feature_harness' | 'merge' | 'post_merge_verification' | 'cleanup' | 'complete',
    summary: string,
    featureId?: string,
  ): Promise<void> {
    if (!this.runtimeRunId) return;
    await appendRuntimeEvent(this.cwd, {
      run_id: this.runtimeRunId,
      mode: 'team',
      type,
      phase,
      summary,
      feature_id: featureId,
    });
  }
}
