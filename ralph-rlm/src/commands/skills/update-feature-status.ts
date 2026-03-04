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

  const data = await store.read(filePath);
  const feature = store.findById(data, featureId);

  if (!feature) {
    return { success: false, error: `Error: Feature ${featureId} not found` };
  }

  // Idempotent check
  if (feature.status === status) {
    return { success: true, data: `Feature ${featureId} is already '${status}'` };
  }

  const oldStatus = feature.status;
  feature.status = status;

  // Clear last_error when completing
  if (status === 'complete') {
    feature.last_error = null;
  }

  recalculateStats(data);
  await store.write(filePath, data);

  return { success: true, data: `Updated ${featureId} status from "${oldStatus}" to "${status}"` };
}
