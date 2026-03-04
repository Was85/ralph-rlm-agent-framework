import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TeamOrchestrator } from '../../src/team/team-orchestrator.js';
import type { Runner, RunnerConfig, RunnerType, FeatureList } from '../../src/config/types.js';
import type { WorktreeManager, Worktree, MergeResult } from '../../src/team/worktree-manager.js';
import { DEFAULT_CONFIG, PROGRESS_FILE } from '../../src/config/defaults.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';
import type { RalphConfig } from '../../src/config/types.js';

// --- Mock WorktreeManager ---
class MockWorktreeManager implements WorktreeManager {
  created: string[] = [];
  merged: string[] = [];
  cleanedUp: string[] = [];
  cleanupAllCalled = false;
  mergeResults = new Map<string, MergeResult>();
  revertCalled = false;

  async create(featureId: string, cwd: string): Promise<Worktree> {
    this.created.push(featureId);
    // Use the tmpDir itself as the worktree path (simplifies testing)
    const wtPath = path.join(cwd, '.claude', 'worktrees', `ralph-${featureId}`);
    await mkdir(wtPath, { recursive: true });
    return {
      name: `ralph-${featureId}`,
      path: wtPath,
      branch: `ralph/${featureId}`,
      featureId,
    };
  }

  async merge(worktree: Worktree, _cwd: string): Promise<MergeResult> {
    this.merged.push(worktree.featureId);
    return this.mergeResults.get(worktree.featureId) ?? { success: true, conflicted: false };
  }

  async cleanup(worktree: Worktree, _cwd: string): Promise<void> {
    this.cleanedUp.push(worktree.featureId);
  }

  async cleanupAll(_cwd: string): Promise<void> {
    this.cleanupAllCalled = true;
  }

  async revertLastMerge(_cwd: string): Promise<void> {
    this.revertCalled = true;
  }
}

// --- Mock Runner ---
class MockRunner implements Runner {
  readonly type: RunnerType = 'claude';
  invocations: Array<{ prompt: string; config: RunnerConfig }> = [];
  onInvoke?: (prompt: string, config: RunnerConfig) => Promise<void>;

  async invoke(prompt: string, config: RunnerConfig): Promise<number> {
    this.invocations.push({ prompt, config });
    if (this.onInvoke) await this.onInvoke(prompt, config);
    return 0;
  }

  async checkInstalled(): Promise<boolean> {
    return true;
  }
}

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, sleepBetween: 0, teammates: 3, ...overrides };
}

async function setupEnv(tmpDir: string, promptsDir: string, data: FeatureList): Promise<void> {
  await mkdir(path.join(tmpDir, '.git'));
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2), 'utf-8');
  await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement the feature', 'utf-8');
}

/**
 * Simulate agent completing a feature by updating the worktree's feature_list.json
 */
