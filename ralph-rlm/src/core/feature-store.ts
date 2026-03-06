import { readFile } from 'node:fs/promises';
import type { Feature, FeatureList, FeatureStatus } from '../config/types.js';
import { withLock, atomicWriteFile } from './file-lock.js';

export async function read(path: string): Promise<FeatureList> {
  const raw = await readFile(path, 'utf-8');
  const data = JSON.parse(raw) as FeatureList;
  validateSchema(data, path);
  return data;
}

export async function write(path: string, data: FeatureList): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(data, null, 2));
}

/**
 * Reads, mutates, and writes feature_list.json within a file lock.
 * Use this for concurrent access (team mode, skill commands).
 */
export async function lockedUpdate(path: string, fn: (data: FeatureList) => void | Promise<void>): Promise<FeatureList> {
  return withLock(path, async () => {
    const data = await read(path);
    await fn(data);
    await write(path, data);
    return data;
  });
}

export function findById(data: FeatureList, id: string): Feature | undefined {
  return data.features.find(f => f.id === id);
}

export function findByStatus(data: FeatureList, status: FeatureStatus): Feature[] {
  return data.features.filter(f => f.status === status);
}

const VALID_STATUSES = new Set<string>(['pending', 'in_progress', 'complete', 'blocked']);

/**
 * Basic schema validation for feature_list.json to catch corruption early.
 */
function validateSchema(data: unknown, filePath: string): asserts data is FeatureList {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid feature_list.json at ${filePath}: not an object`);
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.features)) {
    throw new Error(`Invalid feature_list.json at ${filePath}: missing features array`);
  }

  if (!obj.config || typeof obj.config !== 'object') {
    throw new Error(`Invalid feature_list.json at ${filePath}: missing config object`);
  }

  for (const feature of obj.features) {
    if (!feature || typeof feature !== 'object') {
      throw new Error(`Invalid feature in ${filePath}: not an object`);
    }
    const f = feature as Record<string, unknown>;
    if (typeof f.id !== 'string' || !f.id) {
      throw new Error(`Invalid feature in ${filePath}: missing id`);
    }
    if (typeof f.status !== 'string' || !VALID_STATUSES.has(f.status)) {
      throw new Error(`Invalid feature ${f.id} in ${filePath}: invalid status "${f.status}"`);
    }
  }
}
