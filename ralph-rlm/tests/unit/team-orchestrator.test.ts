import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TeamOrchestrator } from '../../src/team/team-orchestrator.js';
import type { RalphConfig, Runner, FeatureList } from '../../src/config/types.js';
import { DEFAULT_CONFIG, PROGRESS_FILE, RALPH_DIR, RALPH_FEATURES_DIR } from '../../src/config/defaults.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';
import type { FeatureHarnessResult } from '../../src/core/harness-runner.js';
import type { MergeResult, Worktree, WorktreeManager } from '../../src/team/worktree-manager.js';
import { recalculateStats } from '../../src/core/stats.js';

const harnessState = vi.hoisted(() => ({
  queue: [] as FeatureHarnessResult[],
  invocations: [] as Array<{ cwd: string; featureId: string }>,
  onInvoke: undefined as
    | undefined
    | ((options: { cwd: string; feature: { id: string } }) => Promise<void>),
}));

const execState = vi.hoisted(() => ({
  commands: [] as string[],
  failCommands: new Set<string>(),
  gitCalls: [] as Array<{ args: string[]; cwd: string }>,
  changedFilesByCommit: new Map<string, string[]>(),
}));

vi.mock('../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/core/harness-runner.js', () => ({
  runFeatureHarness: vi.fn(async (options: { cwd: string; feature: { id: string } }) => {
    harnessState.invocations.push({ cwd: options.cwd, featureId: options.feature.id });
    if (harnessState.onInvoke) {
      await harnessState.onInvoke(options);
    }
    return harnessState.queue.shift() ?? { outcome: 'approved', summary: 'approved' };
  }),
}));

vi.mock('../../src/core/safe-exec.js', () => ({
  gitExec: vi.fn(async (args: string[], cwd: string) => {
    execState.gitCalls.push({ args: [...args], cwd });
    if (args[0] === 'status' && args[1] === '--porcelain') {
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'show' && args[1] === '--pretty=format:') {
      const commit = args.at(-1) ?? '';
      return { stdout: (execState.changedFilesByCommit.get(commit) ?? []).join('\n'), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  }),
  safeExecCommand: vi.fn(async (command: string) => {
    execState.commands.push(command);
    if (execState.failCommands.has(command)) {
      throw new Error(`command failed: ${command}`);
    }
    return { stdout: '', stderr: '' };
  }),
  sanitizeCommitMessage: vi.fn((message: string) => message),
}));

class MockWorktreeManager implements WorktreeManager {
  created: string[] = [];
  cleaned: string[] = [];
  cleanupAllCalled = false;
  merged: string[] = [];
  reverted: Array<{ cwd: string; mergeCommit: string }> = [];
  mergeResults = new Map<string, MergeResult>();

  async create(featureId: string, cwd: string): Promise<Worktree> {
    this.created.push(featureId);
    const worktreePath = path.join(cwd, '.claude', 'worktrees', `ralph-${featureId}`);
    await mkdir(worktreePath, { recursive: true });
    return {
      name: `ralph-${featureId}`,
      path: worktreePath,
      branch: `ralph/${featureId}`,
      featureId,
    };
  }

  async merge(worktree: Worktree, cwd: string): Promise<MergeResult> {
    this.merged.push(worktree.featureId);
    const sourceDir = path.join(worktree.path, RALPH_DIR, RALPH_FEATURES_DIR, worktree.featureId);
    const targetDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, worktree.featureId);
    if (existsSync(sourceDir)) {
      await mkdir(path.dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    }

    return this.mergeResults.get(worktree.featureId)
      ?? { success: true, conflicted: false, mergeCommit: `merge-${worktree.featureId}` };
  }

  async cleanup(worktree: Worktree): Promise<void> {
    this.cleaned.push(worktree.featureId);
  }

  async cleanupAll(): Promise<void> {
    this.cleanupAllCalled = true;
  }

  async revertLastMerge(cwd: string, mergeCommit: string): Promise<void> {
    this.reverted.push({ cwd, mergeCommit });
  }
}

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, sleepBetween: 0, teammates: 2, ...overrides };
}

