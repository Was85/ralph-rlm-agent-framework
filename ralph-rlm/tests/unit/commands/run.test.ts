import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runImplement } from '../../../src/commands/run.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';

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

    const runner = createMockRunner(async (_prompt, _iter) => {
      // Simulate completing the pending feature
      const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      for (const f of fl.features) {
        if (f.status === 'pending') f.status = 'complete';
      }
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
  });

  it('returns 1 when max iterations reached', async () => {
    const data = createFeatureList({ pending: 3 });
    await setupRunEnv(tmpDir, promptsDir, data);
    const runner = createMockRunner(); // features stay pending

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
        if (f.status === 'pending') {
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

  it('passes a short prompt that references the implementer file path', async () => {
    let capturedPrompt = '';
    const data = createFeatureList({ pending: 1, complete: 2 });
    await setupRunEnv(tmpDir, promptsDir, data);

    const runner = createMockRunner(async (prompt) => {
      capturedPrompt = prompt;
      // Simulate completing the pending feature
      const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
      const fl = JSON.parse(raw) as FeatureList;
      for (const f of fl.features) {
        if (f.status === 'pending') f.status = 'complete';
      }
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    });

    await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    // Must reference file path, not contain raw prompt content
    expect(capturedPrompt).toContain('implementer.md');
    // Must enforce git commit in the prompt
    expect(capturedPrompt).toContain('git commit');
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
      if (iterCount === 1) {
        // Complete one feature on first iteration
        const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const pending = fl.features.find(f => f.status === 'pending');
        if (pending) pending.status = 'complete';
        // Corrupt stats to verify recalculation
        fl.stats.complete = 99;
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
      } else {
        // Complete remaining on second iteration
        const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        for (const f of fl.features) {
          if (f.status === 'pending') f.status = 'complete';
        }
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
      }
    });

    const result = await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    // Verify stats were recalculated (not corrupted 99)
    const finalRaw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as FeatureList;
    expect(final.stats.complete).toBe(2);
    expect(final.stats.pending).toBe(0);
  });
});
