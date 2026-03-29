import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FeatureList, RuntimeSessionState, ValidationState } from '../config/types.js';
import {
  FEATURE_LIST_FILE,
  VALIDATION_STATE_FILE,
  PRD_FILE,
  PROGRESS_FILE,
  RALPH_DIR,
  RALPH_RUNTIME_DIR,
  RUNTIME_SESSION_FILE,
} from '../config/defaults.js';
import * as logger from '../ui/logger.js';

export interface RuntimeStatusInfo {
  runId: string;
  mode: RuntimeSessionState['mode'];
  status: RuntimeSessionState['status'];
  phase: RuntimeSessionState['phase'];
  processId: number | null;
  isStale: boolean;
  updatedAt: string;
  resumedFromRunId: string | null;
  activeFeatureIds: string[];
  lastCompletedFeatureId: string | null;
  summary: string | null;
  recentLessons: string[];
}

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
  runtimeExists: boolean;
  runtime?: RuntimeStatusInfo;
  nextAction: string;
}

export async function runStatus(cwd: string = process.cwd()): Promise<StatusInfo> {
  const info: StatusInfo = {
    prdExists: false,
    featureListExists: false,
    validationExists: false,
    progressLogExists: false,
    runtimeExists: false,
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

  // Runtime session
  const runtimeSessionPath = path.join(cwd, RALPH_DIR, RALPH_RUNTIME_DIR, RUNTIME_SESSION_FILE);
  info.runtimeExists = existsSync(runtimeSessionPath);
  if (info.runtimeExists) {
    try {
      const raw = await readFile(runtimeSessionPath, 'utf-8');
      const runtime = JSON.parse(raw) as RuntimeSessionState;
      const isStale = runtime.status === 'running' && !isRuntimeProcessAlive(runtime.process_id);
      info.runtime = {
        runId: runtime.run_id,
        mode: runtime.mode,
        status: isStale ? 'interrupted' : runtime.status,
        phase: runtime.phase,
        processId: runtime.process_id ?? null,
        isStale,
        updatedAt: runtime.updated_at,
        resumedFromRunId: runtime.resumed_from_run_id,
        activeFeatureIds: runtime.active_feature_ids,
        lastCompletedFeatureId: runtime.last_completed_feature_id,
        summary: isStale
          ? `${runtime.last_summary ?? 'Previous runtime session stopped unexpectedly.'} Last known process is no longer running.`
          : runtime.last_summary,
        recentLessons: runtime.recent_lessons,
      };
    } catch {
      // Parse error
    }
  }

  // Next action
  if (!info.prdExists) {
    info.nextAction = 'Create prd.md with your requirements';
  } else if (!info.featureListExists) {
    info.nextAction = 'Run: ralph init';
  } else if (!info.validationExists || (info.validation && info.validation.status !== 'complete')) {
    info.nextAction = 'Run: ralph validate';
  } else if (info.runtime && (info.runtime.status === 'running' || info.runtime.status === 'interrupted')) {
    const active = info.runtime.activeFeatureIds.length > 0
      ? ` Active: ${info.runtime.activeFeatureIds.join(', ')}.`
      : '';
    info.nextAction = `Resume work: ralph run.${active}`;
  } else if (info.runtime && info.runtime.status === 'blocked') {
    info.nextAction = 'Inspect the blocked runtime summary and feature artifacts, then run: ralph run';
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

  if (status.runtimeExists && status.runtime) {
    logger.success('.ralph/runtime/session-state.json exists');
    logger.info(`  Runtime: ${status.runtime.status} (${status.runtime.mode}, phase ${status.runtime.phase})`);
    if (status.runtime.activeFeatureIds.length > 0) {
      logger.info(`  Active Features: ${status.runtime.activeFeatureIds.join(', ')}`);
    }
    if (status.runtime.lastCompletedFeatureId) {
      logger.info(`  Last Completed: ${status.runtime.lastCompletedFeatureId}`);
    }
    if (status.runtime.resumedFromRunId) {
      logger.info(`  Resumed From: ${status.runtime.resumedFromRunId}`);
    }
    if (status.runtime.summary) {
      logger.info(`  Summary: ${status.runtime.summary}`);
    }
    if (status.runtime.isStale) {
      logger.warning('  Runtime session was marked running, but its recorded process is no longer alive');
    }
  } else if (status.runtimeExists) {
    logger.warning('.ralph/runtime/session-state.json exists but could not be parsed');
  }

  logger.info(`Next action: ${status.nextAction}`);
}

function isRuntimeProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
