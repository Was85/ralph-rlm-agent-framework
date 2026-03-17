import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Feature, RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import * as featureStore from '../core/feature-store.js';
import { recalculateStats } from '../core/stats.js';
import { FEATURE_LIST_FILE, PROGRESS_FILE } from '../config/defaults.js';
import * as progressLog from '../core/progress-log.js';
import * as logger from '../ui/logger.js';
import { gitExec, sanitizeCommitMessage, safeExecCommand } from '../core/safe-exec.js';

/**
 * Safety net: commits uncommitted changes ONLY when a feature was completed.
 * Does not commit broken/failing code — that stays uncommitted for the next retry.
 * Returns true if a safety-net commit was created.
 */
async function ensureCommitted(cwd: string, featureListPath: string, completeBefore: Set<string>): Promise<boolean> {
  try {
    const { stdout: status } = await gitExec(['status', '--porcelain'], cwd);
    if (!status.trim()) return false; // nothing to commit

    // Only auto-commit if a feature was completed this iteration
    const data = await featureStore.read(featureListPath);
    const newlyComplete = data.features.filter(
      f => f.status === 'complete' && !completeBefore.has(f.id),
    );

    if (newlyComplete.length === 0) {
      // No feature completed — don't commit broken code
      return false;
    }

    let commitMsg: string;
    if (newlyComplete.length === 1 && newlyComplete[0]) {
      commitMsg = `feat: ${newlyComplete[0].id} - ${newlyComplete[0].description}`;
    } else {
      const ids = newlyComplete.map(f => f.id).join(', ');
      commitMsg = `feat: ${ids} - implementation progress`;
    }

    await gitExec(['add', '.'], cwd);
    await gitExec(['commit', '-m', sanitizeCommitMessage(commitMsg)], cwd);
    logger.warning('Safety net: auto-committed changes that the agent missed');
    return true;
  } catch {
    // Commit may fail if nothing staged or other git issues
    return false;
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Verifies that previously completed features still build and pass tests.
 * If verification fails, reverts the features back to in_progress (or blocked if max attempts reached).
 * Returns true if verification passed (or was skipped).
 */
async function verifyPreviousFeature(
  cwd: string,
  featureListPath: string,
  progressPath: string,
  completedIds: string[],
): Promise<boolean> {
  if (completedIds.length === 0) return true;

  const data = await featureStore.read(featureListPath);
  const { build_command, test_command } = data.config;

  if (!build_command && !test_command) return true;

  logger.info(`Verifying previously completed feature(s): ${completedIds.join(', ')}`);

  // Brief pause before verification to let file locks release (especially on Windows
  // where dotnet/MSBuild may still hold handles from the agent's build/test run).
  await new Promise(resolve => setTimeout(resolve, 3_000));

  const commands = [build_command, test_command].filter((c): c is string => !!c);

  for (const cmd of commands) {
    try {
      await safeExecCommand(cmd, cwd, { timeout: 300_000 });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warning(`Verification failed: ${cmd}`);

      for (const id of completedIds) {
        const feature = featureStore.findById(data, id);
        if (feature && feature.status === 'complete') {
          feature.attempts++;
          if (feature.attempts >= data.config.max_attempts_per_feature) {
            feature.status = 'blocked';
            feature.last_error = `Max attempts (${data.config.max_attempts_per_feature}) reached — verification failed: ${cmd}`;
            logger.warning(`${id} blocked after ${feature.attempts} attempts (verification failure)`);
          } else {
            feature.status = 'in_progress';
            feature.last_error = `Verification failed: ${cmd} — ${errorMsg}`;
          }
        }
      }
      recalculateStats(data);
      await featureStore.write(featureListPath, data);
      await progressLog.append(progressPath, `VERIFICATION FAILED for ${completedIds.join(', ')}: ${cmd} — ${errorMsg}`);
      return false;
    }
  }

  logger.success(`Verification passed for: ${completedIds.join(', ')}`);
  await progressLog.append(progressPath, `VERIFIED: ${completedIds.join(', ')} — build and tests pass`);
  return true;
}

/**
 * Creates a final commit when all features are complete, if there are uncommitted changes.
 */
async function finalCommit(cwd: string, progressPath: string): Promise<void> {
  try {
    const { stdout: status } = await gitExec(['status', '--porcelain'], cwd);
    if (status.trim()) {
      await gitExec(['add', '.'], cwd);
      await gitExec(['commit', '-m', 'feat: all features complete — final commit'], cwd);
      logger.success('Final commit created');
      await progressLog.append(progressPath, 'ALL FEATURES COMPLETE — final commit');
    }
  } catch {
    // Commit may fail if nothing staged or other git issues
  }
}

export async function runImplement(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('PHASE 3: IMPLEMENT FEATURES (RALPH LOOP)');
  logger.info('Implementing features one by one until complete...');

  if (!(await runPreflight('run', config.runner, promptsDir, cwd))) {
    return 1;
  }

  // Safety checkpoint via git stash (exclude .ralph/ to preserve prompts)
  try {
    await gitExec(['stash', 'push', '-m', 'ralph-pre-implement', '--include-untracked'], cwd);
  } catch {
    // Stash may fail if nothing to stash
  }

  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  const progressPath = path.join(cwd, PROGRESS_FILE);

  // Pre-loop check
  try {
    const data = await featureStore.read(featureListPath);
    const remaining = data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
    const blockedCount = data.features.filter(f => f.status === 'blocked').length;

    if (remaining === 0) {
      if (blockedCount > 0) {
        logger.warning(`No pending features, but ${blockedCount} feature(s) are blocked`);
        logger.info('Fix blocked features in feature_list.json and re-run');
        return 2;
      } else {
        logger.success('All features are already complete! Nothing to do.');
        return 0;
      }
    }
    logger.info(`${remaining} feature(s) remaining to implement`);
  } catch (err) {
    logger.error(`Failed to read feature_list.json: ${err}`);
    return 1;
  }

  const implPromptPath = path.join(promptsDir, 'implementer.md');

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    logger.info(`--- Implementation Iteration ${iteration + 1} of ${config.maxIterations} ---`);

    // Windows NUL file cleanup
    const nulPath = path.join(cwd, 'nul');
    if (existsSync(nulPath)) {
      try { await unlink(nulPath); } catch { /* ignore */ }
    }

    // --- FRAMEWORK PICKS THE NEXT FEATURE ---
    // The framework controls which feature to work on, not the agent.
    // This ensures one feature per fresh context/session.
    let targetFeature: { id: string; description: string } | null = null;
    try {
      const data = await featureStore.read(featureListPath);

      // First: resume any in_progress feature (retry from previous failed attempt)
      const inProgress = data.features.find(f => f.status === 'in_progress');
      if (inProgress) {
        targetFeature = { id: inProgress.id, description: inProgress.description };
      } else {
        // Next: pick the first pending feature
        const pending = data.features.find(f => f.status === 'pending');
        if (pending) {
          pending.status = 'in_progress';
          recalculateStats(data);
          await featureStore.write(featureListPath, data);
          targetFeature = { id: pending.id, description: pending.description };
        }
      }
    } catch {
      logger.warning('Failed to read feature_list.json to pick next feature');
    }

    if (!targetFeature) {
      // No actionable features — check final state
      break;
    }

    // Show user-friendly feature banner with progress context
    try {
      const data = await featureStore.read(featureListPath);
      const total = data.features.length;
      const complete = data.features.filter(f => f.status === 'complete').length;
      const feature = featureStore.findById(data, targetFeature.id);
      logger.feature(targetFeature.id, targetFeature.description, {
        complete,
        total,
        attempt: feature ? feature.attempts + 1 : 1,
      });
    } catch {
      logger.info(`Target feature: ${targetFeature.id} — ${targetFeature.description}`);
    }

    // --- HIDE PENDING FEATURES ---
    // Structural guard: remove other pending features from feature_list.json
    // so the agent can ONLY see (and implement) the assigned feature.
    // This prevents the agent from implementing multiple features in one session.
    let hiddenFeatures: Feature[] = [];
    try {
      const data = await featureStore.read(featureListPath);
      hiddenFeatures = data.features.filter(
        f => f.status === 'pending' && f.id !== targetFeature.id,
      ).map(f => ({ ...f }));
      data.features = data.features.filter(
        f => !(f.status === 'pending' && f.id !== targetFeature.id),
      );
      recalculateStats(data);
      await featureStore.write(featureListPath, data);
    } catch {
      logger.warning('Failed to isolate feature for agent');
    }

    // Build a feature-specific prompt — framework controls feature selection,
    // agent only implements the assigned feature and exits.
    const prompt = [
      `CRITICAL CONSTRAINT: You are assigned EXACTLY ONE feature. After completing it you MUST exit immediately. Do NOT look for or implement any other features.`,
      `YOUR ASSIGNED FEATURE: ${targetFeature.id} — ${targetFeature.description}.`,
      `WORKFLOW: 1) Read ${implPromptPath} for coding guidelines (if not accessible, follow steps below). 2) Read claude-progress.txt for codebase patterns. 3) Implement ONLY ${targetFeature.id}. 4) Run quality gates (build + test commands from feature_list.json config). 5) If tests pass: update feature status with: npx ralph skill update-feature-status --id ${targetFeature.id} --status complete, then git add . && git commit -m 'feat: ${targetFeature.id} - ${targetFeature.description}', then EXIT. 6) If tests fail: log the error and EXIT.`,
      `MANDATORY: After tests pass you MUST run the skill command above to mark ${targetFeature.id} as complete in feature_list.json BEFORE committing. Never edit feature_list.json directly.`,
      `AFTER COMMITTING ${targetFeature.id} YOU MUST EXIT IMMEDIATELY. The framework manages feature sequencing — it will start a new session for the next feature. Implementing more than one feature per session will cause errors.`,
    ].join(' ');

    await runner.invoke(prompt, {
      verbose: config.verbose,
      debug: config.debug,
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      stream: config.stream,
    });

    // --- RESTORE HIDDEN FEATURES ---
    // Put the hidden pending features back into feature_list.json
    // before checking results or doing any post-iteration work.
    if (hiddenFeatures.length > 0) {
      try {
        const data = await featureStore.read(featureListPath);
        data.features.push(...hiddenFeatures);
        data.features.sort((a, b) => a.id.localeCompare(b.id));
        recalculateStats(data);
        await featureStore.write(featureListPath, data);
      } catch {
        logger.warning('Failed to restore hidden features');
      }
    }

    // Check if the targeted feature was completed
    let featureCompleted = false;
    try {
      const data = await featureStore.read(featureListPath);
      const feature = featureStore.findById(data, targetFeature.id);
      featureCompleted = feature?.status === 'complete';
    } catch { /* ignore */ }

    // Safety net: auto-commit if the agent didn't
    if (featureCompleted) {
      const completeBefore = new Set<string>();
      // We know which feature was targeted, so use that for commit detection
      await ensureCommitted(cwd, featureListPath, completeBefore);
    }

    // --- VERIFICATION: build + test before proceeding ---
    if (featureCompleted) {
      const verified = await verifyPreviousFeature(cwd, featureListPath, progressPath, [targetFeature.id]);
      if (!verified) {
        logger.warning(`Verification failed for ${targetFeature.id} — next iteration will retry`);
      } else {
        // Commit any remaining changes (feature_list.json updates, progress.txt)
        await ensureCommitted(cwd, featureListPath, new Set<string>());
      }
    } else {
      // Feature was NOT completed by the agent — increment attempts
      try {
        const data = await featureStore.read(featureListPath);
        const feature = featureStore.findById(data, targetFeature.id);
        if (feature && feature.status === 'in_progress') {
          feature.attempts++;
          if (feature.attempts >= data.config.max_attempts_per_feature) {
            feature.status = 'blocked';
            feature.last_error = `Max attempts (${data.config.max_attempts_per_feature}) reached`;
            logger.warning(`${targetFeature.id} blocked after ${feature.attempts} attempts`);
          }
          recalculateStats(data);
          await featureStore.write(featureListPath, data);
        }
      } catch { /* ignore */ }
      await progressLog.append(progressPath, `${targetFeature.id} — agent did not complete feature this iteration`);
    }

    // --- RECALCULATE & CHECK COMPLETION ---
    try {
      const data = await featureStore.read(featureListPath);
      recalculateStats(data);
      await featureStore.write(featureListPath, data);

      const total = data.features.length;
      const complete = data.stats.complete;
      const remaining = data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
      const blockedCount = data.stats.blocked;

      if (total === 0) {
        logger.warning('feature_list.json appears corrupted (0 features found). Stopping loop.');
        return 1;
      }

      // All complete
      if (remaining === 0 && blockedCount === 0) {
        logger.success(`ALL FEATURES COMPLETE! (${complete}/${total})`);
        logger.info(`Total iterations: ${iteration + 1}`);
        await finalCommit(cwd, progressPath);
        return 0;
      }

      // All remaining are blocked
      if (remaining === 0 && blockedCount > 0) {
        logger.warning(`BLOCKED - Human intervention needed. ${complete}/${total} complete, ${blockedCount} blocked`);
        return 2;
      }

      if (iteration < config.maxIterations - 1) {
        logger.info(`Progress: ${complete}/${total} complete, ${remaining} remaining.`);
        if (config.sleepBetween > 0) {
          await sleep(config.sleepBetween);
        }
      }
    } catch {
      logger.warning('Failed to parse feature_list.json after iteration');
    }
  }

  logger.warning(`Max iterations reached (${config.maxIterations})`);
  return 1;
}
