import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { append, ensureExists } from '../../src/core/progress-log.js';

describe('progress-log', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'progress-log-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('append', () => {
    it('creates file if missing', async () => {
      const filePath = path.join(tmpDir, 'progress.txt');

      await append(filePath, 'first entry');

      expect(existsSync(filePath)).toBe(true);
    });

    it('adds timestamped entry', async () => {
      const filePath = path.join(tmpDir, 'progress.txt');

      await append(filePath, 'test entry');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T.+\] test entry\n$/);
    });

    it('preserves existing content', async () => {
      const filePath = path.join(tmpDir, 'progress.txt');
      await writeFile(filePath, 'existing line\n', 'utf-8');

      await append(filePath, 'new entry');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('existing line\n');
      expect(content).toContain('new entry');
    });
  });

  describe('ensureExists', () => {
    it('creates file if missing', async () => {
      const filePath = path.join(tmpDir, 'progress.txt');

      await ensureExists(filePath);

      expect(existsSync(filePath)).toBe(true);
    });

    it('no-ops if file already exists', async () => {
      const filePath = path.join(tmpDir, 'progress.txt');
      await writeFile(filePath, 'already here\n', 'utf-8');

      await ensureExists(filePath);

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('already here\n');
    });
  });
});
