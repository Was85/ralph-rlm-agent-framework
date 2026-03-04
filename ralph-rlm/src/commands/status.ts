import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FeatureList, ValidationState } from '../config/types.js';
import { FEATURE_LIST_FILE, VALIDATION_STATE_FILE, PRD_FILE, PROGRESS_FILE } from '../config/defaults.js';
import * as logger from '../ui/logger.js';

export interface StatusInfo {
  prdExists: boolean;
  featureListExists: boolean;
  features?: {
    total: number;
    complete: number;
    inProgress: number;
    pending: number;
    blocked: number;
    progressPercent: number;
  };
  validationExists: boolean;
  validation?: {
    coverage: number;
    status: string;
  };
  progressLogExists: boolean;
  progressLogLines?: number;
  nextAction: string;
}

export async function runStatus(cwd: string = process.cwd()): Promise<StatusInfo> {
  const info: StatusInfo = {
    prdExists: false,
    featureListExists: false,
    validationExists: false,
    progressLogExists: false,
    nextAction: '',
  };

  // PRD
  info.prdExists = existsSync(path.join(cwd, PRD_FILE));

  // Features
  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  info.featureListExists = existsSync(featureListPath);
  if (info.featureListExists) {
    try {
      const raw = await readFile(featureListPath, 'utf-8');
      const data = JSON.parse(raw) as FeatureList;
      const total = data.features.length;
      const complete = data.features.filter(f => f.status === 'complete').length;
      const inProgress = data.features.filter(f => f.status === 'in_progress').length;
      const pending = data.features.filter(f => f.status === 'pending').length;
      const blocked = data.features.filter(f => f.status === 'blocked').length;
      const progressPercent = total > 0 ? Math.floor((complete / total) * 100) : 0;

      info.features = { total, complete, inProgress, pending, blocked, progressPercent };
    } catch {
      // Parse error
    }
  }

  // Validation
  const valStatePath = path.join(cwd, VALIDATION_STATE_FILE);
  info.validationExists = existsSync(valStatePath);
  if (info.validationExists) {
    try {
      const raw = await readFile(valStatePath, 'utf-8');
      const state = JSON.parse(raw) as ValidationState;
      info.validation = {
        coverage: state.coverage_percent,
        status: state.status,
      };
    } catch {
      // Parse error
    }
  }

  // Progress log
  const progressPath = path.join(cwd, PROGRESS_FILE);
  info.progressLogExists = existsSync(progressPath);
  if (info.progressLogExists) {
    try {
      const raw = await readFile(progressPath, 'utf-8');
      info.progressLogLines = raw.split('\n').filter(line => line.length > 0).length;
    } catch {
      // Read error
    }
  }

  // Next action
  if (!info.prdExists) {
    info.nextAction = 'Create prd.md with your requirements';
  } else if (!info.featureListExists) {
    info.nextAction = 'Run: ralph init';
  } else if (!info.validationExists || (info.validation && info.validation.status !== 'complete')) {
    info.nextAction = 'Run: ralph validate';
  } else if (info.features) {
    const { pending, inProgress, blocked } = info.features;
    if (pending === 0 && inProgress === 0 && blocked === 0) {
      info.nextAction = 'All done!';
    } else if (pending === 0 && inProgress === 0 && blocked > 0) {
      info.nextAction = `${blocked} feature(s) blocked. Fix in feature_list.json, then: ralph run`;
    } else {
      info.nextAction = 'Run: ralph run';
    }
  } else {
    info.nextAction = 'All done!';
  }

  return info;
}

export async function displayStatus(cwd: string = process.cwd()): Promise<void> {
  logger.banner();

  const status = await runStatus(cwd);

  logger.info('PROJECT STATUS');

  if (status.prdExists) {
    logger.success('prd.md exists');
  } else {
    logger.error('prd.md not found');
  }

  if (status.featureListExists && status.features) {
    const f = status.features;
    logger.success('feature_list.json exists');
    logger.info(`  Total: ${f.total}  Complete: ${f.complete}  In Progress: ${f.inProgress}  Pending: ${f.pending}  Blocked: ${f.blocked}`);
    logger.info(`  Progress: ${f.progressPercent}%`);
  } else if (!status.featureListExists) {
    logger.warning('feature_list.json not found (run: ralph init)');
  }

  if (status.validationExists && status.validation) {
    logger.success('validation-state.json exists');
    logger.info(`  Coverage: ${status.validation.coverage}%  Status: ${status.validation.status}`);
  } else if (!status.validationExists) {
    logger.warning('validation-state.json not found (run: ralph validate)');
  }

  if (status.progressLogExists) {
    logger.success(`claude-progress.txt exists (${status.progressLogLines ?? 0} lines)`);
  } else {
    logger.warning('claude-progress.txt not found');
  }

  logger.info(`Next action: ${status.nextAction}`);
}
