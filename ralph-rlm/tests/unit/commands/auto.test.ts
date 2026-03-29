import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAuto } from '../../../src/commands/auto.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList, ValidationState } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { runInit } from '../../../src/commands/init.js';
import { runValidate } from '../../../src/commands/validate.js';
import { runImplement } from '../../../src/commands/run.js';
import { runOptimize } from '../../../src/commands/optimize.js';

vi.mock('../../../src/commands/init.js', () => ({
  runInit: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../src/commands/validate.js', () => ({
  runValidate: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../src/commands/run.js', () => ({
  runImplement: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../src/commands/optimize.js', () => ({
  runOptimize: vi.fn().mockResolvedValue(0),
}));

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, sleepBetween: 0, ...overrides };
}

function createMockRunner(): Runner {
  return {
    type: 'claude',
    async invoke(_prompt: string, _config: RunnerConfig): Promise<number> {
      return 0;
    },
    async checkInstalled(): Promise<boolean> {
      return true;
    },
  };
}

describe('auto command', () => {
  let tmpDir: string;
  let promptsDir: string;
  let runner: Runner;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'auto-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    runner = createMockRunner();
    await mkdir(promptsDir, { recursive: true });
    vi.mocked(runInit).mockClear();
    vi.mocked(runValidate).mockClear();
    vi.mocked(runImplement).mockClear();
    vi.mocked(runOptimize).mockClear();
    vi.mocked(runInit).mockResolvedValue(0);
    vi.mocked(runValidate).mockResolvedValue(0);
    vi.mocked(runImplement).mockResolvedValue(0);
    vi.mocked(runOptimize).mockResolvedValue(0);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('skips init if feature_list.json already exists', async () => {
    const featureList: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 1, in_progress: 0, pending: 0, blocked: 0 },
      features: [{ id: 'F001', description: 'Done', status: 'complete', attempts: 1, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');

    const valState: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');

    const result = await runAuto(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(runInit).not.toHaveBeenCalled();
    expect(runValidate).not.toHaveBeenCalled();
    expect(runImplement).toHaveBeenCalledOnce();
  });

  it('skips validate if validation-state.json shows complete', async () => {
    const featureList: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
      features: [{ id: 'F001', description: 'A', status: 'pending', attempts: 0, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');

    const valState: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');

    const result = await runAuto(makeConfig({ maxIterations: 3 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(runValidate).not.toHaveBeenCalled();
    expect(runImplement).toHaveBeenCalledOnce();
  });

  it('runs init when feature_list.json is missing', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n', 'utf-8');

    vi.mocked(runInit).mockImplementation(async () => {
      const fl: FeatureList = {
        project: 'test',
        config: { max_attempts_per_feature: 5 },
        stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
        features: [{ id: 'F001', description: 'A', status: 'pending', attempts: 0, last_error: null }],
      };
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
      return 0;
    });

    vi.mocked(runValidate).mockImplementation(async () => {
      const valState: ValidationState = {
        coverage_percent: 100,
        iteration: 1,
        status: 'complete',
        gaps: [],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');
      return 0;
    });

    const result = await runAuto(makeConfig({ maxIterations: 3 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(runInit).toHaveBeenCalledOnce();
    expect(runValidate).toHaveBeenCalledOnce();
    expect(runImplement).toHaveBeenCalledOnce();
  });

  it('calls optimizer before run when optimize flag is true', async () => {
    const featureList: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
      features: [{ id: 'F001', description: 'A', status: 'pending', attempts: 0, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');

    const valState: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');

    const result = await runAuto(makeConfig({ optimize: true, maxIterations: 1 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(runOptimize).toHaveBeenCalledOnce();
    expect(runImplement).toHaveBeenCalledOnce();
    expect(vi.mocked(runOptimize).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runImplement).mock.invocationCallOrder[0],
    );
  });
});
