import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import { recalculateStats } from '../../core/stats.js';
import type { Feature, AllClaimedResult, SkillResult } from '../../config/types.js';
import { isFeatureReady } from '../../core/scheduler.js';

export async function claimFeature(
  filePath: string,
  teammateName: string,
): Promise<SkillResult<Feature | AllClaimedResult>> {
  try {
    await access(filePath);
  } catch {
    return { success: false, error: `Error: ${filePath} not found` };
  }

  try {
    let result: Feature | AllClaimedResult | null = null;
    await store.lockedUpdate(filePath, (data) => {
      // 1. Check if this teammate already has an in_progress feature (retry scenario)
      const inProgress = store.findByStatus(data, 'in_progress');
      const myInProgress = inProgress.find(f => f.claimed_by === teammateName);

      if (myInProgress) {
        result = myInProgress;
        return;
      }

      const featureMap = new Map(data.features.map(feature => [feature.id, feature]));
      const nextPending = data.features
        .filter(feature => feature.status === 'pending' && (!feature.claimed_by || feature.claimed_by === ''))
        .filter(feature => isFeatureReady(feature, featureMap))
        .sort((a, b) => {
          const byPriority = (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER);
          if (byPriority !== 0) return byPriority;
          return a.id.localeCompare(b.id);
        })[0];

      if (!nextPending) {
        result = { result: 'ALL_CLAIMED' };
        return;
      }

      // 3. Claim it
      nextPending.status = 'in_progress';
      nextPending.claimed_by = teammateName;

      // 4. Recalculate stats
      recalculateStats(data);
      result = nextPending;
    });

    return { success: true, data: result! };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Error: ${errorMsg}` };
  }
}
