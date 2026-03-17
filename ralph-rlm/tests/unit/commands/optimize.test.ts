import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOptimize } from '../../../src/commands/optimize.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

vi.mock('../../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function createMockRunner(onInvoke?: (prompt: string) => Promise<void>): Runner {
  return {
    type: 'claude',
    async invoke(prompt: string, _config: RunnerConfig): Promise<number> {
      if (onInvoke) await onInvoke(prompt);
      return 0;
    },
    async checkInstalled(): Promise<boolean> {
      return true;
    },
  };
}

function makeFeatureList(overrides: Partial<FeatureList> = {}): FeatureList {
  return {
    project: 'test',
    config: { max_attempts_per_feature: 5 },
    stats: { total: 2, complete: 0, in_progress: 0, pending: 2, blocked: 0 },
    features: [
      { id: 'F001', description: 'Feature A', status: 'pending', attempts: 0, last_error: null },
      { id: 'F002', description: 'Feature B', status: 'pending', attempts: 0, last_error: null },
    ],
    ...overrides,
  };
}

describe('optimize command', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'optimize-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await mkdir(path.join(tmpDir, '.git'));
    await writeFile(path.join(promptsDir, 'optimizer.md'), '# Optimizer', 'utf-8');
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('invokes runner with optimizer prompt referencing optimizer.md', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList()), 'utf-8');

    let capturedPrompt = '';
    const runner = createMockRunner(async (prompt) => {
      capturedPrompt = prompt;
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(capturedPrompt).toContain('optimizer.md');
  });

  it('returns 1 if feature_list.json does not exist', async () => {
    const runner = createMockRunner();
    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(1);
  });

  it('returns 1 if feature_list.json is invalid after optimizer run', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList()), 'utf-8');

    const runner = createMockRunner(async () => {
      await writeFile(path.join(tmpDir, 'feature_list.json'), 'not json', 'utf-8');
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(1);
  });

  it('returns 0 if feature_list.json is valid after optimizer run', async () => {
    const fl = makeFeatureList();
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    const runner = createMockRunner(async () => {
      fl.features[0]!.acceptance_criteria = ['GET /api/test returns 200'];
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(0);
  });

  it('passes maxTurns 5 to runner config', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList()), 'utf-8');

    let capturedConfig: RunnerConfig | null = null;
    const runner: Runner = {
      type: 'claude',
      async invoke(_prompt: string, config: RunnerConfig): Promise<number> {
        capturedConfig = config;
        return 0;
      },
      async checkInstalled(): Promise<boolean> { return true; },
    };

    await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(capturedConfig?.maxTurns).toBe(5);
  });
});
