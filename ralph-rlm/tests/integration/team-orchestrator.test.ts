import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TeamOrchestrator } from '../../src/team/team-orchestrator.js';
import type { RalphConfig, Runner, RunnerConfig, RunnerType, FeatureList } from '../../src/config/types.js';
import type { WorktreeManager, Worktree, MergeResult } from '../../src/team/worktree-manager.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

/** Fake runner that records invocations */
class FakeRunner implements Runner {
  readonly type: RunnerType = 'claude';
  invocations: Array<{ prompt: string; config: RunnerConfig }> = [];
  exitCode = 0;
  onInvoke?: (prompt: string, config: RunnerConfig) => Promise<void>;

  async invoke(prompt: string, config: RunnerConfig): Promise<number> {
    this.invocations.push({ prompt, config });
    if (this.onInvoke) await this.onInvoke(prompt, config);
    return this.exitCode;
  }

  async checkInstalled(): Promise<boolean> {
    return true;
  }
}

/** Fake worktree manager that creates local directories */
class FakeWorktreeManager implements WorktreeManager {
  async create(featureId: string, cwd: string): Promise<Worktree> {
    const wtPath = path.join(cwd, '.claude', 'worktrees', `ralph-${featureId}`);
    await mkdir(wtPath, { recursive: true });
    return {
      name: `ralph-${featureId}`,
      path: wtPath,
      branch: `ralph/${featureId}`,
      featureId,
    };
  }

  async merge(_worktree: Worktree, _cwd: string): Promise<MergeResult> {
    return { success: true, conflicted: false };
  }

  async cleanup(_worktree: Worktree, _cwd: string): Promise<void> {}
  async cleanupAll(_cwd: string): Promise<void> {}
  async revertLastMerge(_cwd: string): Promise<void> {}
}

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, maxIterations: 3, sleepBetween: 0, ...overrides };
}

describe('TeamOrchestrator (integration)', () => {
  let tmpDir: string;
  let promptsDir: string;
  let runner: FakeRunner;
  let wtManager: FakeWorktreeManager;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ralph-team-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(path.join(tmpDir, '.git'), { recursive: true });
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement the feature', 'utf-8');
    runner = new FakeRunner();
    wtManager = new FakeWorktreeManager();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when all features are already complete', async () => {
    const data = createFeatureList({ complete: 3, pending: 0 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(0);
    expect(runner.invocations).toHaveLength(0);
  });

  it('returns 2 when only blocked features remain', async () => {
    const data = createFeatureList({ complete: 2, blocked: 1, pending: 0 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(2);
    expect(runner.invocations).toHaveLength(0);
  });

  it('invokes runner with pending features', async () => {
    const data = createFeatureList({ pending: 2 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

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

    const orch = new TeamOrchestrator(runner, makeConfig(), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(0);
    expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
  });

  it('stops after maxIterations', async () => {
    const data = createFeatureList({ pending: 5 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 2 }), promptsDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(1);
  });

  it('passes runner config flags through', async () => {
    const data = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

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

    const config = makeConfig({ verbose: true, dangerouslySkipPermissions: true, stream: true });
    const orch = new TeamOrchestrator(runner, config, promptsDir, tmpDir, wtManager);
    await orch.run();

    const invocation = runner.invocations[0]!;
    expect(invocation.config.verbose).toBe(true);
    expect(invocation.config.dangerouslySkipPermissions).toBe(true);
    expect(invocation.config.stream).toBe(true);
  });
});
