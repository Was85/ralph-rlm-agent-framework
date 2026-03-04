import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';
import { getFeatureStats } from '../../../src/commands/skills/get-feature-stats.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-gfs-'));
  filePath = path.join(tmpDir, 'feature_list.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeList(data: ReturnType<typeof createFeatureList>): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

describe('getFeatureStats', () => {
  it('returns project, config, stats', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const result = await getFeatureStats(filePath);

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('project');
    expect(result.data).toHaveProperty('config');
    expect(result.data).toHaveProperty('stats');
  });

  it('does NOT include features array', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const result = await getFeatureStats(filePath);

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('features');
  });

  it('returns correct stats values', async () => {
    writeList(createFeatureList({ complete: 2, inProgress: 1, pending: 3, blocked: 1 }));

    const result = await getFeatureStats(filePath);

    expect(result.success).toBe(true);
    expect(result.data?.stats.total).toBe(7);
    expect(result.data?.stats.complete).toBe(2);
    expect(result.data?.stats.in_progress).toBe(1);
    expect(result.data?.stats.pending).toBe(3);
    expect(result.data?.stats.blocked).toBe(1);
  });

  it('returns correct config values', async () => {
    writeList(createFeatureList({ pending: 1 }));

    const result = await getFeatureStats(filePath);

    expect(result.success).toBe(true);
    expect(result.data?.config.max_attempts_per_feature).toBe(5);
    expect(result.data?.config.coverage_threshold).toBe(95);
  });

  it('returns error when file not found', async () => {
    const result = await getFeatureStats('/nonexistent/path.json');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
