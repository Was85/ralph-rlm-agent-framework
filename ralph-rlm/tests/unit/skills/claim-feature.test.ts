import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFeatureList, createFeature } from '../../fixtures/feature-list-factory.js';
import { claimFeature } from '../../../src/commands/skills/claim-feature.js';
import type { FeatureList } from '../../../src/config/types.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cf-'));
  filePath = path.join(tmpDir, 'feature_list.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeList(data: FeatureList): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readList(): FeatureList {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('claimFeature', () => {
  it('claims first pending feature', async () => {
    writeList(createFeatureList({ pending: 3 }));

    await claimFeature(filePath, 'implementer-1');

    const data = readList();
    const first = data.features.find(f => f.id === 'F001');
    expect(first?.status).toBe('in_progress');
    expect(first?.claimed_by).toBe('implementer-1');
  });

  it('returns existing in_progress for same teammate (retry)', async () => {
    writeList(createFeatureList({ pending: 2, inProgress: 1, claimedByPrefix: 'implementer' }));

    // The in_progress feature is claimed by implementer-1
    const result = await claimFeature(filePath, 'implementer-1');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ status: 'in_progress', claimed_by: 'implementer-1' });

    // Verify no new feature was claimed — pending count unchanged
    const after = readList();
    const pendingCount = after.features.filter(f => f.status === 'pending').length;
    expect(pendingCount).toBe(2);
  });

  it('returns ALL_CLAIMED when no pending', async () => {
    writeList(createFeatureList({ pending: 0, inProgress: 2, complete: 1 }));

    const result = await claimFeature(filePath, 'implementer-3');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ result: 'ALL_CLAIMED' });
  });

  it('handles feature without claimed_by property', async () => {
    // Build features manually without claimed_by property
    const data: FeatureList = {
      project: 'test-project',
      config: { max_attempts_per_feature: 5, coverage_threshold: 95 },
      stats: { total: 2, complete: 0, in_progress: 0, pending: 2, blocked: 0 },
      features: [
        { id: 'F001', description: 'Feature 1', status: 'pending', attempts: 0, last_error: null },
        { id: 'F002', description: 'Feature 2', status: 'pending', attempts: 0, last_error: null },
      ],
    };
    writeList(data);

    const result = await claimFeature(filePath, 'implementer-1');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ status: 'in_progress', claimed_by: 'implementer-1' });
  });

  it('sets claimed_by when property exists but is empty', async () => {
    const data: FeatureList = {
      project: 'test-project',
      config: { max_attempts_per_feature: 5, coverage_threshold: 95 },
      stats: { total: 2, complete: 0, in_progress: 0, pending: 2, blocked: 0 },
      features: [
        createFeature({ id: 'F001', status: 'pending', claimed_by: '' }),
        createFeature({ id: 'F002', status: 'pending', claimed_by: '' }),
      ],
    };
    writeList(data);

    const result = await claimFeature(filePath, 'implementer-1');

    expect(result.success).toBe(true);
    expect(result.data?.claimed_by).toBe('implementer-1');
  });

  it('recalculates stats after claiming', async () => {
    writeList(createFeatureList({ pending: 3 }));

    await claimFeature(filePath, 'implementer-1');

    const after = readList();
    expect(after.stats.in_progress).toBe(1);
    expect(after.stats.pending).toBe(2);
  });

  it('does not modify other features', async () => {
    writeList(createFeatureList({ pending: 3 }));

    await claimFeature(filePath, 'implementer-1');

    const after = readList();
    const others = after.features.filter(f => f.id !== 'F001');
    expect(others).toHaveLength(2);
    for (const f of others) {
      expect(f.status).toBe('pending');
      expect(f.claimed_by).toBeFalsy();
    }
  });

  it('returns JSON of claimed feature', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const result = await claimFeature(filePath, 'implementer-1');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'F001',
      status: 'in_progress',
      claimed_by: 'implementer-1',
    });
  });

  it('returns error when file not found', async () => {
    const result = await claimFeature('/nonexistent/path.json', 'test');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('successive claims get different features', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const r1 = await claimFeature(filePath, 'implementer-1');
    const r2 = await claimFeature(filePath, 'implementer-2');
    const r3 = await claimFeature(filePath, 'implementer-3');

    const ids = [r1.data?.id, r2.data?.id, r3.data?.id];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it('re-run after adding features picks up new work', async () => {
    // Start with all features complete
    writeList(createFeatureList({ pending: 0, complete: 3 }));

    // Add a new pending feature
    const data = readList();
    data.features.push(createFeature({ id: 'F004', description: 'New feature added later', status: 'pending' }));
    data.stats.pending = 1;
    data.stats.total = 4;
    writeList(data);

    const result = await claimFeature(filePath, 'implementer-1');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'F004',
      status: 'in_progress',
      claimed_by: 'implementer-1',
    });
  });
});
