import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runImplement } from '../../../src/commands/run.js';
import type { RalphConfig, Runner, FeatureList } from '../../../src/config/types.js';
import { DEFAULT_CONFIG, PROGRESS_FILE, RALPH_DIR, RALPH_FEATURES_DIR } from '../../../src/config/defaults.js';
import { createFeatureList } from '../../fixtures/feature-list-factory.js';
import type { FeatureHarnessResult } from '../../../src/core/harness-runner.js';
import type { MergeResult, Worktree, WorktreeManager } from '../../../src/team/worktree-manager.js';
import { recalculateStats } from '../../../src/core/stats.js';

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

vi.mock('../../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/core/harness-runner.js', () => ({
  runFeatureHarness: vi.fn(async (options: { cwd: string; feature: { id: string } }) => {
    harnessState.invocations.push({ cwd: options.cwd, featureId: options.feature.id });
    if (harnessState.onInvoke) {
      await harnessState.onInvoke(options);
    }
    return harnessState.queue.shift() ?? { outcome: 'approved', summary: 'approved' };
  }),
}));

vi.mock('../../../src/core/safe-exec.js', () => ({
  gitExec: vi.fn(async (args: string[], cwd: string) => {
    execState.gitCalls.push({ args: [...args], cwd });
    if (args[0] === 'status' && args[1] === '--porcelain') {
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'show' && args[1] === '--pretty=format:') {
      const commit = args.at(-1) ?? '';
      return { stdout: (execState.changedFilesByCommit.get(commit) ?? []).join('\n'), stderr: '' };
    }
    if (args[0] === 'rev-parse') {
      return { stdout: 'mock-commit\n', stderr: '' };
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
  // Ralph-owned-state commit helper. With the mocked git layer there is
  // never anything to commit (status --porcelain returns ''), so the
  // faithful result is "nothing committed".
  forceAddAndCommit: vi.fn(async () => false),
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
  return { ...DEFAULT_CONFIG, sleepBetween: 0, ...overrides };
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

async function setupRunEnv(tmpDir: string, featureList: FeatureList): Promise<void> {
  await mkdir(path.join(tmpDir, '.git'));
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');
}

async function readFeatureList(tmpDir: string): Promise<FeatureList> {
  const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
  return JSON.parse(raw) as FeatureList;
}

describe('run command', () => {
  let tmpDir: string;
  let runner: Runner;
  let worktreeManager: MockWorktreeManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'run-cmd-'));
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
    await setupRunEnv(tmpDir, createFeatureList({ pending: 0, complete: 3 }));

    const result = await runImplement(makeConfig(), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(0);
    expect(harnessState.invocations).toHaveLength(0);
    expect(worktreeManager.cleanupAllCalled).toBe(true);
  });

  it('returns 2 when all remaining features are blocked', async () => {
    await setupRunEnv(tmpDir, createFeatureList({ pending: 0, complete: 1, blocked: 2 }));

    const result = await runImplement(makeConfig(), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(2);
    expect(harnessState.invocations).toHaveLength(0);
  });

  it('returns 2 when pending work is deadlocked behind blocked dependencies', async () => {
    const data = createFeatureList({ pending: 1, blocked: 1 });
    data.features[0]!.status = 'blocked';
    data.features[0]!.attempts = 5;
    data.features[0]!.last_error = 'Blocked upstream';
    data.features[1]!.status = 'pending';
    data.features[1]!.depends_on = ['F001'];
    recalculateStats(data);
    await setupRunEnv(tmpDir, data);

    const result = await runImplement(makeConfig({ maxIterations: 5 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(2);
    expect(harnessState.invocations).toHaveLength(0);
    const runtimeSession = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'), 'utf-8'));
    expect(runtimeSession.status).toBe('blocked');
    expect(runtimeSession.last_summary).toContain('No ready features remain.');
  });

  it('keeps the full backlog visible in worktrees while processing features sequentially', async () => {
    const data = createFeatureList({ pending: 2 });
    await setupRunEnv(tmpDir, data);
    const actionableCounts: number[] = [];

    harnessState.queue = [
      { outcome: 'approved', summary: 'F001 approved' },
      { outcome: 'approved', summary: 'F002 approved' },
    ];
    harnessState.onInvoke = async ({ cwd, feature }) => {
      const raw = await readFile(path.join(cwd, 'feature_list.json'), 'utf-8');
      const featureList = JSON.parse(raw) as FeatureList;
      actionableCounts.push(featureList.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length);
      const featureDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, feature.id);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'implementation-report.json'), '{}', 'utf-8');
    };

    const result = await runImplement(makeConfig({ maxIterations: 5 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(0);
    expect(harnessState.invocations.map(invocation => invocation.featureId)).toEqual(['F001', 'F002']);
    expect(actionableCounts).toEqual([2, 1]);
    const final = await readFeatureList(tmpDir);
    expect(final.stats.complete).toBe(2);
    expect(final.stats.pending).toBe(0);
    const runtimeSession = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'), 'utf-8'));
    expect(runtimeSession.status).toBe('completed');
    expect(runtimeSession.last_completed_feature_id).toBe('F002');
    const featureRuntime = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'features', 'F001.json'), 'utf-8'));
    expect(featureRuntime.status).toBe('completed');
  });

  it('copies harness artifacts back and increments attempts on retry outcomes', async () => {
    await setupRunEnv(tmpDir, createFeatureList({ pending: 1 }));

    harnessState.queue = [{ outcome: 'retry', summary: 'needs smaller contract' }];
    harnessState.onInvoke = async ({ cwd, feature }) => {
      const featureDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, feature.id);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'contract.json'), '{"feature_id":"F001"}', 'utf-8');
    };

    const result = await runImplement(makeConfig({ maxIterations: 1 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(1);
    const final = await readFeatureList(tmpDir);
    expect(final.features[0]?.status).toBe('in_progress');
    expect(final.features[0]?.attempts).toBe(1);
    expect(final.features[0]?.last_error).toContain('needs smaller contract');
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F001', 'contract.json'))).toBe(true);
    const featureRuntime = JSON.parse(await readFile(path.join(tmpDir, '.ralph', 'runtime', 'features', 'F001.json'), 'utf-8'));
    expect(featureRuntime.status).toBe('retry');
    expect(featureRuntime.last_error).toContain('needs smaller contract');
  });

  it('marks features blocked when the harness blocks them', async () => {
    await setupRunEnv(tmpDir, createFeatureList({ pending: 1 }));
    harnessState.queue = [{ outcome: 'blocked', summary: 'missing external dependency' }];

    const result = await runImplement(makeConfig({ maxIterations: 3 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(2);
    const final = await readFeatureList(tmpDir);
    expect(final.features[0]?.status).toBe('blocked');
    expect(final.features[0]?.attempts).toBe(1);
    expect(final.features[0]?.last_error).toContain('missing external dependency');
  });

  it('reverts merged work when verification fails', async () => {
    await setupRunEnv(
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

    const result = await runImplement(makeConfig({ maxIterations: 2 }), tmpDir, runner, tmpDir, worktreeManager);

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

  it('installs npm dependencies before verification when merged manifests changed', async () => {
    await setupRunEnv(
      tmpDir,
      createFeatureList({
        pending: 1,
        config: { build_command: 'npm run build', test_command: 'npm test' },
      }),
    );
    await writeFile(path.join(tmpDir, 'package.json'), '{"name":"verify-test"}', 'utf-8');
    await writeFile(path.join(tmpDir, 'package-lock.json'), '{"name":"verify-test","lockfileVersion":3}', 'utf-8');
    execState.changedFilesByCommit.set('merge-F001', ['package.json', 'package-lock.json']);
    harnessState.queue = [{ outcome: 'approved', summary: 'ready' }];

    const result = await runImplement(makeConfig({ maxIterations: 2 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(0);
    expect(execState.commands.slice(0, 3)).toEqual(['npm ci', 'npm run build', 'npm test']);
  });

  it('respects dependency ordering across iterations', async () => {
    await setupRunEnv(
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

    const result = await runImplement(makeConfig({ maxIterations: 5 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(0);
    expect(harnessState.invocations.map(invocation => invocation.featureId)).toEqual(['F001', 'F002']);
  });

  it('selects higher priority ready features first', async () => {
    const data = createFeatureList({ pending: 3 });
    data.features.find(feature => feature.id === 'F001')!.priority = 9;
    data.features.find(feature => feature.id === 'F002')!.priority = 2;
    data.features.find(feature => feature.id === 'F003')!.priority = 1;
    await setupRunEnv(tmpDir, data);
    harnessState.queue = [
      { outcome: 'approved', summary: 'F003 approved' },
      { outcome: 'approved', summary: 'F002 approved' },
      { outcome: 'approved', summary: 'F001 approved' },
    ];

    const result = await runImplement(makeConfig({ maxIterations: 5 }), tmpDir, runner, tmpDir, worktreeManager);

    expect(result).toBe(0);
    expect(harnessState.invocations.map(invocation => invocation.featureId)).toEqual(['F003', 'F002', 'F001']);
  });
});
