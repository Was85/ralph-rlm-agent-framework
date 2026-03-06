import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';
import { updateFeatureStatus } from '../../../src/commands/skills/update-feature-status.js';
import type { FeatureList } from '../../../src/config/types.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-ufs-'));
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

describe('updateFeatureStatus', () => {
  it('updates pending to in_progress', async () => {
    // Factory order: complete(F001), inProgress(F002), pending(F003,F004,F005), blocked(F006)
    writeList(createFeatureList({ pending: 3, inProgress: 1, complete: 1, blocked: 1 }));

    const result = await updateFeatureStatus(filePath, 'F003', 'in_progress');

    expect(result.success).toBe(true);
    const data = readList();
    const feature = data.features.find(f => f.id === 'F003');
    expect(feature?.status).toBe('in_progress');
  });

  it('updates in_progress to complete', async () => {
    // Factory order: inProgress(F001), pending(F002,F003)
    writeList(createFeatureList({ pending: 2, inProgress: 1, complete: 0 }));

    const result = await updateFeatureStatus(filePath, 'F001', 'complete');

    expect(result.success).toBe(true);
    const data = readList();
    const feature = data.features.find(f => f.id === 'F001');
    expect(feature?.status).toBe('complete');
  });

  it('updates to blocked', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const result = await updateFeatureStatus(filePath, 'F001', 'blocked');

    expect(result.success).toBe(true);
    const data = readList();
    const feature = data.features.find(f => f.id === 'F001');
    expect(feature?.status).toBe('blocked');
  });

  it('is idempotent when feature already has target status', async () => {
    // Factory order: complete(F001), pending(F002)
    writeList(createFeatureList({ pending: 1, complete: 1 }));

    const result = await updateFeatureStatus(filePath, 'F001', 'complete');

    expect(result.success).toBe(true);
    expect(result.data).toMatch(/already/i);
  });

  it('clears last_error when status set to complete', async () => {
    // Factory order: pending(F001), blocked(F002) — blocked has last_error
    writeList(createFeatureList({ pending: 1, blocked: 1 }));

    const before = readList();
    const blockedFeature = before.features.find(f => f.status === 'blocked');
    expect(blockedFeature?.last_error).toBeTruthy();

    const result = await updateFeatureStatus(filePath, blockedFeature!.id, 'complete');

    expect(result.success).toBe(true);
    const after = readList();
    const updated = after.features.find(f => f.id === blockedFeature!.id);
    expect(updated?.status).toBe('complete');
    expect(updated?.last_error).toBeNull();
  });

  it('returns error for non-existent feature', async () => {
    writeList(createFeatureList({ pending: 2 }));

    const result = await updateFeatureStatus(filePath, 'F999', 'complete');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('recalculates stats after update', async () => {
    // Factory order: complete(F001), inProgress(F002), pending(F003,F004,F005), blocked(F006)
    writeList(createFeatureList({ pending: 3, inProgress: 1, complete: 1, blocked: 1 }));

    const before = readList();
    expect(before.stats.pending).toBe(3);
    expect(before.stats.complete).toBe(1);

    await updateFeatureStatus(filePath, 'F003', 'complete');

    const after = readList();
    expect(after.stats.complete).toBe(2);
    expect(after.stats.pending).toBe(2);
    expect(after.stats.in_progress).toBe(1);
    expect(after.stats.blocked).toBe(1);
  });

  it('returns error when file not found', async () => {
    const result = await updateFeatureStatus('/nonexistent/path.json', 'F001', 'complete');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