async function simulateComplete(wtPath: string, featureId: string): Promise<void> {
  const raw = await readFile(path.join(wtPath, 'feature_list.json'), 'utf-8');
  const fl = JSON.parse(raw) as FeatureList;
  const feature = fl.features.find(f => f.id === featureId);
  if (feature) feature.status = 'complete';
  await writeFile(path.join(wtPath, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
}

describe('TeamOrchestrator', () => {
  let tmpDir: string;
  let promptsDir: string;
  let runner: MockRunner;
  let wtManager: MockWorktreeManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'team-orch-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    runner = new MockRunner();
    wtManager = new MockWorktreeManager();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when all features are already complete', async () => {
    const data = createFeatureList({ pending: 0, complete: 3 });
    await setupEnv(tmpDir, promptsDir, data);

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(0);
    expect(runner.invocations).toHaveLength(0);
  });

  it('returns 2 when all remaining features are blocked', async () => {
    const data = createFeatureList({ pending: 0, complete: 1, blocked: 2 });
    await setupEnv(tmpDir, promptsDir, data);

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(2);
    expect(runner.invocations).toHaveLength(0);
  });

  it('returns 1 if preflight fails (no .git)', async () => {
    const data = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2), 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(1);
  });

  it('cleans up orphaned worktrees on startup', async () => {
    const data = createFeatureList({ pending: 0, complete: 1 });
    await setupEnv(tmpDir, promptsDir, data);

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    await orch.run();

    expect(wtManager.cleanupAllCalled).toBe(true);
  });

  it('creates worktrees for each feature in the batch', async () => {
    const data = createFeatureList({ pending: 2 });
    await setupEnv(tmpDir, promptsDir, data);

    runner.onInvoke = async (_prompt, config) => {
      // Simulate agent completing the feature in the worktree
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const inProgress = fl.features.find(f => f.status === 'in_progress');
        if (inProgress) {
          inProgress.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    // Should have created worktrees
    expect(wtManager.created.length).toBeGreaterThanOrEqual(1);
  });

  it('dispatches agents with cwd set to worktree path', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupEnv(tmpDir, promptsDir, data);

    runner.onInvoke = async (_prompt, config) => {
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) {
          target.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
    const firstInvocation = runner.invocations[0]!;
    expect(firstInvocation.config.cwd).toBeDefined();
    expect(firstInvocation.config.cwd).toContain('.claude');
  });

  it('hides other features in worktree feature_list.json', async () => {
    const data = createFeatureList({ pending: 2 });
    await setupEnv(tmpDir, promptsDir, data);

    let worktreeFeatureCount = 0;
    runner.onInvoke = async (_prompt, config) => {
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        // Count how many features are visible (should only be 1 pending/in_progress)
        const actionable = fl.features.filter(f => f.status === 'pending' || f.status === 'in_progress');
        worktreeFeatureCount = actionable.length;
        // Complete the feature
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) {
          target.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5, teammates: 1 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    // Only 1 actionable feature should be visible in worktree
    expect(worktreeFeatureCount).toBe(1);
  });

  it('cleans up worktrees after batch completes', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupEnv(tmpDir, promptsDir, data);

    runner.onInvoke = async (_prompt, config) => {
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) {
          target.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    expect(wtManager.cleanedUp.length).toBeGreaterThanOrEqual(1);
  });

  it('increments attempts and blocks feature after max attempts', async () => {
    const data = createFeatureList({
      pending: 1,
      config: { max_attempts_per_feature: 2 },
    });
    await setupEnv(tmpDir, promptsDir, data);

    // Agent never completes the feature
    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(2); // blocked
    const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(raw) as FeatureList;
    const feature = final.features[0]!;
    expect(feature.status).toBe('blocked');
    expect(feature.attempts).toBe(2);
  });

  it('returns 1 when max iterations reached', async () => {
    const data = createFeatureList({ pending: 3 });
    await setupEnv(tmpDir, promptsDir, data);

    // Agent never completes
    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 2 }), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(1);
  });

  it('handles merge conflicts by reverting feature', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupEnv(tmpDir, promptsDir, data);

    // Agent completes in worktree
    runner.onInvoke = async (_prompt, config) => {
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) {
          target.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    // But merge conflicts
    wtManager.mergeResults.set('F001', { success: false, conflicted: true, error: 'CONFLICT' });

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 2 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    // Feature should be reverted to in_progress or blocked
    const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const final = JSON.parse(raw) as FeatureList;
    const feature = final.features[0]!;
    expect(feature.status).not.toBe('complete');
    expect(feature.attempts).toBeGreaterThan(0);
  });

  it('passes feature-specific prompt to runner', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupEnv(tmpDir, promptsDir, data);

    runner.onInvoke = async (_prompt, config) => {
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) {
          target.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    const prompt = runner.invocations[0]!.prompt;
    expect(prompt).toContain('F001');
    expect(prompt).toContain('implementer.md');
    expect(prompt).toContain('ONLY');
    expect(prompt).toContain('git commit');
  });

  it('logs progress to progress file', async () => {
    const data = createFeatureList({ pending: 1 });
    await setupEnv(tmpDir, promptsDir, data);

    // Agent doesn't complete — logs failure
    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 1 }), promptsDir, tmpDir, wtManager);
    await orch.run();

    const progressPath = path.join(tmpDir, PROGRESS_FILE);
    const progress = await readFile(progressPath, 'utf-8');
    expect(progress).toContain('F001');
  });

  it('respects depends_on ordering across levels', async () => {
    const data = createFeatureList({
      pending: 2,
      dependencies: [
        { featureId: 'F001', dependsOn: [] },
        { featureId: 'F002', dependsOn: ['F001'] },
      ],
    });
    await setupEnv(tmpDir, promptsDir, data);

    const completedOrder: string[] = [];
    runner.onInvoke = async (_prompt, config) => {
      if (config.cwd) {
        const raw = await readFile(path.join(config.cwd, 'feature_list.json'), 'utf-8');
        const fl = JSON.parse(raw) as FeatureList;
        const target = fl.features.find(f => f.status === 'in_progress');
        if (target) {
          completedOrder.push(target.id);
          target.status = 'complete';
          await writeFile(path.join(config.cwd, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
        }
      }
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(0);
    // F001 must be completed before F002
    expect(completedOrder.indexOf('F001')).toBeLessThan(completedOrder.indexOf('F002'));
  });
});
