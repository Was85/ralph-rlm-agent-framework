import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runValidate } from '../../../src/commands/validate.js';
import type { RalphConfig, Runner, RunnerConfig, ValidationState } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

// Mock checkCli so tests don't require the actual CLI binary on the system
vi.mock('../../../src/core/preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/core/preflight.js')>('../../../src/core/preflight.js');
  return { ...actual, checkCli: vi.fn().mockResolvedValue(true) };
});

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

async function setupValidateEnv(tmpDir: string, promptsDir: string): Promise<void> {
  await mkdir(path.join(tmpDir, '.git'));
  await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n', 'utf-8');
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify({
    project: 'test',
    config: { max_attempts_per_feature: 5 },
    stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
    features: [{ id: 'F001', description: 'Feature A', status: 'pending', attempts: 0, last_error: null }],
  }, null, 2), 'utf-8');
  await writeFile(path.join(promptsDir, 'validator.md'), 'Validate PRD coverage', 'utf-8');
}

describe('validate command', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'validate-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await setupValidateEnv(tmpDir, promptsDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when validation state shows complete', async () => {
    const runner = createMockRunner(async (_prompt, _iter) => {
      const state: ValidationState = {
        coverage_percent: 100,
        iteration: 1,
        status: 'complete',
        gaps: [],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(state, null, 2), 'utf-8');
    });

    const result = await runValidate(makeConfig({ maxValidateIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });

  it('returns 0 when coverage meets threshold', async () => {
    const runner = createMockRunner(async (_prompt, _iter) => {
      const state: ValidationState = {
        coverage_percent: 96,
        iteration: 1,
        status: 'in_progress',
        gaps: [],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(state, null, 2), 'utf-8');
    });

    const result = await runValidate(makeConfig({ coverageThreshold: 95 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });

  it('returns 2 when validation is blocked', async () => {
    const runner = createMockRunner(async () => {
      const state: ValidationState = {
        coverage_percent: 50,
        iteration: 1,
        status: 'blocked',
        gaps: ['cannot parse requirements'],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(state, null, 2), 'utf-8');
    });

    const result = await runValidate(makeConfig({ maxValidateIterations: 3 }), promptsDir, runner, tmpDir);

    expect(result).toBe(2);
  });

  it('returns 1 when max iterations reached without completion', async () => {
    const runner = createMockRunner(async (_prompt, iter) => {
      const state: ValidationState = {
        coverage_percent: 50,
        iteration: iter,
        status: 'in_progress',
        gaps: ['missing tests'],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(state, null, 2), 'utf-8');
    });

    const result = await runValidate(makeConfig({ maxValidateIterations: 2 }), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('returns 1 if preflight fails', async () => {
    await rm(path.join(tmpDir, '.git'), { recursive: true });
    const runner = createMockRunner();

    const result = await runValidate(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('passes a short prompt that references file paths, not raw content', async () => {
    let capturedPrompt = '';
    const runner = createMockRunner(async (prompt) => {
      capturedPrompt = prompt;
      const state: ValidationState = {
        coverage_percent: 100,
        iteration: 1,
        status: 'complete',
        gaps: [],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(state, null, 2), 'utf-8');
    });

    await runValidate(makeConfig(), promptsDir, runner, tmpDir);

    // Must reference file path, not contain raw prompt content
    expect(capturedPrompt).toContain('validator.md');
    expect(capturedPrompt).toContain('prd.md');
    expect(capturedPrompt).toContain('feature_list.json');
    // Must be short enough for Windows cmd.exe (8191 char limit)
    expect(capturedPrompt.length).toBeLessThan(8000);
    // Must not contain newlines — cmd.exe truncates at line breaks
    expect(capturedPrompt).not.toContain('\n');
  });

  it('creates validation-state.json if it does not exist', async () => {
    const runner = createMockRunner(async () => {
      const state: ValidationState = {
        coverage_percent: 100,
        iteration: 1,
        status: 'complete',
        gaps: [],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(state, null, 2), 'utf-8');
    });

    const result = await runValidate(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });
});
