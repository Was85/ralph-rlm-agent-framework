import { withLock } from '../../src/team/file-lock.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import lockfile from 'proper-lockfile';

let tmpDir: string;
let testFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-int-'));
  testFile = path.join(tmpDir, 'counter.json');
  fs.writeFileSync(testFile, JSON.stringify({ count: 0 }));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('withLock integration', () => {
  it('multiple concurrent withLock calls serialize correctly', async () => {
    const increment = () =>
      withLock(testFile, async () => {
        const data = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
        await sleep(10);
        data.count += 1;
        fs.writeFileSync(testFile, JSON.stringify(data));
      });

    // Launch 5 concurrent increments
    await Promise.all([
      increment(),
      increment(),
      increment(),
      increment(),
      increment(),
    ]);

    const final = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
    expect(final.count).toBe(5);
  });

  it('lock is released even on error', async () => {
    await expect(
      withLock(testFile, async () => {
        throw new Error('intentional');
      }),
    ).rejects.toThrow('intentional');

    // Should be able to acquire lock again
    const release = await lockfile.lock(testFile, { stale: 5000 });
    await release();
  });
});
