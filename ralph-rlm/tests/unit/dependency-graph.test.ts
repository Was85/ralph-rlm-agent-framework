import { buildExecutionPlan, hasFileOverlap } from '../../src/team/dependency-graph.js';
import { createFeature } from '../fixtures/feature-list-factory.js';

describe('hasFileOverlap', () => {
  it('returns false when neither feature has related_files', () => {
    const a = createFeature({ id: 'F001' });
    const b = createFeature({ id: 'F002' });
    expect(hasFileOverlap(a, b)).toBe(false);
  });

  it('returns false when only one feature has related_files', () => {
    const a = createFeature({ id: 'F001', related_files: ['src/a.ts'] });
    const b = createFeature({ id: 'F002' });
    expect(hasFileOverlap(a, b)).toBe(false);
  });

  it('returns true when features share a file', () => {
    const a = createFeature({ id: 'F001', related_files: ['src/a.ts', 'src/b.ts'] });
    const b = createFeature({ id: 'F002', related_files: ['src/b.ts', 'src/c.ts'] });
    expect(hasFileOverlap(a, b)).toBe(true);
  });

  it('returns false when features have disjoint files', () => {
    const a = createFeature({ id: 'F001', related_files: ['src/a.ts'] });
    const b = createFeature({ id: 'F002', related_files: ['src/b.ts'] });
    expect(hasFileOverlap(a, b)).toBe(false);
  });

  it('normalizes Windows paths for comparison', () => {
    const a = createFeature({ id: 'F001', related_files: ['src\\services\\Auth.ts'] });
    const b = createFeature({ id: 'F002', related_files: ['src/services/auth.ts'] });
    expect(hasFileOverlap(a, b)).toBe(true);
  });
});

