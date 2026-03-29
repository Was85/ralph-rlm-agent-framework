import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import * as featureStore from '../core/feature-store.js';
import { recalculateStats } from '../core/stats.js';
import * as progressLog from '../core/progress-log.js';
import * as logger from '../ui/logger.js';
import { FEATURE_LIST_FILE, PROGRESS_FILE, RALPH_DIR, RALPH_FEATURES_DIR } from '../config/defaults.js';
import { gitExec, sanitizeCommitMessage } from '../core/safe-exec.js';
import { selectNextFeature } from '../core/scheduler.js';
import { runFeatureHarness } from '../core/harness-runner.js';
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
import type { WorktreeManager } from '../team/worktree-manager.js';
import { WorktreeManagerImpl } from '../team/worktree-manager.js';

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export async function runImplement(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
  worktreeManager?: WorktreeManager,
): Promise<number> {
  logger.phase('IMPLEMENT FEATURES (SEQUENTIAL HARNESS)');
  logger.info('Running planner -> implementer -> evaluator harness...');

  const manager = worktreeManager ?? new WorktreeManagerImpl();
  const runtimeSession = await beginRuntimeSession(cwd, 'sequential');
  const recordEvent = (
    type: 'session_started' | 'feature_selected' | 'feature_result' | 'merge_result' | 'verification_result' | 'session_finished' | 'session_interrupted',
    phase: 'startup' | 'preflight' | 'select_feature' | 'prepare_worktree' | 'feature_harness' | 'merge' | 'post_merge_verification' | 'cleanup' | 'complete',
    summary: string,
    featureId?: string,
  ) => appendRuntimeEvent(cwd, {
    run_id: runtimeSession.run_id,
    mode: 'sequential',
    type,
    phase,
    summary,
    feature_id: featureId,
  });

  const shutdownHandler = async () => {
    await setRuntimeSessionState(cwd, {
      status: 'interrupted',
      phase: 'cleanup',
      summary: 'Sequential harness interrupted by signal.',
      lessons: ['Sequential harness interrupted before completion.'],
    });
    await recordEvent('session_interrupted', 'cleanup', 'Sequential harness interrupted by signal.');
    await manager.cleanupAll(cwd);
    process.exit(1);
  };
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);

  try {
    await setRuntimeSessionState(cwd, {
      phase: 'preflight',
      summary: 'Running preflight checks for sequential harness.',
    });

    if (!(await runPreflight('run', config.runner, promptsDir, cwd))) {
      await setRuntimeSessionState(cwd, {
        status: 'failed',
        phase: 'preflight',
        summary: 'Preflight checks failed for sequential harness.',
        lessons: ['Preflight must pass before implementation can continue.'],
      });
      await recordEvent('session_finished', 'preflight', 'Preflight checks failed for sequential harness.');
      return 1;
    }

    await manager.cleanupAll(cwd);
    await ensureFrameworkFilesTracked(cwd);

    const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
    const progressPath = path.join(cwd, PROGRESS_FILE);

    try {
      const data = await featureStore.read(featureListPath);
      const remaining = data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
      const blockedCount = data.features.filter(f => f.status === 'blocked').length;

      if (remaining === 0) {
        if (blockedCount > 0) {
          logger.warning(`No pending features, but ${blockedCount} feature(s) are blocked`);
          await setRuntimeSessionState(cwd, {
            status: 'blocked',
            phase: 'complete',
            summary: `${blockedCount} blocked feature(s) remain and no ready work is available.`,
            lessons: ['Blocked features require human intervention before sequential execution can resume.'],
          });
          await recordEvent('session_finished', 'complete', `${blockedCount} blocked feature(s) remain and no ready work is available.`);
          return 2;
        }
        logger.success('All features are already complete! Nothing to do.');
        await setRuntimeSessionState(cwd, {
          status: 'completed',
          phase: 'complete',
          summary: 'All features were already complete before the sequential harness started.',
        });
        await recordEvent('session_finished', 'complete', 'All features were already complete before the sequential harness started.');
        return 0;
      }
      logger.info(`${remaining} feature(s) remaining to implement`);
    } catch (err) {
      logger.error(`Failed to read feature_list.json: ${err}`);
      await setRuntimeSessionState(cwd, {
        status: 'failed',
        phase: 'preflight',
        summary: `Failed to read feature_list.json: ${err}`,
        lessons: ['feature_list.json must stay readable for the harness to resume cleanly.'],
      });
      await recordEvent('session_finished', 'preflight', `Failed to read feature_list.json: ${err}`);
      return 1;
    }

    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      logger.info(`--- Implementation Iteration ${iteration + 1} of ${config.maxIterations} ---`);

      await setRuntimeSessionState(cwd, {
        phase: 'select_feature',
        summary: `Selecting next ready feature (iteration ${iteration + 1} of ${config.maxIterations}).`,
      });

      const data = await featureStore.read(featureListPath);
      const targetFeature = selectNextFeature(data);

      if (!targetFeature) {
        const deadlockExitCode = await handleNoReadySequentialWork(cwd, data, recordEvent);
        if (deadlockExitCode !== null) {
          return deadlockExitCode;
        }
        break;
      }

      if (targetFeature.status === 'pending') {
        targetFeature.status = 'in_progress';
        recalculateStats(data);
        await featureStore.write(featureListPath, data);
      }

      logger.feature(targetFeature.id, targetFeature.description, {
        complete: data.features.filter(f => f.status === 'complete').length,
        total: data.features.length,
        attempt: targetFeature.attempts + 1,
      });

      await setRuntimeSessionState(cwd, {
        phase: 'select_feature',
        summary: `Selected ${targetFeature.id} for sequential execution.`,
        activeFeatureIds: [targetFeature.id],
      });
      await recordEvent('feature_selected', 'select_feature', `Selected ${targetFeature.id} for sequential execution.`, targetFeature.id);

      const worktree = await manager.create(targetFeature.id, cwd);
      const harnessPaths = getFeatureHarnessPaths(cwd, targetFeature.id);
      await updateRuntimeFeatureState(cwd, targetFeature.id, {}, {
        runId: runtimeSession.run_id,
        attempt: targetFeature.attempts + 1,
        phase: 'prepare_worktree',
        status: 'active',
        summary: `Preparing worktree for ${targetFeature.id}.`,
        artifactPaths: Object.values(harnessPaths),
        worktreePath: worktree.path,
        branch: worktree.branch,
      });

      try {
        await setRuntimeSessionState(cwd, {
          phase: 'prepare_worktree',
          summary: `Preparing worktree and harness inputs for ${targetFeature.id}.`,
          activeFeatureIds: [targetFeature.id],
        });
        await prepareWorktree(worktree.path, cwd, featureListPath, progressPath, targetFeature.id);
        await updateRuntimeFeatureState(cwd, targetFeature.id, {
          phase: 'feature_harness',
          summary: `Running planner/implementer/verifier harness for ${targetFeature.id}.`,
          worktreePath: worktree.path,
          branch: worktree.branch,
          historyEntry: {
            phase: 'feature_harness',
            outcome: 'active',
            summary: `Running planner/implementer/verifier harness for ${targetFeature.id}.`,
          },
        });
        await setRuntimeSessionState(cwd, {
          phase: 'feature_harness',
          summary: `Running planner/implementer/verifier harness for ${targetFeature.id}.`,
          activeFeatureIds: [targetFeature.id],
        });

        const harnessResult = await runFeatureHarness({
          runner,
          config,
          promptsDir,
          cwd: worktree.path,
          feature: targetFeature,
        });
        await recordEvent('feature_result', 'feature_harness', `${targetFeature.id} harness outcome: ${harnessResult.outcome} — ${harnessResult.summary}`, targetFeature.id);

        if (harnessResult.outcome === 'approved') {
          await updateRuntimeFeatureState(cwd, targetFeature.id, {
            phase: 'feature_harness',
            status: 'approved',
            summary: harnessResult.summary,
            historyEntry: {
              phase: 'feature_harness',
              outcome: 'approved',
              summary: harnessResult.summary,
            },
          });
          await commitWorktreeArtifacts(worktree.path, targetFeature.id);

          await setRuntimeSessionState(cwd, {
            phase: 'merge',
            summary: `Merging approved feature ${targetFeature.id}.`,
            activeFeatureIds: [targetFeature.id],
          });
          const mergeResult = await manager.merge(worktree, cwd);
          if (!mergeResult.success || !mergeResult.mergeCommit) {
            const reason = mergeResult.error ?? 'Merge failed';
            await copyFeatureHarness(worktree.path, cwd, targetFeature.id);
            const finalStatus = await markAttempt(featureListPath, targetFeature.id, reason);
            await updateRuntimeFeatureState(cwd, targetFeature.id, {
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
            await setRuntimeSessionState(cwd, {
              phase: 'merge',
              summary: `Merge failed for ${targetFeature.id}: ${reason}`,
              activeFeatureIds: [targetFeature.id],
              lessons: [`Merge failed for ${targetFeature.id}: ${reason}`],
            });
            await recordEvent('merge_result', 'merge', `Merge failed for ${targetFeature.id}: ${reason}`, targetFeature.id);
            await progressLog.append(progressPath, `MERGE FAILED for ${targetFeature.id}: ${reason}`);
          } else {
            await updateRuntimeFeatureState(cwd, targetFeature.id, {
              phase: 'merge',
              status: 'merged',
              summary: `Merged ${targetFeature.id} into the main branch.`,
              mergeCommit: mergeResult.mergeCommit,
              historyEntry: {
                phase: 'merge',
                outcome: 'merged',
                summary: `Merged ${targetFeature.id} into the main branch.`,
              },
            });
            await recordEvent('merge_result', 'merge', `Merged ${targetFeature.id} into the main branch.`, targetFeature.id);

            await setRuntimeSessionState(cwd, {
              phase: 'post_merge_verification',
              summary: `Running post-merge verification for ${targetFeature.id}.`,
              activeFeatureIds: [targetFeature.id],
            });
            const verification = await verifyFeature(cwd, featureListPath, targetFeature.id, mergeResult.mergeCommit);
            if (!verification.ok) {
              await manager.revertLastMerge(cwd, mergeResult.mergeCommit);
              await copyFeatureHarness(worktree.path, cwd, targetFeature.id);
              await recordPostMergeVerification(cwd, targetFeature.id, mergeResult.mergeCommit, verification);
              const finalStatus = await markAttempt(
                featureListPath,
                targetFeature.id,
                `Verification failed${verification.command ? `: ${verification.command}` : ''}${verification.error ? ` — ${verification.error}` : ''}`,
              );
              await updateRuntimeFeatureState(cwd, targetFeature.id, {
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
              await setRuntimeSessionState(cwd, {
                phase: 'post_merge_verification',
                summary: `Post-merge verification failed for ${targetFeature.id}.`,
                activeFeatureIds: [targetFeature.id],
                lessons: [`Post-merge verification failed for ${targetFeature.id}${verification.command ? ` at ${verification.command}` : ''}.`],
              });
              await recordEvent(
                'verification_result',
                'post_merge_verification',
                `Post-merge verification failed for ${targetFeature.id}${verification.command ? ` at ${verification.command}` : ''}${verification.error ? `: ${verification.error}` : ''}`,
                targetFeature.id,
              );
              await progressLog.append(
                progressPath,
                `VERIFICATION FAILED for ${targetFeature.id}: ${verification.command ?? 'unknown command'}${verification.error ? ` — ${verification.error}` : ''}`,
              );
            } else {
              await recordPostMergeVerification(cwd, targetFeature.id, mergeResult.mergeCommit, verification);
              await markComplete(featureListPath, targetFeature.id);
              await updateRuntimeFeatureState(cwd, targetFeature.id, {
                phase: 'complete',
                status: 'completed',
                summary: `Feature ${targetFeature.id} completed successfully.`,
                mergeCommit: mergeResult.mergeCommit,
                commandResults: verification.commandResults,
                historyEntry: {
                  phase: 'complete',
                  outcome: 'completed',
                  summary: `Feature ${targetFeature.id} completed successfully.`,
                },
              });
              await setRuntimeSessionState(cwd, {
                phase: 'complete',
                summary: `Feature ${targetFeature.id} completed successfully.`,
                activeFeatureIds: [],
                lastCompletedFeatureId: targetFeature.id,
              });
              await recordEvent('verification_result', 'post_merge_verification', `Post-merge verification passed for ${targetFeature.id}.`, targetFeature.id);
              await progressLog.append(progressPath, `APPROVED: ${targetFeature.id} — evaluator approved and verification passed`);
            }
          }
        } else if (harnessResult.outcome === 'blocked') {
          await copyFeatureHarness(worktree.path, cwd, targetFeature.id);
          await markAttempt(featureListPath, targetFeature.id, harnessResult.summary, true);
          await updateRuntimeFeatureState(cwd, targetFeature.id, {
            phase: 'feature_harness',
            status: 'blocked',
            summary: harnessResult.summary,
            lastError: harnessResult.summary,
            historyEntry: {
              phase: 'feature_harness',
              outcome: 'blocked',
              summary: harnessResult.summary,
            },
          });
          await setRuntimeSessionState(cwd, {
            phase: 'feature_harness',
            summary: `Feature ${targetFeature.id} blocked: ${harnessResult.summary}`,
            activeFeatureIds: [targetFeature.id],
            lessons: [`Feature ${targetFeature.id} blocked: ${harnessResult.summary}`],
          });
          await progressLog.append(progressPath, `BLOCKED: ${targetFeature.id} — ${harnessResult.summary}`);
        } else {
          await copyFeatureHarness(worktree.path, cwd, targetFeature.id);
          const finalStatus = await markAttempt(featureListPath, targetFeature.id, harnessResult.summary);
          await updateRuntimeFeatureState(cwd, targetFeature.id, {
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
          await setRuntimeSessionState(cwd, {
            phase: 'feature_harness',
            summary: `Feature ${targetFeature.id} needs another attempt: ${harnessResult.summary}`,
            activeFeatureIds: [targetFeature.id],
            lessons: [`Feature ${targetFeature.id} retry: ${harnessResult.summary}`],
          });
          await progressLog.append(progressPath, `RETRY: ${targetFeature.id} — ${harnessResult.summary}`);
        }

        await commitManagedState(cwd, targetFeature.id, `record harness state for ${targetFeature.id}`);
      } finally {
        await setRuntimeSessionState(cwd, {
          phase: 'cleanup',
          summary: `Cleaning up worktree resources for ${targetFeature.id}.`,
          activeFeatureIds: [],
        });
        await manager.cleanup(worktree, cwd);
      }

      const afterData = await featureStore.read(featureListPath);
      recalculateStats(afterData);
      await featureStore.write(featureListPath, afterData);

      const total = afterData.features.length;
      const complete = afterData.stats.complete;
      const remaining = afterData.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
      const blockedCount = afterData.stats.blocked;

      if (total === 0) {
        logger.warning('feature_list.json appears corrupted (0 features found). Stopping loop.');
        await setRuntimeSessionState(cwd, {
          status: 'failed',
          phase: 'cleanup',
          summary: 'feature_list.json appears corrupted (0 features found).',
          lessons: ['feature_list.json must not be reduced to an empty feature set during runtime.'],
        });
        await recordEvent('session_finished', 'cleanup', 'feature_list.json appears corrupted (0 features found).');
        return 1;
      }

      if (remaining === 0 && blockedCount === 0) {
        logger.success(`ALL FEATURES COMPLETE! (${complete}/${total})`);
        await setRuntimeSessionState(cwd, {
          status: 'completed',
          phase: 'complete',
          summary: `All features complete (${complete}/${total}).`,
          activeFeatureIds: [],
        });
        await recordEvent('session_finished', 'complete', `All features complete (${complete}/${total}).`);
        await commitManagedState(cwd, undefined, 'final harness state');
        return 0;
      }

      if (remaining === 0 && blockedCount > 0) {
        logger.warning(`BLOCKED - Human intervention needed. ${complete}/${total} complete, ${blockedCount} blocked`);
        await setRuntimeSessionState(cwd, {
          status: 'blocked',
          phase: 'complete',
          summary: `${blockedCount} feature(s) are blocked and no ready work remains.`,
          activeFeatureIds: [],
          lessons: ['Human intervention is required before sequential execution can continue.'],
        });
        await recordEvent('session_finished', 'complete', `${blockedCount} feature(s) are blocked and no ready work remains.`);
        return 2;
      }

      if (iteration < config.maxIterations - 1) {
        logger.info(`Progress: ${complete}/${total} complete, ${remaining} remaining.`);
        if (config.sleepBetween > 0) {
          await sleep(config.sleepBetween);
        }
      }
    }

    logger.warning(`Max iterations reached (${config.maxIterations})`);
    await setRuntimeSessionState(cwd, {
      status: 'failed',
      phase: 'complete',
      summary: `Max iterations reached (${config.maxIterations}).`,
      activeFeatureIds: [],
      lessons: ['The sequential harness hit its iteration budget before clearing the backlog.'],
    });
    await recordEvent('session_finished', 'complete', `Max iterations reached (${config.maxIterations}).`);
    return 1;
  } finally {
    process.removeListener('SIGINT', shutdownHandler);
    process.removeListener('SIGTERM', shutdownHandler);
  }
}

async function prepareWorktree(
  worktreePath: string,
  mainCwd: string,
  featureListPath: string,
  progressPath: string,
  featureId: string,
): Promise<void> {
  const featureList = await featureStore.read(featureListPath);
  await writeFile(path.join(worktreePath, FEATURE_LIST_FILE), JSON.stringify(featureList, null, 2), 'utf-8');

  try {
    await copyFile(progressPath, path.join(worktreePath, PROGRESS_FILE));
  } catch {
    // Progress file may not exist yet.
  }

  const srcPrompts = path.join(mainCwd, RALPH_DIR, 'prompts');
  const destPrompts = path.join(worktreePath, RALPH_DIR, 'prompts');
  if (existsSync(srcPrompts) && !existsSync(destPrompts)) {
    await mkdir(destPrompts, { recursive: true });
    await cp(srcPrompts, destPrompts, { recursive: true });
  }

  await copyFeatureHarness(mainCwd, worktreePath, featureId);
}

async function handleNoReadySequentialWork(
  cwd: string,
  data: Awaited<ReturnType<typeof featureStore.read>>,
  recordEvent: (
    type: 'session_started' | 'feature_selected' | 'feature_result' | 'merge_result' | 'verification_result' | 'session_finished' | 'session_interrupted',
    phase: 'startup' | 'preflight' | 'select_feature' | 'prepare_worktree' | 'feature_harness' | 'merge' | 'post_merge_verification' | 'cleanup' | 'complete',
    summary: string,
    featureId?: string,
  ) => Promise<void>,
): Promise<number | null> {
  const total = data.features.length;
  const complete = data.stats.complete;
  const remaining = data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
  const blockedCount = data.stats.blocked;

  if (total === 0) {
    logger.warning('feature_list.json appears corrupted (0 features found). Stopping loop.');
    await setRuntimeSessionState(cwd, {
      status: 'failed',
      phase: 'cleanup',
      summary: 'feature_list.json appears corrupted (0 features found).',
      lessons: ['feature_list.json must not be reduced to an empty feature set during runtime.'],
    });
    await recordEvent('session_finished', 'cleanup', 'feature_list.json appears corrupted (0 features found).');
    return 1;
  }

  if (remaining === 0 && blockedCount === 0) {
    logger.success(`ALL FEATURES COMPLETE! (${complete}/${total})`);
    await setRuntimeSessionState(cwd, {
      status: 'completed',
      phase: 'complete',
      summary: `All features complete (${complete}/${total}).`,
      activeFeatureIds: [],
    });
    await recordEvent('session_finished', 'complete', `All features complete (${complete}/${total}).`);
    await commitManagedState(cwd, undefined, 'final harness state');
    return 0;
  }

  const pendingButBlockedByDependencies = data.features
    .filter(feature => feature.status === 'pending' || feature.status === 'in_progress')
    .map(feature => feature.id);
  const summary = pendingButBlockedByDependencies.length > 0
    ? `No ready features remain. Waiting on blocked or cyclic dependencies: ${pendingButBlockedByDependencies.join(', ')}`
    : `${blockedCount} feature(s) are blocked and no ready work remains.`;

  logger.warning(summary);
  await setRuntimeSessionState(cwd, {
    status: 'blocked',
    phase: 'complete',
    summary,
    activeFeatureIds: [],
    lessons: ['Human intervention is required before sequential execution can continue.'],
  });
  await recordEvent('session_finished', 'complete', summary);
  return 2;
}

async function commitWorktreeArtifacts(worktreePath: string, featureId: string): Promise<void> {
  const managedPaths = [
    path.join(RALPH_DIR, RALPH_FEATURES_DIR, featureId),
  ];
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

async function verifyFeature(
  cwd: string,
  featureListPath: string,
  featureId: string,
  mergeCommit?: string,
): Promise<VerificationResult> {
  const data = await featureStore.read(featureListPath);
  const { install_command, build_command, test_command } = data.config;
  const commands = [build_command, test_command].filter((command): command is string => !!command);
  const result = await runVerificationCommands(cwd, commands, { mergeCommit, installCommand: install_command });

  if (result.ok) {
    logger.success(`${featureId} verified successfully`);
  }

  return result;
}

async function recordPostMergeVerification(
  cwd: string,
  featureId: string,
  mergeCommit: string,
  verification: VerificationResult,
): Promise<void> {
  const paths = getFeatureHarnessPaths(cwd, featureId);
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

async function markAttempt(
  featureListPath: string,
  featureId: string,
  error: string,
  forceBlocked: boolean = false,
): Promise<'in_progress' | 'blocked' | null> {
  const data = await featureStore.read(featureListPath);
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
  await featureStore.write(featureListPath, data);
  return feature.status;
}

async function markComplete(featureListPath: string, featureId: string): Promise<void> {
  const data = await featureStore.read(featureListPath);
  const feature = featureStore.findById(data, featureId);
  if (!feature) return;

  feature.status = 'complete';
  feature.last_error = null;
  recalculateStats(data);
  await featureStore.write(featureListPath, data);
}

async function ensureFrameworkFilesTracked(cwd: string): Promise<void> {
  const trackedDirs = [RALPH_DIR, '.claude'];
  const toAdd = trackedDirs.filter(dir => existsSync(path.join(cwd, dir)));
  if (toAdd.length === 0) return;

  try {
    await gitExec(['add', '--', ...toAdd], cwd);
    const { stdout } = await gitExec(['status', '--porcelain', '--', ...toAdd], cwd);
    if (stdout.trim()) {
      await gitExec(['commit', '-m', 'chore: track framework directories'], cwd);
    }
  } catch {
    // Best effort.
  }
}

async function commitManagedState(cwd: string, featureId?: string, message?: string): Promise<void> {
  const managed = [FEATURE_LIST_FILE, PROGRESS_FILE, path.join(RALPH_DIR, 'runtime')];
  if (featureId) {
    managed.push(path.join(RALPH_DIR, RALPH_FEATURES_DIR, featureId));
  }

  const existing = managed.filter(managedPath => existsSync(path.join(cwd, managedPath)));
  if (existing.length === 0) return;

  try {
    await gitExec(['add', '--', ...existing], cwd);
    const { stdout } = await gitExec(['status', '--porcelain', '--', ...existing], cwd);
    if (stdout.trim()) {
      await gitExec(
        ['commit', '-m', sanitizeCommitMessage(`chore: ${message ?? 'update harness state'}`)],
        cwd,
      );
    }
  } catch {
    // Best effort. Harness state staying uncommitted is not fatal.
  }
}
