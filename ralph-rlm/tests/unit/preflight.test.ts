import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkGit, checkFile, runPreflight, isCliAvailable } from '../../src/core/preflight.js';

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

  describe('isCliAvailable', () => {
    it('returns true for a command that exists on PATH (node)', async () => {
      const result = await isCliAvailable('node');

      expect(result).toBe(true);
    });

    it('returns false for a command that does not exist', async () => {
      const result = await isCliAvailable('definitely-not-a-real-command-xyz123');

      expect(result).toBe(false);
    });

    it('resolves a PATH shim that is not a native binary (npm-style .cmd/.sh)', async () => {
      // The npm install path the error hint recommends produces a .cmd shim
      // on Windows (like npm itself). execFile without a shell cannot run
      // .cmd/.bat, so this is the regression that actually matters.
      const isWin = process.platform === 'win32';
      const shimName = 'ralphclishim';
      const shimFile = path.join(tmpDir, isWin ? `${shimName}.cmd` : shimName);
      await writeFile(
        shimFile,
        isWin ? '@echo off\r\necho 1.0.0\r\n' : '#!/bin/sh\necho 1.0.0\n',
        'utf-8',
      );
      if (!isWin) {
        await chmod(shimFile, 0o755);
      }
      const originalPath = process.env.PATH;
      process.env.PATH = `${tmpDir}${path.delimiter}${originalPath ?? ''}`;
      try {
        const result = await isCliAvailable(shimName);

        expect(result).toBe(true);
      } finally {
        process.env.PATH = originalPath;
      }
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
