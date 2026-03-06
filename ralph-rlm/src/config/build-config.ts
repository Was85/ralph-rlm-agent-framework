import { DEFAULT_CONFIG } from './defaults.js';
import type { RalphConfig } from './types.js';

export function buildConfig(argv: Record<string, unknown>): RalphConfig {
  return {
    runner: (argv['runner'] as RalphConfig['runner']) ?? DEFAULT_CONFIG.runner,
    maxIterations: (argv['maxIterations'] as number) ?? DEFAULT_CONFIG.maxIterations,
    maxValidateIterations: (argv['maxValidateIterations'] as number) ?? DEFAULT_CONFIG.maxValidateIterations,
    coverageThreshold: (argv['coverageThreshold'] as number) ?? DEFAULT_CONFIG.coverageThreshold,
    sleepBetween: (argv['sleepBetween'] as number) ?? DEFAULT_CONFIG.sleepBetween,
    verbose: (argv['verbose'] as boolean) ?? DEFAULT_CONFIG.verbose,
    debug: (argv['debug'] as boolean) ?? DEFAULT_CONFIG.debug,
    dangerouslySkipPermissions: ((argv['dangerouslySkipPermissions'] as boolean) || (argv['allowAllTools'] as boolean)) ?? DEFAULT_CONFIG.dangerouslySkipPermissions,
    stream: (argv['stream'] as boolean) ?? DEFAULT_CONFIG.stream,
    team: (argv['team'] as boolean) ?? DEFAULT_CONFIG.team,
    teammates: (argv['teammates'] as number) ?? DEFAULT_CONFIG.teammates,
    skipReview: (argv['skipReview'] as boolean) ?? DEFAULT_CONFIG.skipReview,
  };
}
