import { access } from 'node:fs/promises';
import * as store from '../../core/feature-store.js';
import type { Feature, SkillResult, AllCompleteResult } from '../../config/types.js';
import { selectNextFeature } from '../../core/scheduler.js';

export async function getNextFeature(
  filePath: string,
): Promise<SkillResult<Feature | AllCompleteResult>> {
  try {
    await access(filePath);
  } catch {
    return { success: false, error: `Error: ${filePath} not found` };
  }

  const data = await store.read(filePath);

  const nextFeature = selectNextFeature(data);
  if (nextFeature) {
    return { success: true, data: nextFeature };
  }

  return { success: true, data: { result: 'ALL_COMPLETE' } };
}
