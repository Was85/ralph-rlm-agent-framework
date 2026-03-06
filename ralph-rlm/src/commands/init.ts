import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import * as logger from '../ui/logger.js';

const execAsync = promisify(exec);

export async function runInit(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('PHASE 1: INITIALIZE');
  logger.info('Analyzing PRD and creating feature_list.json...');

  if (!(await runPreflight('init', config.runner, promptsDir, cwd))) {
    return 1;
  }

  // Safety checkpoint via git stash
  try {
    await execAsync('git stash push -m "ralph-pre-init" --include-untracked', { cwd });
  } catch {
    // Stash may fail if nothing to stash — that's fine
  }

  const initPromptPath = path.join(promptsDir, 'initializer.md');

  const prompt = `Your task instructions are in the file: ${initPromptPath} — the project requirements are in prd.md in the current working directory. Start by using your Read tool to open both files, then execute every instruction. CRITICAL CONSTRAINT: You MUST only create feature_list.json and claude-progress.txt. Do NOT write any application code, do NOT create source files, do NOT implement features. All feature statuses MUST be "pending".`;

  logger.info('Running initializer agent...');

  await runner.invoke(prompt, {
    verbose: config.verbose,
    debug: config.debug,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
    stream: config.stream,
  });

  const featureListPath = path.join(cwd, 'feature_list.json');
  if (existsSync(featureListPath)) {
    try {
      const raw = await readFile(featureListPath, 'utf-8');
      const data = JSON.parse(raw);
      const features = Array.isArray(data.features) ? data.features : [];
      const featureCount = features.length;

      // Safety check: all features should be pending after init
      const nonPending = features.filter((f: { status: string }) => f.status !== 'pending');
      if (nonPending.length > 0) {
        logger.warning(`${nonPending.length} feature(s) are not "pending" — init should not implement features. Resetting to pending.`);
        for (const f of features) {
          (f as { status: string }).status = 'pending';
          (f as { attempts: number }).attempts = 0;
        }
        await writeFile(featureListPath, JSON.stringify(data, null, 2), 'utf-8');
      }

      logger.success('Initialization complete!');
      logger.info(`Created ${featureCount} features in feature_list.json`);
      return 0;
    } catch {
      logger.error('feature_list.json created but could not be parsed');
      return 1;
    }
  } else {
    logger.error('Initialization failed - feature_list.json not created');
    return 1;
  }
}
