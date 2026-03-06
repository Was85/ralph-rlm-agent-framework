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

  try {
    let message = '';
    await store.lockedUpdate(filePath, (data) => {
      const feature = store.findById(data, featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      const oldAttempts = feature.attempts ?? 0;
      feature.attempts = oldAttempts + 1;

      if (errorMessage) {
        feature.last_error = errorMessage;
      }

      recalculateStats(data);

      const maxAttempts = data.config.max_attempts_per_feature ?? 5;
      message = `Updated attempts for ${featureId} from ${oldAttempts} to ${feature.attempts} (max: ${maxAttempts})`;
    });

    return { success: true, data: message };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Error: ${errorMsg}` };
  }
}
