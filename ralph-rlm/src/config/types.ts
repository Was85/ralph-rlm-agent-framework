/** Valid feature statuses */
export type FeatureStatus = 'pending' | 'in_progress' | 'complete' | 'blocked';

/** A single feature in the feature list */
export interface Feature {
  id: string;
  description: string;
  status: FeatureStatus;
  attempts: number;
  last_error: string | null;
  notes?: string;
  claimed_by?: string | null;
  priority?: number;
  acceptance_criteria?: string[];
  verification_steps?: string[];
  source_requirement?: string;
  depends_on?: string[];
  related_files?: string[];
}

/** Configuration embedded in feature_list.json */
export interface FeatureListConfig {
  max_attempts_per_feature: number;
  install_command?: string;
  test_command?: string;
  build_command?: string;
  coverage_threshold?: number;
}

/** Stats block in feature_list.json */
export interface FeatureListStats {
  total_features?: number;
  total?: number;
  complete: number;
  in_progress: number;
  pending: number;
  blocked: number;
}

/** The top-level feature_list.json structure */
export interface FeatureList {
  project: string;
  description?: string;
  created?: string;
  config: FeatureListConfig;
  stats: FeatureListStats;
  features: Feature[];
}

/** Validation state tracking */
export interface ValidationState {
  coverage_percent: number;
  iteration: number;
  status: 'not_started' | 'in_progress' | 'complete' | 'blocked';
  requirements_found?: number;
  requirements_covered?: number;
  gaps: string[];
  features_added?: string[];
  last_updated: string | null;
  notes?: string;
}

/** Supported AI runner types */
export type RunnerType = 'claude' | 'copilot';

/** Configuration for an AI runner */
export interface RunnerConfig {
  verbose: boolean;
  debug: boolean;
  dangerouslySkipPermissions: boolean;
  stream: boolean;
  bare?: boolean;
  settingSources?: string;
  maxTurns?: number;
  cwd?: string;
  /** Timeout in milliseconds for agent invocation. 0 = no timeout. */
  timeout?: number;
}

/** Interface for AI CLI runners */
export interface Runner {
  readonly type: RunnerType;
  invoke(prompt: string, config: RunnerConfig): Promise<number>;
  checkInstalled(): Promise<boolean>;
}

/** Global Ralph configuration (from CLI flags) */
export interface RalphConfig {
  runner: RunnerType;
  maxIterations: number;
  maxValidateIterations: number;
  coverageThreshold: number;
  sleepBetween: number;
  verbose: boolean;
  debug: boolean;
  dangerouslySkipPermissions: boolean;
  stream: boolean;
  team: boolean;
  teammates: number;
  skipReview: boolean;
  optimize: boolean;
}

export interface FeatureAssignment {
  feature_id: string;
  description: string;
  acceptance_criteria: string[];
  verification_steps: string[];
  attempts: number;
  priority: number;
  last_error: string | null;
  source_requirement?: string;
  depends_on: string[];
  related_files: string[];
}

export interface FeatureContract {
  feature_id: string;
  goal: string;
  scope_summary: string;
  planned_changes: string[];
  files_to_touch: string[];
  commands_to_run: string[];
  acceptance_checks: string[];
  commit_message: string;
  risks: string[];
}

export interface ContractReview {
  feature_id: string;
  outcome: 'approved' | 'retry' | 'blocked';
  summary: string;
  findings: string[];
}

export interface ImplementationReport {
  feature_id: string;
  outcome: 'ready_for_review' | 'retry' | 'blocked';
  summary: string;
  commit_sha: string;
  changed_files: string[];
  commands_run: string[];
  verification_results: VerificationCommandResult[];
  notes: string[];
}

export interface VerificationCommandResult {
  command: string;
  status: 'pass' | 'fail' | 'not_run';
  details: string;
}

export interface AcceptanceResult {
  criterion: string;
  status: 'pass' | 'fail' | 'untested';
  notes: string;
}

export interface VerificationReport {
  feature_id: string;
  outcome: 'approved' | 'retry' | 'blocked';
  summary: string;
  findings: string[];
  command_results: VerificationCommandResult[];
  acceptance_results: AcceptanceResult[];
}

export interface PostMergeVerificationReport {
  feature_id: string;
  merge_commit: string | null;
  outcome: 'approved' | 'retry';
  summary: string;
  command_results: VerificationCommandResult[];
}

export type RuntimeMode = 'sequential' | 'team';
export type RuntimeSessionStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'interrupted';
export type RuntimePhase =
  | 'startup'
  | 'preflight'
  | 'select_feature'
  | 'prepare_worktree'
  | 'feature_harness'
  | 'merge'
  | 'post_merge_verification'
  | 'cleanup'
  | 'complete';

export interface RuntimeSessionState {
  version: 1;
  run_id: string;
  process_id: number | null;
  mode: RuntimeMode;
  status: RuntimeSessionStatus;
  phase: RuntimePhase;
  started_at: string;
  updated_at: string;
  resumed_from_run_id: string | null;
  active_feature_ids: string[];
  last_completed_feature_id: string | null;
  last_summary: string | null;
  recent_lessons: string[];
}

export interface RuntimeEvent {
  timestamp: string;
  run_id: string;
  mode: RuntimeMode;
  type:
    | 'session_started'
    | 'feature_selected'
    | 'feature_result'
    | 'merge_result'
    | 'verification_result'
    | 'session_finished'
    | 'session_interrupted';
  phase: RuntimePhase;
  summary: string;
  feature_id?: string;
}

export interface RuntimeFeatureHistoryEntry {
  timestamp: string;
  phase: RuntimePhase;
  outcome: 'active' | 'retry' | 'blocked' | 'approved' | 'merged' | 'completed' | 'failed' | 'interrupted';
  summary: string;
}

export interface RuntimeFeatureState {
  feature_id: string;
  run_id: string;
  updated_at: string;
  attempt: number;
  status: 'active' | 'retry' | 'blocked' | 'approved' | 'merged' | 'completed' | 'failed' | 'interrupted';
  phase: RuntimePhase;
  summary: string | null;
  last_error: string | null;
  worktree_path: string | null;
  branch: string | null;
  merge_commit: string | null;
  artifact_paths: string[];
  command_results: VerificationCommandResult[];
  history: RuntimeFeatureHistoryEntry[];
}

/** Result of a skill command */
export interface SkillResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Special sentinel returned when no more features are available */
export interface AllCompleteResult {
  result: 'ALL_COMPLETE';
}

/** Special sentinel returned when all features are claimed (teams) */
export interface AllClaimedResult {
  result: 'ALL_CLAIMED';
}
