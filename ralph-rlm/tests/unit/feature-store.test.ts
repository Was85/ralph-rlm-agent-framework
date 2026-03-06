import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { read, write, findById, findByStatus } from '../../src/core/feature-store.js';
import { createFeatureList, createFeature } from '../fixtures/feature-list-factory.js';

describe('feature-store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'feature-store-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('read', () => {
    it('returns parsed FeatureList', async () => {
      const data = createFeatureList({ pending: 2, complete: 1 });
      const filePath = path.join(tmpDir, 'feature_list.json');
      await writeFile(filePath, JSON.stringify(data), 'utf-8');

      const result = await read(filePath);

      expect(result.project).toBe('test-project');
      expect(result.features).toHaveLength(3);
    });

    it('throws on missing file', async () => {
      const filePath = path.join(tmpDir, 'missing.json');

      await expect(read(filePath)).rejects.toThrow();
    });

    it('throws on invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json');
      await writeFile(filePath, '{ not valid json !!!', 'utf-8');

      await expect(read(filePath)).rejects.toThrow();
    });
  });

  describe('write', () => {
    it('creates valid JSON', async () => {
      const data = createFeatureList({ pending: 1 });
      const filePath = path.join(tmpDir, 'feature_list.json');

      await write(filePath, data);

      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.project).toBe('test-project');
      expect(parsed.features).toHaveLength(1);
    });

    it('roundtrips correctly', async () => {
      const data = createFeatureList({ pending: 2, inProgress: 1, complete: 3, blocked: 1 });
      const filePath = path.join(tmpDir, 'feature_list.json');

      await write(filePath, data);
      const result = await read(filePath);

      expect(result).toEqual(data);
    });
  });

  describe('findById', () => {
    it('returns matching feature', () => {
      const data = createFeatureList({ pending: 3 });
      const result = findById(data, 'F001');
      expect(result).toBeDefined();
      expect(result!.id).toBe('F001');
    });

    it('returns undefined for missing id', () => {
      const data = createFeatureList({ pending: 3 });
      const result = findById(data, 'F999');
      expect(result).toBeUndefined();
    });
  });

  describe('findByStatus', () => {
    it('returns matching features', () => {
      const data = createFeatureList({ pending: 2, complete: 3 });
      const result = findByStatus(data, 'complete');
      expect(result).toHaveLength(3);
      result.forEach(f => expect(f.status).toBe('complete'));
    });

    it('returns empty array for no matches', () => {
      const data = createFeatureList({ pending: 3 });
      const result = findByStatus(data, 'blocked');
      expect(result).toHaveLength(0);
    });
  });
});
