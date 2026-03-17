import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { FEATURE_LIST_FILE, OPTIMIZER_LOG_FILE } from '../config/defaults.js';
import { gitExec, sanitizeCommitMessage } from '../core/safe-exec.js';
import * as logger from '../ui/logger.js';
import { runOptimize } from './optimize.js';
import { runImplement } from './run.js';

interface LogEntry {
  generation: number;
  complete: number;
  total: number;
  baselineTotal: number;
  timestamp: string;
  kept: boolean;
}

async function score(featureListPath: string): Promise<{ complete: number; total: number }> {
  const raw = await readFile(featureListPath, 'utf-8');
  const data = JSON.parse(raw);
  const features = Array.isArray(data.features) ? data.features : [];
  const complete = features.filter((f: { status: string }) => f.status === 'complete').length;
  return { complete, total: features.length };
}

async function writeLog(logPath: string, entries: LogEntry[]): Promise<void> {
  try {
    await writeFile(logPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    logger.warning('Failed to write optimizer log — continuing');
  }
}

export async function runOptimizerLoop(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('OPTIMIZER LOOP');

  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  const logPath = path.join(cwd, OPTIMIZER_LOG_FILE);

  // Baseline score
  const baseline = await score(featureListPath);
  let bestScore = baseline.complete;
  const baselineTotal = baseline.total;
  let staleCount = 0;
  const logEntries: LogEntry[] = [];

  logger.info(`Baseline: ${bestScore}/${baselineTotal} complete`);
  logger.info(`Running ${config.generations} generation(s), budget ${config.maxIterations} per gen`);

  for (let gen = 1; gen <= config.generations; gen++) {
    logger.phase(`GENERATION ${gen} / ${config.generations}`);

    // 1. Checkpoint current HEAD
    let checkpoint: string;
    try {
      const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);
      checkpoint = stdout.trim();
    } catch {
      logger.error('Failed to get git checkpoint — skipping generation');
      continue;
    }

    // 2. Run optimizer (single mutation)
    logger.info('Running optimizer agent...');
    const optimizeResult = await runOptimize(config, promptsDir, runner, cwd);
    if (optimizeResult !== 0) {
      logger.warning('Optimizer failed — skipping generation');
      try {
        await gitExec(['reset', '--hard', checkpoint], cwd);
      } catch { /* best effort */ }
      continue;
    }

    // 3. Run implementation with budget
    logger.info(`Running implementation with budget of ${config.maxIterations}...`);

    let runResult: number;
    if (config.team) {
      const { TeamOrchestrator } = await import('../team/team-orchestrator.js');
      const orchestrator = new TeamOrchestrator(runner, config, promptsDir, cwd);
      runResult = await orchestrator.run();
    } else {
      runResult = await runImplement(config, promptsDir, runner, cwd);
    }

    // 4. Score
    const current = await score(featureListPath);
    const kept = current.complete > bestScore;

    logger.info(`Score: ${current.complete}/${current.total} complete (best: ${bestScore})`);

    // 5. Log
    logEntries.push({
      generation: gen,
      complete: current.complete,
      total: current.total,
      baselineTotal,
      timestamp: new Date().toISOString(),
      kept,
    });
    await writeLog(logPath, logEntries);

    // 6. Keep or discard
    if (kept) {
      bestScore = current.complete;
      staleCount = 0;
      try {
        await gitExec(['add', '.'], cwd);
        await gitExec(
          ['commit', '-m', sanitizeCommitMessage(`optimizer: gen ${gen} — score ${current.complete}/${current.total}`)],
          cwd,
        );
      } catch { /* commit may fail if nothing to commit */ }
      logger.success(`KEPT — new best: ${bestScore}`);
    } else {
      staleCount++;
      try {
        await gitExec(['reset', '--hard', checkpoint], cwd);
      } catch (err) {
        logger.error(`Git reset failed: ${err}`);
      }
      logger.warning(`DISCARDED — no improvement (${current.complete} <= ${bestScore})`);
    }

    // 7. Early-stop
    if (staleCount >= config.staleLimit) {
      logger.info(`Early stop: ${config.staleLimit} consecutive generations with no improvement.`);
      break;
    }
  }

  // Summary
  logger.phase('OPTIMIZER RESULTS');
  logger.info(`Best score: ${bestScore}/${baselineTotal}`);
  logger.info(`Log: ${logPath}`);
  for (const entry of logEntries) {
    logger.info(`  Gen ${entry.generation}: ${entry.complete}/${entry.total} — ${entry.kept ? 'kept' : 'discarded'}`);
  }

  return 0;
}
