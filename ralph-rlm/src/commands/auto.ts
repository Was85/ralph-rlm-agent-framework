import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { FEATURE_LIST_FILE, VALIDATION_STATE_FILE } from '../config/defaults.js';
import * as validationStore from '../core/validation-store.js';
import * as logger from '../ui/logger.js';
import { runInit } from './init.js';
import { runValidate } from './validate.js';
import { runImplement } from './run.js';
import { runOptimizerLoop } from './optimizer-loop.js';

export async function runAuto(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.banner();
  logger.info('Running all phases automatically...');

  // Phase 1: Init (only if feature_list.json doesn't exist)
  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  if (!existsSync(featureListPath)) {
    const initResult = await runInit(config, promptsDir, runner, cwd);
    if (initResult !== 0) {
      logger.error('Initialization failed. Stopping.');
      return initResult;
    }
  } else {
    logger.info('feature_list.json exists, skipping init phase');
  }

  // Phase 2: Validate (only if not already validated)
  const valStatePath = path.join(cwd, VALIDATION_STATE_FILE);
  let needsValidation = true;
  if (existsSync(valStatePath)) {
    try {
      const valState = await validationStore.read(valStatePath);
      if (valState.status === 'complete') {
        needsValidation = false;
      }
    } catch {
      // Parse error — re-run validation
    }
  }

  if (needsValidation) {
    const valResult = await runValidate(config, promptsDir, runner, cwd);
    if (valResult === 2) {
      logger.error('Validation blocked. Human review needed.');
      return 2;
    }
    if (valResult !== 0) {
      logger.warning('Validation incomplete but continuing to implementation...');
    }
  } else {
    logger.info('Validation already complete, skipping validate phase');
  }

  // Phase 3: Implement (with optional optimizer loop)
  if (config.optimize) {
    return runOptimizerLoop(config, promptsDir, runner, cwd);
  }
  return runImplement(config, promptsDir, runner, cwd);
}
