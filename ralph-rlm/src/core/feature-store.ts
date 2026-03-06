import { readFile, writeFile } from 'node:fs/promises';
import type { Feature, FeatureList, FeatureStatus } from '../config/types.js';

export async function read(path: string): Promise<FeatureList> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as FeatureList;
}

export async function write(path: string, data: FeatureList): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export function findById(data: FeatureList, id: string): Feature | undefined {
  return data.features.find(f => f.id === id);
}

export function findByStatus(data: FeatureList, status: FeatureStatus): Feature[] {
  return data.features.filter(f => f.status === status);
}
