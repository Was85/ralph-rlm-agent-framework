import { readFile } from 'node:fs/promises';
import type { ValidationState } from '../config/types.js';
import { atomicWriteFile } from './file-lock.js';

export async function read(path: string): Promise<ValidationState> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as ValidationState;
}

export async function write(path: string, state: ValidationState): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(state, null, 2));
}

export function isComplete(state: ValidationState, threshold: number): boolean {
  return state.status === 'complete' || state.coverage_percent >= threshold;
}

export function createInitial(): ValidationState {
  return {
    coverage_percent: 0,
    iteration: 0,
    status: 'not_started',
    gaps: [],
    last_updated: null,
  };
}
