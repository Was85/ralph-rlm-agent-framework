import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';
import { incrementFeatureAttempts } from '../../../src/commands/skills/increment-feature-attempts.js';
import type { FeatureList } from '../../../src/config/types.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-ifa-'));
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

describe('incrementFeatureAttempts', () => {
  it('increments attempts from 0 to 1', async () => {
    writeList(createFeatureList({ pending: 3 }));

    await incrementFeatureAttempts(filePath, 'F001');

    const data = readList();
    const feature = data.features.find(f => f.id === 'F001');
    expect(feature?.attempts).toBe(1);
  });

  it('increments from existing count', async () => {
    const list = createFeatureList({ pending: 3 });
    list.features[0].attempts = 3;
    writeList(list);

    await incrementFeatureAttempts(filePath, 'F001');

    const data = readList();
    const feature = data.features.find(f => f.id === 'F001');
    expect(feature?.attempts).toBe(4);
  });

  it('stores error message', async () => {
    writeList(createFeatureList({ pending: 3 }));

    await incrementFeatureAttempts(filePath, 'F001', 'Build failed');

    const data = readList();
    const feature = data.features.find(f => f.id === 'F001');
    expect(feature?.last_error).toBe('Build failed');
  });

  it('returns error for non-existent feature', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const result = await incrementFeatureAttempts(filePath, 'F999');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when file not found', async () => {
    const result = await incrementFeatureAttempts('/nonexistent/path.json', 'F001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('Bug 4 fix: recalculates stats after increment', async () => {
    // Create a list with 2 pending features but set stats.pending to 3 (wrong)
    const list = createFeatureList({ pending: 2 });
    list.stats.pending = 3; // intentionally wrong
    writeList(list);

    await incrementFeatureAttempts(filePath, 'F001');

    const data = readList();
    // Stats should now be CORRECT (2 pending) because we recalculate
    expect(data.stats.pending).toBe(2);
  });
});
