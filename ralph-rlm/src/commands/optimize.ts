import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import { FEATURE_LIST_FILE } from '../config/defaults.js';
import * as logger from '../ui/logger.js';

export async function runOptimize(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('OPTIMIZE FEATURE LIST');
  logger.info('Running optimizer agent to improve feature_list.json...');

  if (!(await runPreflight('optimize', config.runner, promptsDir, cwd))) {
    return 1;
  }

  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  if (!existsSync(featureListPath)) {
    logger.error('feature_list.json not found. Run ralph init first.');
    return 1;
  }

  const optimizerPromptPath = path.join(promptsDir, 'optimizer.md');

  const prompt = `Your task instructions are in the file: ${optimizerPromptPath} — read it first.

Then read these files in the current working directory:
- feature_list.json — this is what you will improve
- prd.md — the source of truth (read-only, do NOT modify)

Go through EVERY feature and make each one small, detailed, and testable.
Compare against prd.md to ensure complete coverage.
Write the improved feature_list.json back to disk.
Do NOT create any other files. Do NOT implement any code.`;

  await runner.invoke(prompt, {
    verbose: config.verbose,
    debug: config.debug,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
    stream: config.stream,
    maxTurns: 5,
  });

  // Validate feature_list.json is still valid after optimizer
  try {
    const raw = await readFile(featureListPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.features)) {
      logger.error('feature_list.json is missing .features array after optimization');
      return 1;
    }
    logger.success(`Optimization complete. ${data.features.length} features in list.`);
    return 0;
  } catch {
    logger.error('feature_list.json is invalid JSON after optimization');
    return 1;
  }
}
