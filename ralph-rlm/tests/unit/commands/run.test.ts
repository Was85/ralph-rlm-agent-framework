import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runImplement } from '../../../src/commands/run.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList } from '../../../src/config/types.js';
import { DEFAULT_CONFIG, PROGRESS_FILE } from '../../../src/config/defaults.js';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';

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

async function setupRunEnv(tmpDir: string, promptsDir: string, featureList: FeatureList): Promise<void> {
  await mkdir(path.join(tmpDir, '.git'));
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');
  await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement the next feature', 'utf-8');
}

/**
 * Helper: simulate what an agent does — find the in_progress feature (set by the framework)
 * and mark it complete. The framework now picks the feature and sets it to in_progress
 * before invoking the runner.
 */
async function simulateAgentComplete(tmpDir: string): Promise<void> {
  const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
  const fl = JSON.parse(raw) as FeatureList;
  const target = fl.features.find(f => f.status === 'in_progress');
  if (target) target.status = 'complete';
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
}

describe('run command', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'run-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when all features are already complete', async () => {
    const data = createFeatureList({ pending: 0, complete: 3 });
    await setupRunEnv(tmpDir, promptsDir, data);
    const runner = createMockRunner();

    const result = await runImplement(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });

  it('returns 2 when all remaining features are blocked', async () => {
    const data = createFeatureList({ pending: 0, complete: 1, blocked: 2 });
    await setupRunEnv(tmpDir, promptsDir, data);
    const runner = createMockRunner();

    const result = await runImplement(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(2);
  });

  it('invokes runner and completes when features become complete', async () => {
    const data = createFeatureList({ pending: 1, complete: 2 });
    await setupRunEnv(tmpDir, promptsDir, data);

    // The framework sets the pending feature to in_progress before invoking runner
    const runner = createMockRunner(async () => {
      await simulateAgentComplete(tmpDir);
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });

  it('returns 1 when max iterations reached', async () => {
    const data = createFeatureList({ pending: 3 });
    await setupRunEnv(tmpDir, promptsDir, data);
    const runner = createMockRunner(); // agent does nothing — feature stays in_progress

    const result = await runImplement(makeConfig({ maxIterations: 2 }), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('returns 2 when remaining features become blocked during loop', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async () => {
      const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      for (const f of fl.features) {
        if (f.status === 'in_progress') {
          f.status = 'blocked';
          f.last_error = 'Build failed';
        }
      }
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(2);
  });

  it('returns 1 if preflight fails', async () => {
    // No .git directory
    const data = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2), 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');
    const runner = createMockRunner();

    const result = await runImplement(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('passes a feature-specific prompt with the assigned feature ID', async () => {
    let capturedPrompt = '';
    const data = createFeatureList({ pending: 1, complete: 2 });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async (prompt) => {
      capturedPrompt = prompt;
      await simulateAgentComplete(tmpDir);
    });

    await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    // Must reference file path
    expect(capturedPrompt).toContain('implementer.md');
    // Must contain the assigned feature ID
    expect(capturedPrompt).toContain('F003');
    // Must enforce git commit in the prompt
    expect(capturedPrompt).toContain('git commit');
    // Must tell agent to implement ONLY this feature
    expect(capturedPrompt).toContain('ONLY');
    // Must be short enough for Windows cmd.exe (8191 char limit)
    expect(capturedPrompt.length).toBeLessThan(8000);
    // Must not contain newlines — cmd.exe truncates at line breaks
    expect(capturedPrompt).not.toContain('\n');
  });

  it('recalculates stats after each iteration', async () => {
    const data = createFeatureList({ pending: 2 });
    await setupRunEnv(tmpDir, promptsDir, data);
    let iterCount = 0;

    const runner = createMockRunner(async () => {
      iterCount++;
      const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      if (iterCount === 1) {
        // Complete the in_progress feature on first iteration
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) target.status = 'complete';
        // Corrupt stats to verify recalculation
        fl.stats.complete = 99;
      } else {
        // Complete the in_progress feature on second iteration
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) target.status = 'complete';
      }
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    // Verify stats were recalculated (not corrupted 99)
    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    expect(final.stats.complete).toBe(2);
    expect(final.stats.pending).toBe(0);
  });

  it('processes one feature at a time across iterations', async () => {
    const data = createFeatureList({ pending: 3 });
    await setupRunEnv(tmpDir, promptsDir, data);
    const completedPerIteration: string[] = [];

    const runner = createMockRunner(async () => {
      const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      // The framework already set one feature to in_progress — complete it
      const target = fl.features.find(f => f.status === 'in_progress');
      if (target) {
        target.status = 'complete';
        completedPerIteration.push(target.id);
      }
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    // Should have taken exactly 3 iterations (one feature per iteration)
    expect(completedPerIteration).toHaveLength(3);
    // Each feature should have been completed in order
    expect(completedPerIteration).toEqual(['F001', 'F002', 'F003']);
  });

  it('framework sets feature to in_progress before invoking runner', async () => {
    const data = createFeatureList({ pending: 2 });
    await setupRunEnv(tmpDir, promptsDir, data);
    const featureStatusDuringInvoke: string[] = [];

    const runner = createMockRunner(async () => {
      const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      // Check that exactly one feature is in_progress (set by framework)
      const inProgress = fl.features.filter(f => f.status === 'in_progress');
      featureStatusDuringInvoke.push(
        ...inProgress.map(f => `${f.id}:in_progress`),
      );
      // Complete the feature
      for (const f of inProgress) {
        f.status = 'complete';
      }
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    // Each iteration should have had exactly one feature in_progress
    expect(featureStatusDuringInvoke).toEqual([
      'F001:in_progress',
      'F002:in_progress',
    ]);
  });

  it('skips verification when no build/test commands configured', async () => {
    // No build_command or test_command in config
    const data = createFeatureList({ pending: 1 });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async () => {
      await simulateAgentComplete(tmpDir);
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    // Feature should remain complete (no revert since no verification commands)
    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    expect(final.features[0]?.status).toBe('complete');
  });

  it('reverts feature to in_progress when verification fails', async () => {
    // Configure a test command that will fail
    const data = createFeatureList({
      pending: 1,
      config: { test_command: 'exit 1' },
    });
    await setupRunEnv(tmpDir, promptsDir, data);
    let iterCount = 0;

    const runner = createMockRunner(async () => {
      iterCount++;
      if (iterCount === 1) {
        // First iteration: complete the feature
        await simulateAgentComplete(tmpDir);
      }
      // On subsequent iterations, feature is in_progress (reverted by verification)
      // Don't change it — let the loop hit max iterations
    });

    const result = await runImplement(makeConfig({ maxIterations: 2 }), promptsDir, runner, tmpDir);

    // Should return 1 (max iterations) because verification keeps failing
    expect(result).toBe(1);

    // Feature should have been reverted to in_progress with incremented attempts
    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    const feature = final.features[0];
    expect(feature?.status).toBe('in_progress');
    expect(feature?.attempts).toBeGreaterThan(0);
    expect(feature?.last_error).toContain('Verification failed');
  });

  it('logs verification results to progress file', async () => {
    // Configure a test command that succeeds
    const data = createFeatureList({
      pending: 1,
      config: { test_command: 'echo ok' },
    });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async () => {
      await simulateAgentComplete(tmpDir);
    });

    await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    // Progress file should exist and contain verification entry
    const progressPath = path.join(tmpDir, PROGRESS_FILE);
    await expect(access(progressPath)).resolves.toBeUndefined();
    const progress = await readFile(progressPath, 'utf-8');
    expect(progress).toContain('VERIFIED');
    expect(progress).toContain('F001');
  });

  it('logs verification failure to progress file', async () => {
    const data = createFeatureList({
      pending: 1,
      config: { test_command: 'exit 1' },
    });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async (_prompt, iter) => {
      if (iter === 1) {
        await simulateAgentComplete(tmpDir);
      }
    });

    await runImplement(makeConfig({ maxIterations: 2 }), promptsDir, runner, tmpDir);

    const progressPath = path.join(tmpDir, PROGRESS_FILE);
    const progress = await readFile(progressPath, 'utf-8');
    expect(progress).toContain('VERIFICATION FAILED');
    expect(progress).toContain('F001');
  });

  it('updates feature_list.json and progress.txt during the loop', async () => {
    const data = createFeatureList({
      pending: 2,
      config: { test_command: 'echo ok' },
    });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async () => {
      await simulateAgentComplete(tmpDir);
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);

    // Feature list should show all complete
    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    expect(final.stats.complete).toBe(2);
    expect(final.stats.pending).toBe(0);

    // Progress file should have entries for both features
    const progressPath = path.join(tmpDir, PROGRESS_FILE);
    const progress = await readFile(progressPath, 'utf-8');
    expect(progress).toContain('F001');
    expect(progress).toContain('F002');
    expect(progress).toContain('VERIFIED');
  });

  it('increments attempts when agent does not complete the feature', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupRunEnv(tmpDir, promptsDir, data);

    // Agent does nothing — feature stays in_progress
    const runner = createMockRunner();

    await runImplement(makeConfig({ maxIterations: 3 }), promptsDir, runner, tmpDir);

    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    const feature = final.features[0];
    // Framework should have incremented attempts each iteration
    expect(feature?.attempts).toBe(3);
    expect(feature?.status).toBe('in_progress');
  });

  it('marks feature as blocked after max attempts', async () => {
    const data = createFeatureList({
      pending: 1,
      config: { max_attempts_per_feature: 2 },
    });
    await setupRunEnv(tmpDir, promptsDir, data);

    // Agent does nothing — feature stays in_progress
    const runner = createMockRunner();

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(2); // blocked

    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    const feature = final.features[0];
    expect(feature?.status).toBe('blocked');
    expect(feature?.attempts).toBe(2);
  });
});
