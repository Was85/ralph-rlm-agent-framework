import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkGit, checkFile, runPreflight } from '../../src/core/preflight.js';

describe('preflight', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'preflight-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('checkGit', () => {
    it('returns true when .git exists', async () => {
      await mkdir(path.join(tmpDir, '.git'));

      const result = await checkGit(tmpDir);

      expect(result).toBe(true);
    });

    it('returns false when .git missing', async () => {
      const result = await checkGit(tmpDir);

      expect(result).toBe(false);
    });
  });

  describe('checkFile', () => {
    it('returns true when file exists', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await writeFile(filePath, 'content', 'utf-8');

      const result = await checkFile(filePath, 'test file');

      expect(result).toBe(true);
    });

    it('returns false when file missing', async () => {
      const filePath = path.join(tmpDir, 'missing.txt');

      const result = await checkFile(filePath, 'missing file');

      expect(result).toBe(false);
    });
  });

  describe('runPreflight', () => {
    it('returns false if git is missing', async () => {
      // tmpDir has no .git directory
      const result = await runPreflight('init', 'claude', path.join(tmpDir, 'prompts'), tmpDir);

      expect(result).toBe(false);
    });
  });
});
