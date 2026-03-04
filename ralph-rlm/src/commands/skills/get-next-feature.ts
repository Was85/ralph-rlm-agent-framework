import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import type { Feature, SkillResult, AllCompleteResult } from '../../config/types.js';

export async function getNextFeature(
  filePath: string,
): Promise<SkillResult<Feature | AllCompleteResult>> {
  try {
    await access(filePath);
  } catch {
    return { success: false, error: `Error: ${filePath} not found` };
  }

  const data = await store.read(filePath);

  // 1. Return first in_progress feature (retry scenario)
  const inProgress = store.findByStatus(data, 'in_progress');
  if (inProgress.length > 0) {
    return { success: true, data: inProgress[0] };
  }

  // 2. Return first pending feature
  const pending = store.findByStatus(data, 'pending');
  if (pending.length > 0) {
    return { success: true, data: pending[0] };
  }

  // 3. No features available
  return { success: true, data: { result: 'ALL_COMPLETE' } };
}
