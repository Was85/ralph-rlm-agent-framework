import { withLock } from '../../src/team/file-lock.js';
import lockfile from 'proper-lockfile';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;
let testFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-unit-'));
  testFile = path.join(tmpDir, 'test.json');
  fs.writeFileSync(testFile, '{}');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('withLock', () => {
  it('acquires lock and runs function', async () => {
    let executed = false;
    await withLock(testFile, async () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  it('returns value from function', async () => {
    const result = await withLock(testFile, async () => 42);
    expect(result).toBe(42);
  });

  it('releases lock after success', async () => {
    await withLock(testFile, async () => 'done');
    // If lock was released, we should be able to acquire it again
    const release = await lockfile.lock(testFile, { stale: 5000 });
    await release();
  });

  it('releases lock after error', async () => {
    const error = new Error('boom');
    await expect(
      withLock(testFile, async () => {
        throw error;
      }),
    ).rejects.toThrow('boom');

    // Lock should be released — acquire again to prove it
    const release = await lockfile.lock(testFile, { stale: 5000 });
    await release();
  });

  it('propagates errors from fn', async () => {
    const error = new Error('test failure');
    await expect(
      withLock(testFile, async () => {
        throw error;
      }),
    ).rejects.toThrow('test failure');
  });
});
