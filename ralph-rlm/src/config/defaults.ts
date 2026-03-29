import type { RalphConfig, FeatureListConfig } from './types.js';

export const DEFAULT_CONFIG: RalphConfig = {
  runner: 'claude',
  maxIterations: 50,
  maxValidateIterations: 10,
  coverageThreshold: 95,
  sleepBetween: 2,
  verbose: false,
  debug: false,
  dangerouslySkipPermissions: false,
  stream: false,
  team: false,
  teammates: 3,
  skipReview: false,
  optimize: false,
};

export const DEFAULT_FEATURE_LIST_CONFIG: FeatureListConfig = {
  max_attempts_per_feature: 5,
  coverage_threshold: 95,
};

export const FEATURE_LIST_FILE = 'feature_list.json';
export const VALIDATION_STATE_FILE = 'validation-state.json';
export const PROGRESS_FILE = 'claude-progress.txt';
export const PRD_FILE = 'prd.md';
export const DEBUG_LOG_FILE = 'ralph-debug.log';
export const RALPH_DIR = '.ralph';
export const RALPH_FEATURES_DIR = 'features';
export const RALPH_RUNTIME_DIR = 'runtime';
export const RALPH_RUNTIME_FEATURES_DIR = 'features';
export const ASSIGNMENT_FILE = 'assignment.json';
export const CONTRACT_FILE = 'contract.json';
export const CONTRACT_REVIEW_FILE = 'contract-review.json';
export const IMPLEMENTATION_REPORT_FILE = 'implementation-report.json';
export const VERIFICATION_REPORT_FILE = 'verification-report.json';
export const POST_MERGE_VERIFICATION_FILE = 'post-merge-verification.json';
export const RUNTIME_SESSION_FILE = 'session-state.json';
export const RUNTIME_EVENTS_FILE = 'events.json';

export const LOCK_STALE_MS = 30_000;
export const LOCK_RETRY_MS = 1_000;
export const LOCK_RETRIES = 30;
