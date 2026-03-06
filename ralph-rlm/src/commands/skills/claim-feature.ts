import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import { recalculateStats } from '../../core/stats.js';
import type { Feature, AllClaimedResult, SkillResult } from '../../config/types.js';

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

      // 2. Find first pending feature not claimed by anyone
      const pending = store.findByStatus(data, 'pending');
      const nextPending = pending.find(f => !f.claimed_by || f.claimed_by === '');

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
