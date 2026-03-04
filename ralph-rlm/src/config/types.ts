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
  acceptance_criteria?: string[];
  source_requirement?: string;
}

/** Configuration embedded in feature_list.json */
export interface FeatureListConfig {
  max_attempts_per_feature: number;
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
  maxTurns?: number;
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
