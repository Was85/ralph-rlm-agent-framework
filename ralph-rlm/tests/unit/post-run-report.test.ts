import { formatPostRunReport } from '../../src/ui/post-run-report.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';

describe('post-run-report', () => {
  describe('formatPostRunReport', () => {
    it('includes summary line with counts', () => {
      const data = createFeatureList({ complete: 3, blocked: 1, pending: 1 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('3 complete');
      expect(text).toContain('1 blocked');
      expect(text).toContain('1 pending');
    });

    it('includes percentage done', () => {
      const data = createFeatureList({ complete: 5, pending: 5 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('50%');
    });

    it('lists completed features', () => {
      const data = createFeatureList({ complete: 2 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('COMPLETED');
      expect(text).toContain('F001');
      expect(text).toContain('F002');
    });

    it('lists blocked features with errors', () => {
      const data = createFeatureList({ blocked: 1 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('BLOCKED');
      expect(text).toContain('Build failed');
    });

    it('lists in-progress features with warning', () => {
      const data = createFeatureList({ inProgress: 1 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('IN-PROGRESS');
      expect(text).toContain('crashed');
    });

    it('omits sections when no features in that status', () => {
      const data = createFeatureList({ complete: 3 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('COMPLETED');
      expect(text).not.toContain('BLOCKED');
      expect(text).not.toContain('IN-PROGRESS');
    });

    it('returns POST-RUN REPORT header', () => {
      const data = createFeatureList({ complete: 1 });
      const lines = formatPostRunReport(data);
      const text = lines.join('\n');
      expect(text).toContain('POST-RUN REPORT');
    });
  });
});
