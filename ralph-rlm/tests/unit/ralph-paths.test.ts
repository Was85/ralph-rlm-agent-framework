import path from 'node:path';
import {
  isSafeFeatureName,
  normalizeSafeFeatureName,
  resolveFeatureDir,
  resolveRalphRoot,
  resolveRuntimeDir,
  resolveRuntimeEventsPath,
  resolveRuntimeFeatureStatePath,
  resolveRuntimeSessionPath,
} from '../../src/core/ralph-paths.js';

describe('ralph-paths', () => {
  it('accepts simple feature names', () => {
    expect(isSafeFeatureName('F001')).toBe(true);
    expect(isSafeFeatureName('feature-cleanup')).toBe(true);
  });

  it('rejects unsafe feature names', () => {
    expect(isSafeFeatureName('')).toBe(false);
    expect(isSafeFeatureName('   ')).toBe(false);
    expect(isSafeFeatureName('a/b')).toBe(false);
    expect(isSafeFeatureName('a\\b')).toBe(false);
    expect(isSafeFeatureName('a:b')).toBe(false);
    expect(isSafeFeatureName('a?b')).toBe(false);
    expect(isSafeFeatureName('a|b')).toBe(false);
    expect(isSafeFeatureName('..')).toBe(false);
  });

  it('normalizes valid feature names and rejects invalid ones', () => {
    expect(normalizeSafeFeatureName('  F001  ')).toBe('F001');
    expect(() => normalizeSafeFeatureName('a/b')).toThrow(/Unsafe feature ID/);
  });

  it('resolves Ralph directories consistently', () => {
    const cwd = path.join('C:', 'repo');
    expect(resolveRalphRoot(cwd)).toBe(path.join(cwd, '.ralph'));
    expect(resolveFeatureDir(cwd, 'F001')).toBe(path.join(cwd, '.ralph', 'features', 'F001'));
    expect(resolveRuntimeDir(cwd)).toBe(path.join(cwd, '.ralph', 'runtime'));
    expect(resolveRuntimeSessionPath(cwd)).toBe(path.join(cwd, '.ralph', 'runtime', 'session-state.json'));
    expect(resolveRuntimeEventsPath(cwd)).toBe(path.join(cwd, '.ralph', 'runtime', 'events.json'));
    expect(resolveRuntimeFeatureStatePath(cwd, 'F001')).toBe(path.join(cwd, '.ralph', 'runtime', 'features', 'F001.json'));
  });
});