describe('buildExecutionPlan', () => {
  it('returns empty plan for empty features array', () => {
    const plan = buildExecutionPlan([]);
    expect(plan.levels).toHaveLength(0);
    expect(plan.hasCycles).toBe(false);
    expect(plan.cyclicFeatureIds).toHaveLength(0);
  });

  it('ignores complete and blocked features', () => {
    const features = [
      createFeature({ id: 'F001', status: 'complete' }),
      createFeature({ id: 'F002', status: 'blocked' }),
    ];
    const plan = buildExecutionPlan(features);
    expect(plan.levels).toHaveLength(0);
  });

  it('puts all features in level 0 when no dependencies', () => {
    const features = [
      createFeature({ id: 'F001', status: 'pending' }),
      createFeature({ id: 'F002', status: 'pending' }),
      createFeature({ id: 'F003', status: 'pending' }),
    ];
    const plan = buildExecutionPlan(features);
    expect(plan.levels).toHaveLength(1);
    expect(plan.levels[0]!.level).toBe(0);
    expect(plan.levels[0]!.featureIds).toEqual(['F001', 'F002', 'F003']);
  });

  it('creates chain of levels from linear dependencies', () => {
    const features = [
      createFeature({ id: 'F001', status: 'pending' }),
      createFeature({ id: 'F002', status: 'pending', depends_on: ['F001'] }),
      createFeature({ id: 'F003', status: 'pending', depends_on: ['F002'] }),
    ];
    const plan = buildExecutionPlan(features);
    expect(plan.levels).toHaveLength(3);
    expect(plan.levels[0]!.featureIds).toEqual(['F001']);
    expect(plan.levels[1]!.featureIds).toEqual(['F002']);
    expect(plan.levels[2]!.featureIds).toEqual(['F003']);
    expect(plan.hasCycles).toBe(false);
  });

  it('groups independent features at the same level', () => {
    const features = [
      createFeature({ id: 'F001', status: 'pending' }),
      createFeature({ id: 'F002', status: 'pending' }),
      createFeature({ id: 'F003', status: 'pending', depends_on: ['F001', 'F002'] }),
    ];
    const plan = buildExecutionPlan(features);
    expect(plan.levels).toHaveLength(2);
    expect(plan.levels[0]!.featureIds).toEqual(['F001', 'F002']);
    expect(plan.levels[1]!.featureIds).toEqual(['F003']);
  });

  it('splits level by file overlap into sub-levels', () => {
    const features = [
      createFeature({ id: 'F001', status: 'pending', related_files: ['src/shared.ts'] }),
      createFeature({ id: 'F002', status: 'pending', related_files: ['src/shared.ts'] }),
      createFeature({ id: 'F003', status: 'pending', related_files: ['src/other.ts'] }),
    ];
    const plan = buildExecutionPlan(features);
    // F001 and F002 conflict, F003 is independent
    // Should be at least 2 sub-levels: one with F001+F003, one with F002 (or similar)
    expect(plan.levels.length).toBeGreaterThanOrEqual(2);

    // All features should be present across all levels
    const allIds = plan.levels.flatMap(l => l.featureIds).sort();
    expect(allIds).toEqual(['F001', 'F002', 'F003']);

    // F001 and F002 should NOT be in the same level
    for (const level of plan.levels) {
      const hasF001 = level.featureIds.includes('F001');
      const hasF002 = level.featureIds.includes('F002');
      expect(hasF001 && hasF002).toBe(false);
    }
  });

  it('detects cycles and excludes cyclic features', () => {
    const features = [
      createFeature({ id: 'F001', status: 'pending', depends_on: ['F002'] }),
      createFeature({ id: 'F002', status: 'pending', depends_on: ['F001'] }),
      createFeature({ id: 'F003', status: 'pending' }),
    ];
    const plan = buildExecutionPlan(features);
    expect(plan.hasCycles).toBe(true);
    expect(plan.cyclicFeatureIds.sort()).toEqual(['F001', 'F002']);
    // F003 should still be planned
    expect(plan.levels).toHaveLength(1);
    expect(plan.levels[0]!.featureIds).toEqual(['F003']);
  });

  it('handles mixed dependencies and file overlap', () => {
    const features = [
      createFeature({ id: 'F001', status: 'pending', related_files: ['src/a.ts'] }),
      createFeature({ id: 'F002', status: 'pending', related_files: ['src/a.ts'] }),
      createFeature({ id: 'F003', status: 'pending', depends_on: ['F001'] }),
    ];
    const plan = buildExecutionPlan(features);
    // F001 and F002 at level 0 but split by overlap
    // F003 at level 1 (depends on F001)
    const allIds = plan.levels.flatMap(l => l.featureIds).sort();
    expect(allIds).toEqual(['F001', 'F002', 'F003']);

    // F003 must come after F001
    const f001Level = plan.levels.findIndex(l => l.featureIds.includes('F001'));
    const f003Level = plan.levels.findIndex(l => l.featureIds.includes('F003'));
    expect(f003Level).toBeGreaterThan(f001Level);
  });

  it('includes in_progress features in the plan', () => {
    const features = [
      createFeature({ id: 'F001', status: 'in_progress' }),
      createFeature({ id: 'F002', status: 'pending' }),
    ];
    const plan = buildExecutionPlan(features);
    const allIds = plan.levels.flatMap(l => l.featureIds).sort();
    expect(allIds).toEqual(['F001', 'F002']);
  });

  it('ignores depends_on references to non-actionable features', () => {
    const features = [
      createFeature({ id: 'F001', status: 'complete' }),
      createFeature({ id: 'F002', status: 'pending', depends_on: ['F001'] }),
    ];
    const plan = buildExecutionPlan(features);
    // F001 is complete, so F002 has no blocking deps
    expect(plan.levels).toHaveLength(1);
    expect(plan.levels[0]!.featureIds).toEqual(['F002']);
  });

  it('excludes pending features whose dependencies are blocked', () => {
    const features = [
      createFeature({ id: 'F001', status: 'blocked' }),
      createFeature({ id: 'F002', status: 'pending', depends_on: ['F001'] }),
    ];

    const plan = buildExecutionPlan(features);

    expect(plan.levels).toHaveLength(0);
  });
});
