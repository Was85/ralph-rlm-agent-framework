import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import * as validationStore from '../core/validation-store.js';
import { VALIDATION_STATE_FILE } from '../config/defaults.js';
import * as logger from '../ui/logger.js';

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export async function runValidate(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('PHASE 2: VALIDATE PRD COVERAGE');
  logger.info('Ensuring all requirements are covered by features...');

  if (!(await runPreflight('validate', config.runner, promptsDir, cwd))) {
    return 1;
  }

  const valStatePath = path.join(cwd, VALIDATION_STATE_FILE);

  // Initialize validation state if not exists
  if (!existsSync(valStatePath)) {
    const initial = validationStore.createInitial();
    initial.status = 'in_progress';
    initial.last_updated = new Date().toISOString();
    await validationStore.write(valStatePath, initial);
  }

  const valPromptPath = path.join(promptsDir, 'validator.md');

  for (let iteration = 0; iteration < config.maxValidateIterations; iteration++) {
    logger.info(`--- Validation Iteration ${iteration + 1} of ${config.maxValidateIterations} ---`);

    const prompt = `Your task instructions are in the file: ${valPromptPath} — also read these files from the current working directory: prd.md, feature_list.json, and validation-state.json. Start by using your Read tool to open all four files, then execute every instruction. CRITICAL CONSTRAINT: You are a VALIDATOR only. You MUST NOT write any application code, create source files, install packages, run build commands, or implement features. Your ONLY job is to verify PRD coverage by mapping requirements to features, identify gaps, add missing features to feature_list.json, and update validation-state.json. If you write any code beyond updating these two JSON files, you are violating your role.`;

    await runner.invoke(prompt, {
      verbose: config.verbose,
      debug: config.debug,
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      stream: config.stream,
    });

    // Check for completion
    if (existsSync(valStatePath)) {
      try {
        const state = await validationStore.read(valStatePath);

        if (validationStore.isComplete(state, config.coverageThreshold)) {
          logger.success(`Validation complete! Coverage: ${state.coverage_percent}%`);
          return 0;
        }

        if (state.status === 'blocked') {
          logger.warning('Validation blocked - human review needed');
          logger.info('Check validation-state.json for details');
          return 2;
        }
      } catch {
        logger.debugLog('Failed to parse validation-state.json', config.verbose);
      }
    }

    if (iteration < config.maxValidateIterations - 1 && config.sleepBetween > 0) {
      logger.info(`Coverage not met. Retrying in ${config.sleepBetween} seconds...`);
      await sleep(config.sleepBetween);
    }
  }

  logger.warning(`Max validation iterations reached (${config.maxValidateIterations})`);
  logger.info('Check validation-state.json for current coverage');
  return 1;
}
