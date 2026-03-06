import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import { recalculateStats } from '../../core/stats.js';
import type { FeatureStatus, SkillResult } from '../../config/types.js';

export async function updateFeatureStatus(
  filePath: string,
  featureId: string,
  status: FeatureStatus,
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

      // Idempotent check
      if (feature.status === status) {
        message = `Feature ${featureId} is already '${status}'`;
        return;
      }

      const oldStatus = feature.status;
      feature.status = status;

      // Clear last_error when completing
      if (status === 'complete') {
        feature.last_error = null;
      }

      recalculateStats(data);
      message = `Updated ${featureId} status from "${oldStatus}" to "${status}"`;
    });

    return { success: true, data: message };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Error: ${errorMsg}` };
  }
}
