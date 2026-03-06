import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { read, write, isComplete, createInitial } from '../../src/core/validation-store.js';
import type { ValidationState } from '../../src/config/types.js';

describe('validation-store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'validation-store-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('read', () => {
    it('returns parsed state', async () => {
      const state = createInitial();
      const filePath = path.join(tmpDir, 'validation-state.json');
      await write(filePath, state);

      const result = await read(filePath);

      expect(result.status).toBe('not_started');
      expect(result.coverage_percent).toBe(0);
    });
  });

  describe('write + read roundtrip', () => {
    it('roundtrips correctly', async () => {
      const state: ValidationState = {
        coverage_percent: 85,
        iteration: 3,
        status: 'in_progress',
        gaps: ['missing auth tests'],
        last_updated: '2026-03-02T00:00:00Z',
      };
      const filePath = path.join(tmpDir, 'validation-state.json');

      await write(filePath, state);
      const result = await read(filePath);

      expect(result).toEqual(state);
    });
  });

  describe('isComplete', () => {
    it('returns true when status is complete', () => {
      const state: ValidationState = {
        coverage_percent: 50,
        iteration: 1,
        status: 'complete',
        gaps: [],
        last_updated: null,
      };

      expect(isComplete(state, 95)).toBe(true);
    });

    it('returns true when coverage >= threshold', () => {
      const state: ValidationState = {
        coverage_percent: 96,
        iteration: 1,
        status: 'in_progress',
        gaps: [],
        last_updated: null,
      };

      expect(isComplete(state, 95)).toBe(true);
    });

    it('returns false when below threshold and not complete', () => {
      const state: ValidationState = {
        coverage_percent: 50,
        iteration: 1,
        status: 'in_progress',
        gaps: ['missing tests'],
        last_updated: null,
      };

      expect(isComplete(state, 95)).toBe(false);
    });
  });

  describe('createInitial', () => {
    it('returns correct defaults', () => {
      const state = createInitial();

      expect(state.coverage_percent).toBe(0);
      expect(state.iteration).toBe(0);
      expect(state.status).toBe('not_started');
      expect(state.gaps).toEqual([]);
      expect(state.last_updated).toBeNull();
    });
  });
});
