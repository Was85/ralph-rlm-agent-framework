import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAuto } from '../../../src/commands/auto.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList, ValidationState } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

// Mock runPreflight so tests don't require the actual CLI binary on the system.
vi.mock('../../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/core/safe-exec.js', () => ({
  gitExec: vi.fn().mockResolvedValue({ stdout: 'abc123\n', stderr: '' }),
  sanitizeCommitMessage: (msg: string) => msg.slice(0, 500),
  safeExecCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, sleepBetween: 0, ...overrides };
}

function createMockRunner(onInvoke?: (prompt: string, iteration: number) => Promise<void>): Runner {
  let callCount = 0;
  return {
    type: 'claude',
    async invoke(prompt: string, _config: RunnerConfig): Promise<number> {
      callCount++;
      if (onInvoke) await onInvoke(prompt, callCount);
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

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'auto-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await mkdir(path.join(tmpDir, '.git'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('skips init if feature_list.json already exists', async () => {
    // Set up feature_list.json already present
    const featureList: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 1, in_progress: 0, pending: 0, blocked: 0 },
      features: [{ id: 'F001', description: 'Done', status: 'complete', attempts: 1, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');
    // Set up validation as already complete
    const valState: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');
    // Need the run prompt
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');

    let invoked = false;
    const runner = createMockRunner(async () => { invoked = true; });

    const result = await runAuto(makeConfig(), promptsDir, runner, tmpDir);

    // All features complete, should return 0
    expect(result).toBe(0);
    // Runner should not be invoked since all features are already complete
    expect(invoked).toBe(false);
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
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');

    const runner = createMockRunner(async () => {
      // Complete the feature
      const fl: FeatureList = {
        project: 'test',
        config: { max_attempts_per_feature: 5 },
        stats: { total: 1, complete: 1, in_progress: 0, pending: 0, blocked: 0 },
        features: [{ id: 'F001', description: 'A', status: 'complete', attempts: 1, last_error: null }],
      };
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    const result = await runAuto(makeConfig({ maxIterations: 3 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });

  it('runs init when feature_list.json is missing', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n', 'utf-8');
    await writeFile(path.join(promptsDir, 'initializer.md'), 'Initialize', 'utf-8');
    await writeFile(path.join(promptsDir, 'validator.md'), 'Validate', 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');

    let invokeCount = 0;
    const runner = createMockRunner(async (_prompt, iter) => {
      invokeCount++;
      if (iter === 1) {
        // Init creates feature_list.json
        const fl: FeatureList = {
          project: 'test',
          config: { max_attempts_per_feature: 5 },
          stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
          features: [{ id: 'F001', description: 'A', status: 'pending', attempts: 0, last_error: null }],
        };
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
      } else if (iter === 2) {
        // Validate sets complete
        const valState: ValidationState = {
          coverage_percent: 100,
          iteration: 1,
          status: 'complete',
          gaps: [],
          last_updated: new Date().toISOString(),
        };
        await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');
      } else {
        // Run completes the feature
        const fl: FeatureList = {
          project: 'test',
          config: { max_attempts_per_feature: 5 },
          stats: { total: 1, complete: 1, in_progress: 0, pending: 0, blocked: 0 },
          features: [{ id: 'F001', description: 'A', status: 'complete', attempts: 1, last_error: null }],
        };
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
      }
    });

    const result = await runAuto(makeConfig({ maxIterations: 3 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(invokeCount).toBe(3); // init + validate + run
  });

  it('calls optimizer loop when optimize flag is true', async () => {
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
    await writeFile(path.join(promptsDir, 'optimizer.md'), '# Optimizer', 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');

    let optimizerPromptSeen = false;
    const runner = createMockRunner(async (prompt) => {
      if (prompt.includes('optimizer.md')) {
        optimizerPromptSeen = true;
      }
      // Complete the feature on run
      const fl: FeatureList = {
        project: 'test',
        config: { max_attempts_per_feature: 5 },
        stats: { total: 1, complete: 1, in_progress: 0, pending: 0, blocked: 0 },
        features: [{ id: 'F001', description: 'A', status: 'complete', attempts: 1, last_error: null }],
      };
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    const result = await runAuto(
      makeConfig({ optimize: true, generations: 1, maxIterations: 1 }),
      promptsDir,
      runner,
      tmpDir,
    );

    expect(result).toBe(0);
    expect(optimizerPromptSeen).toBe(true);
  });
});
