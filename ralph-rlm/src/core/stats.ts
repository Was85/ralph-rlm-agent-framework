import type { FeatureList } from '../config/types.js';

export function recalculateStats(data: FeatureList): void {
  const counts = { complete: 0, in_progress: 0, pending: 0, blocked: 0 };

  for (const feature of data.features) {
    if (feature.status in counts) {
      counts[feature.status]++;
    }
  }

  data.stats = {
    total: data.features.length,
    complete: counts.complete,
    in_progress: counts.in_progress,
    pending: counts.pending,
    blocked: counts.blocked,
  };
}
