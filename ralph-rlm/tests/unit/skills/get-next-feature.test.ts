import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';
import { getNextFeature } from '../../../src/commands/skills/get-next-feature.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-gnf-'));
  filePath = path.join(tmpDir, 'feature_list.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeList(data: ReturnType<typeof createFeatureList>): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

describe('getNextFeature', () => {
  it('returns in_progress first', async () => {
    writeList(createFeatureList({ inProgress: 1, pending: 2 }));

    const result = await getNextFeature(filePath);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ status: 'in_progress' });
  });

  it('returns first pending when no in_progress', async () => {
    writeList(createFeatureList({ pending: 3 }));

    const result = await getNextFeature(filePath);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ status: 'pending', id: 'F001' });
  });

  it('returns ALL_COMPLETE when all complete', async () => {
    writeList(createFeatureList({ complete: 3, pending: 0 }));

    const result = await getNextFeature(filePath);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ result: 'ALL_COMPLETE' });
  });

  it('returns ALL_COMPLETE when complete + blocked only', async () => {
    writeList(createFeatureList({ complete: 2, blocked: 1, pending: 0 }));

    const result = await getNextFeature(filePath);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ result: 'ALL_COMPLETE' });
  });

  it('returns error when file not found', async () => {
    const result = await getNextFeature('/nonexistent/path.json');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
