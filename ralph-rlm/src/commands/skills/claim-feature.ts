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

  const data = await store.read(filePath);

  // 1. Check if this teammate already has an in_progress feature (retry scenario)
  const inProgress = store.findByStatus(data, 'in_progress');
  const myInProgress = inProgress.find(f => f.claimed_by === teammateName);

  if (myInProgress) {
    return { success: true, data: myInProgress };
  }

  // 2. Find first pending feature not claimed by anyone
  const pending = store.findByStatus(data, 'pending');
  const nextPending = pending.find(f => !f.claimed_by || f.claimed_by === '');

  if (!nextPending) {
    return { success: true, data: { result: 'ALL_CLAIMED' } };
  }

  // 3. Claim it
  nextPending.status = 'in_progress';
  nextPending.claimed_by = teammateName;

  // 4. Recalculate stats and write
  recalculateStats(data);
  await store.write(filePath, data);

  return { success: true, data: nextPending };
}
