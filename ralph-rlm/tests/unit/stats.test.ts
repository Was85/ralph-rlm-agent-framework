import { recalculateStats } from '../../src/core/stats.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';
import type { FeatureList } from '../../src/config/types.js';

describe('recalculateStats', () => {
  it('recalculates stats from actual features', () => {
    const data = createFeatureList({ pending: 2, inProgress: 1, complete: 3, blocked: 1 });
    // Corrupt stats to verify recalculation
    data.stats.complete = 0;
    data.stats.pending = 0;

    recalculateStats(data);

    expect(data.stats.complete).toBe(3);
    expect(data.stats.in_progress).toBe(1);
    expect(data.stats.pending).toBe(2);
    expect(data.stats.blocked).toBe(1);
    expect(data.stats.total).toBe(7);
  });

  it('handles empty features array', () => {
    const data = createFeatureList({ pending: 0 });

    recalculateStats(data);

    expect(data.stats.complete).toBe(0);
    expect(data.stats.in_progress).toBe(0);
    expect(data.stats.pending).toBe(0);
    expect(data.stats.blocked).toBe(0);
    expect(data.stats.total).toBe(0);
  });

  it('creates stats if missing', () => {
    const data = createFeatureList({ pending: 2, complete: 1 });
    // Remove stats entirely
    (data as Record<string, unknown>).stats = undefined as unknown as FeatureList['stats'];

    recalculateStats(data);

    expect(data.stats).toBeDefined();
    expect(data.stats.complete).toBe(1);
    expect(data.stats.pending).toBe(2);
    expect(data.stats.total).toBe(3);
  });

  it('handles mixed statuses correctly', () => {
    const data = createFeatureList({ pending: 1, inProgress: 2, complete: 3, blocked: 4 });

    recalculateStats(data);

    expect(data.stats.pending).toBe(1);
    expect(data.stats.in_progress).toBe(2);
    expect(data.stats.complete).toBe(3);
    expect(data.stats.blocked).toBe(4);
  });

  it('updates total count', () => {
    const data = createFeatureList({ pending: 5, complete: 5 });
    data.stats.total = 0;

    recalculateStats(data);

    expect(data.stats.total).toBe(10);
  });
});
