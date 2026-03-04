import { formatProgressBar, formatFeatureTable, formatProgressSnapshot } from '../../src/ui/progress-display.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';

describe('progress-display', () => {
  describe('formatProgressBar', () => {
    it('returns empty bar for 0%', () => {
      const bar = formatProgressBar(0, 40);
      expect(bar).toBe('-'.repeat(40));
    });

    it('returns full bar for 100%', () => {
      const bar = formatProgressBar(100, 40);
      expect(bar).toBe('#'.repeat(40));
    });

    it('returns half bar for 50%', () => {
      const bar = formatProgressBar(50, 40);
      expect(bar).toBe('#'.repeat(20) + '-'.repeat(20));
    });

    it('uses default width of 40', () => {
      const bar = formatProgressBar(25);
      expect(bar).toHaveLength(40);
      expect(bar).toBe('#'.repeat(10) + '-'.repeat(30));
    });
  });

  describe('formatFeatureTable', () => {
    it('formats features into table rows (header + separator + data)', () => {
      const data = createFeatureList({ complete: 1, inProgress: 1, pending: 1 });
      const rows = formatFeatureTable(data.features);
      // 2 header lines + 3 data rows
      expect(rows).toHaveLength(5);
    });

    it('includes header line', () => {
      const data = createFeatureList({ pending: 1 });
      const rows = formatFeatureTable(data.features);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toContain('ID');
      expect(rows[0]).toContain('Status');
    });

    it('truncates long descriptions', () => {
      const data = createFeatureList({ pending: 1 });
      data.features[0]!.description = 'A'.repeat(60);
      const rows = formatFeatureTable(data.features);
      const lastRow = rows[rows.length - 1]!;
      expect(lastRow).toContain('...');
    });

    it('shows claimed_by when present', () => {
      const data = createFeatureList({ inProgress: 1, pending: 0 });
      const rows = formatFeatureTable(data.features);
      // header(2) + 1 data row = row at index 2
      const dataRow = rows[2]!;
      expect(dataRow).toContain('implementer-1');
    });

    it('shows dash for unclaimed features', () => {
      const data = createFeatureList({ pending: 1 });
      const rows = formatFeatureTable(data.features);
      const lastRow = rows[rows.length - 1]!;
      expect(lastRow).toContain('-');
    });
  });

  describe('formatProgressSnapshot', () => {
    it('returns progress string with counts', () => {
      const data = createFeatureList({ complete: 2, inProgress: 1, pending: 3, blocked: 1 });
      const snapshot = formatProgressSnapshot(data);
      expect(snapshot).toContain('2/7');
      expect(snapshot).toContain('complete');
      expect(snapshot).toContain('1 in-progress');
      expect(snapshot).toContain('3 pending');
      expect(snapshot).toContain('1 blocked');
    });

    it('includes percentage', () => {
      const data = createFeatureList({ complete: 5, pending: 5 });
      const snapshot = formatProgressSnapshot(data);
      expect(snapshot).toContain('50%');
    });

    it('shows active workers when features are in-progress', () => {
      const data = createFeatureList({ inProgress: 2, pending: 1 });
      const snapshot = formatProgressSnapshot(data);
      expect(snapshot).toContain('implementer-1');
      expect(snapshot).toContain('implementer-2');
    });
  });
});
