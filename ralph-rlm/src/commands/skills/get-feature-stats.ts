import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import type { FeatureListConfig, FeatureListStats, SkillResult } from '../../config/types.js';

export interface FeatureStatsResult {
  project: string;
  config: FeatureListConfig;
  stats: FeatureListStats;
}

export async function getFeatureStats(
  filePath: string,
): Promise<SkillResult<FeatureStatsResult>> {
  try {
    await access(filePath);
  } catch {
    return { success: false, error: `Error: ${filePath} not found` };
  }

  const data = await store.read(filePath);

  return {
    success: true,
    data: {
      project: data.project,
      config: data.config,
      stats: data.stats,
    },
  };
}