function createRunner(): Runner {
  return {
    type: 'claude',
    async invoke(): Promise<number> {
      return 0;
    },
    async checkInstalled(): Promise<boolean> {
      return true;
    },
  };
}

async function setupEnv(tmpDir: string, data: FeatureList): Promise<void> {
  await mkdir(path.join(tmpDir, '.git'));
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2), 'utf-8');
}

async function readFeatureList(tmpDir: string): Promise<FeatureList> {
  const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
  return JSON.parse(raw) as FeatureList;
}

describe('TeamOrchestrator', () => {
  let tmpDir: string;
  let runner: Runner;
  let worktreeManager: MockWorktreeManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'team-orch-'));
    runner = createRunner();
    worktreeManager = new MockWorktreeManager();
    harnessState.queue = [];
    harnessState.invocations = [];
    harnessState.onInvoke = undefined;
    execState.commands = [];
    execState.failCommands.clear();
    execState.gitCalls = [];
    execState.changedFilesByCommit.clear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when all features are already complete', async () => {
    await setupEnv(tmpDir, createFeatureList({ pending: 0, complete: 3 }));

    const orchestrator = new TeamOrchestrator(runner, makeConfig(), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(0);
    expect(harnessState.invocations).toHaveLength(0);
    expect(worktreeManager.cleanupAllCalled).toBe(true);
  });

  it('returns 2 when only blocked features remain', async () => {
    await setupEnv(tmpDir, createFeatureList({ pending: 0, complete: 1, blocked: 2 }));

    const orchestrator = new TeamOrchestrator(runner, makeConfig(), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(2);
    expect(harnessState.invocations).toHaveLength(0);
  });

  it('returns 2 when team mode has no ready work because pending features are deadlocked', async () => {
    const data = createFeatureList({ pending: 1, blocked: 1 });
    data.features[0]!.status = 'blocked';
    data.features[0]!.attempts = 5;
    data.features[0]!.last_error = 'Blocked upstream';
    data.features[1]!.status = 'pending';
    data.features[1]!.depends_on = ['F001'];
    recalculateStats(data);
    await setupEnv(tmpDir, data);

    const orchestrator = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(2);
    expect(harnessState.invocations).toHaveLength(0);
    const runtimeSession = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'), 'utf-8'));
    expect(runtimeSession.status).toBe('blocked');
    expect(runtimeSession.last_summary).toContain('No ready team work remains.');
  });

  it('dispatches multiple ready features without hiding the rest of the backlog', async () => {
    await setupEnv(tmpDir, createFeatureList({ pending: 3 }));
    const actionableCounts: number[] = [];

    harnessState.queue = [
      { outcome: 'approved', summary: 'F001 approved' },
      { outcome: 'approved', summary: 'F002 approved' },
      { outcome: 'approved', summary: 'F003 approved' },
    ];
    harnessState.onInvoke = async ({ cwd, feature }) => {
      const raw = await readFile(path.join(cwd, 'feature_list.json'), 'utf-8');
      const featureList = JSON.parse(raw) as FeatureList;
      actionableCounts.push(featureList.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length);
      const featureDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, feature.id);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'verification-report.json'), '{}', 'utf-8');
    };

    const orchestrator = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(0);
    expect(harnessState.invocations.map(invocation => invocation.featureId)).toEqual(['F001', 'F002', 'F003']);
    expect(actionableCounts).toEqual([3, 3, 1]);
    const final = await readFeatureList(tmpDir);
    expect(final.stats.complete).toBe(3);
    expect(final.stats.pending).toBe(0);
    const runtimeSession = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'), 'utf-8'));
    expect(runtimeSession.status).toBe('completed');
    const featureRuntime = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'features', 'F002.json'), 'utf-8'));
    expect(featureRuntime.status).toBe('completed');
  });

  it('copies harness artifacts back and blocks after max retries', async () => {
    await setupEnv(
      tmpDir,
      createFeatureList({
        pending: 1,
        config: { max_attempts_per_feature: 2 },
      }),
    );

    harnessState.queue = [
      { outcome: 'retry', summary: 'contract too large' },
      { outcome: 'retry', summary: 'contract too large' },
    ];
    harnessState.onInvoke = async ({ cwd, feature }) => {
      const featureDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, feature.id);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'contract-review.json'), '{"feature_id":"F001"}', 'utf-8');
    };

    const orchestrator = new TeamOrchestrator(runner, makeConfig({ maxIterations: 3 }), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(2);
    const final = await readFeatureList(tmpDir);
    expect(final.features[0]?.status).toBe('blocked');
    expect(final.features[0]?.attempts).toBe(2);
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F001', 'contract-review.json'))).toBe(true);
    const featureRuntime = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'features', 'F001.json'), 'utf-8'));
    expect(featureRuntime.status).toBe('blocked');
  });

  it('respects dependency levels even when multiple teammates are available', async () => {
    await setupEnv(
      tmpDir,
      createFeatureList({
        pending: 2,
        dependencies: [
          { featureId: 'F001', dependsOn: [] },
          { featureId: 'F002', dependsOn: ['F001'] },
        ],
      }),
    );
    harnessState.queue = [
      { outcome: 'approved', summary: 'F001 approved' },
      { outcome: 'approved', summary: 'F002 approved' },
    ];

    const orchestrator = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5, teammates: 2 }), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(0);
    expect(harnessState.invocations.map(invocation => invocation.featureId)).toEqual(['F001', 'F002']);
    expect(worktreeManager.created).toEqual(['F001', 'F002']);
  });

  it('increments attempts on merge conflicts', async () => {
    await setupEnv(
      tmpDir,
      createFeatureList({
        pending: 1,
        config: { max_attempts_per_feature: 1 },
      }),
    );
    harnessState.queue = [{ outcome: 'approved', summary: 'ready' }];
    worktreeManager.mergeResults.set('F001', { success: false, conflicted: true, error: 'CONFLICT' });

    const orchestrator = new TeamOrchestrator(runner, makeConfig({ maxIterations: 2 }), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(2);
    const final = await readFeatureList(tmpDir);
    expect(final.features[0]?.status).toBe('blocked');
    expect(final.features[0]?.attempts).toBe(1);
    expect(final.features[0]?.last_error).toContain('CONFLICT');
  });

  it('reverts merged work when verification fails', async () => {
    await setupEnv(
      tmpDir,
      createFeatureList({
        pending: 1,
        config: { test_command: 'npm test', max_attempts_per_feature: 1 },
      }),
    );
    harnessState.queue = [{ outcome: 'approved', summary: 'ready' }];
    execState.failCommands.add('npm test');
    harnessState.onInvoke = async ({ cwd, feature }) => {
      const featureDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, feature.id);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'verification-report.json'), '{}', 'utf-8');
    };

    const orchestrator = new TeamOrchestrator(runner, makeConfig({ maxIterations: 2 }), tmpDir, tmpDir, worktreeManager);
    const result = await orchestrator.run();

    expect(result).toBe(2);
    expect(worktreeManager.reverted).toEqual([{ cwd: tmpDir, mergeCommit: 'merge-F001' }]);
    const final = await readFeatureList(tmpDir);
    expect(final.features[0]?.status).toBe('blocked');
    expect(final.features[0]?.last_error).toContain('Verification failed: npm test');
    const progress = await readFile(path.join(tmpDir, PROGRESS_FILE), 'utf-8');
    expect(progress).toContain('VERIFICATION FAILED for F001');
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F001', 'verification-report.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F001', 'post-merge-verification.json'))).toBe(true);
  });
});
