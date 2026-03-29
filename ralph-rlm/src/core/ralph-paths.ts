import path from 'node:path';
import {
  RALPH_DIR,
  RALPH_FEATURES_DIR,
  RALPH_RUNTIME_DIR,
  RALPH_RUNTIME_FEATURES_DIR,
  RUNTIME_EVENTS_FILE,
  RUNTIME_SESSION_FILE,
} from '../config/defaults.js';

const INVALID_FEATURE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/;

export function isSafeFeatureName(featureId: string): boolean {
  const trimmed = featureId.trim();
  if (!trimmed) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  return !INVALID_FEATURE_NAME_CHARS.test(trimmed)
    && !trimmed.includes(path.sep)
    && !trimmed.includes(path.posix.sep)
    && !trimmed.includes(path.win32.sep);
}

export function normalizeSafeFeatureName(featureId: string): string {
  const trimmed = featureId.trim();
  if (!trimmed) {
    throw new Error('Feature ID cannot be empty');
  }
  if (!isSafeFeatureName(trimmed)) {
    throw new Error(`Unsafe feature ID: ${featureId}`);
  }
  return trimmed;
}

export function resolveRalphRoot(cwd: string): string {
  return path.join(cwd, RALPH_DIR);
}

export function resolveFeatureDir(cwd: string, featureId: string): string {
  return path.join(resolveRalphRoot(cwd), RALPH_FEATURES_DIR, normalizeSafeFeatureName(featureId));
}

export function resolveRuntimeDir(cwd: string): string {
  return path.join(resolveRalphRoot(cwd), RALPH_RUNTIME_DIR);
}

export function resolveRuntimeSessionPath(cwd: string): string {
  return path.join(resolveRuntimeDir(cwd), RUNTIME_SESSION_FILE);
}

export function resolveRuntimeEventsPath(cwd: string): string {
  return path.join(resolveRuntimeDir(cwd), RUNTIME_EVENTS_FILE);
}

export function resolveRuntimeFeaturesDir(cwd: string): string {
  return path.join(resolveRuntimeDir(cwd), RALPH_RUNTIME_FEATURES_DIR);
}

export function resolveRuntimeFeatureStatePath(cwd: string, featureId: string): string {
  return path.join(resolveRuntimeFeaturesDir(cwd), `${normalizeSafeFeatureName(featureId)}.json`);
}
