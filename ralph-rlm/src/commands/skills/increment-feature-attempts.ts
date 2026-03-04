import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import { recalculateStats } from '../../core/stats.js';
import type { SkillResult } from '../../config/types.js';

export async function incrementFeatureAttempts(
  filePath: string,
  featureId: string,
  errorMessage?: string,
): Promise<SkillResult<string>> {
  try {
    await access(filePath);
  } catch {
    return { success: false, error: `Error: ${filePath} not found` };
  }

  const data = await store.read(filePath);
  const feature = store.findById(data, featureId);

  if (!feature) {
    return { success: false, error: `Error: Feature ${featureId} not found` };
  }

  const oldAttempts = feature.attempts ?? 0;
  feature.attempts = oldAttempts + 1;

  if (errorMessage) {
    feature.last_error = errorMessage;
  }

  // Bug 4 fix: recalculate stats after increment
  recalculateStats(data);
  await store.write(filePath, data);

  const maxAttempts = data.config.max_attempts_per_feature ?? 5;
  return {
    success: true,
    data: `Updated attempts for ${featureId} from ${oldAttempts} to ${feature.attempts} (max: ${maxAttempts})`,
  };
}
