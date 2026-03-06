import { buildConfig } from '../../src/config/build-config.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

describe('buildConfig', () => {
  it('defaults (no flags)', () => {
    const result = buildConfig({});
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('--runner claude', () => {
    const result = buildConfig({ runner: 'claude' });
    expect(result.runner).toBe('claude');
  });

  it('--runner copilot', () => {
    const result = buildConfig({ runner: 'copilot' });
    expect(result.runner).toBe('copilot');
  });

  it('--max-iterations 10', () => {
    const result = buildConfig({ maxIterations: 10 });
    expect(result.maxIterations).toBe(10);
  });

  it('--max-validate-iterations 5', () => {
    const result = buildConfig({ maxValidateIterations: 5 });
    expect(result.maxValidateIterations).toBe(5);
  });

  it('--coverage-threshold 80', () => {
    const result = buildConfig({ coverageThreshold: 80 });
    expect(result.coverageThreshold).toBe(80);
  });

  it('--sleep-between 5', () => {
    const result = buildConfig({ sleepBetween: 5 });
    expect(result.sleepBetween).toBe(5);
  });

  it('--verbose', () => {
    const result = buildConfig({ verbose: true });
    expect(result.verbose).toBe(true);
  });

  it('--debug', () => {
    const result = buildConfig({ debug: true });
    expect(result.debug).toBe(true);
  });

  it('--dangerously-skip-permissions', () => {
    const result = buildConfig({ dangerouslySkipPermissions: true });
    expect(result.dangerouslySkipPermissions).toBe(true);
  });

  it('--allow-all-tools (alias)', () => {
    const result = buildConfig({ allowAllTools: true });
    expect(result.dangerouslySkipPermissions).toBe(true);
  });

  it('both permission flags', () => {
    const result = buildConfig({ allowAllTools: true, dangerouslySkipPermissions: false });
    expect(result.dangerouslySkipPermissions).toBe(true);
  });

  it('--stream', () => {
    const result = buildConfig({ stream: true });
    expect(result.stream).toBe(true);
  });

  it('--team', () => {
    const result = buildConfig({ team: true });
    expect(result.team).toBe(true);
  });

  it('--teammates 5', () => {
    const result = buildConfig({ teammates: 5 });
    expect(result.teammates).toBe(5);
  });

  it('--skip-review', () => {
    const result = buildConfig({ skipReview: true });
    expect(result.skipReview).toBe(true);
  });

  it('all flags at once', () => {
    const result = buildConfig({
      runner: 'copilot',
      maxIterations: 20,
      maxValidateIterations: 3,
      coverageThreshold: 80,
      sleepBetween: 10,
      verbose: true,
      debug: true,
      dangerouslySkipPermissions: true,
      stream: true,
      team: true,
      teammates: 7,
      skipReview: true,
    });

    expect(result.runner).toBe('copilot');
    expect(result.maxIterations).toBe(20);
    expect(result.maxValidateIterations).toBe(3);
    expect(result.coverageThreshold).toBe(80);
    expect(result.sleepBetween).toBe(10);
    expect(result.verbose).toBe(true);
    expect(result.debug).toBe(true);
    expect(result.dangerouslySkipPermissions).toBe(true);
    expect(result.stream).toBe(true);
    expect(result.team).toBe(true);
    expect(result.teammates).toBe(7);
    expect(result.skipReview).toBe(true);
  });
});
