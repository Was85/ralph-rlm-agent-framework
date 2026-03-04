import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import * as featureStore from '../core/feature-store.js';
import { recalculateStats } from '../core/stats.js';
import { FEATURE_LIST_FILE } from '../config/defaults.js';
import * as logger from '../ui/logger.js';

const execAsync = promisify(exec);

/**
 * Safety net: commits uncommitted changes ONLY when a feature was completed.
 * Does not commit broken/failing code — that stays uncommitted for the next retry.
 * Returns true if a safety-net commit was created.
 */
async function ensureCommitted(cwd: string, featureListPath: string, completeBefore: Set<string>): Promise<boolean> {
  try {
    const { stdout: status } = await execAsync('git status --porcelain', { cwd });
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

    await execAsync('git add .', { cwd });
    await execAsync(`git commit -m "${commitMsg}"`, { cwd });
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

  // Safety checkpoint via git stash
  try {
    await execAsync('git stash push -m "ralph-pre-implement" --include-untracked', { cwd });
  } catch {
    // Stash may fail if nothing to stash
  }

  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);

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

    // Snapshot complete features before iteration so safety net knows what's new
    let completeBefore = new Set<string>();
    try {
      const snap = await featureStore.read(featureListPath);
      completeBefore = new Set(
        snap.features.filter(f => f.status === 'complete').map(f => f.id),
      );
    } catch { /* ignore */ }

    const prompt = `Your task instructions are in the file: ${implPromptPath} — start by using your Read tool to open that file, then execute every instruction. CRITICAL: When tests PASS you MUST run git add and git commit before exiting. Every completed feature gets its own commit. Do NOT commit broken code — if tests fail, just log the error and exit.`;

    await runner.invoke(prompt, {
      verbose: config.verbose,
      debug: config.debug,
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      stream: config.stream,
    });

    // Safety net: auto-commit if the agent didn't
    await ensureCommitted(cwd, featureListPath, completeBefore);

    // Safety net: recalculate stats
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
