import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TeamOrchestrator } from '../../src/team/team-orchestrator.js';
import type { RalphConfig, Runner, FeatureList } from '../../src/config/types.js';
import type { MergeResult, Worktree, WorktreeManager } from '../../src/team/worktree-manager.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';
import { DEFAULT_CONFIG, PROGRESS_FILE, RALPH_DIR, RALPH_FEATURES_DIR } from '../../src/config/defaults.js';
import type { FeatureHarnessResult } from '../../src/core/harness-runner.js';

const harnessState = vi.hoisted(() => ({
  queue: [] as FeatureHarnessResult[],
  onInvoke: undefined as
    | undefined
    | ((options: { cwd: string; feature: { id: string } }) => Promise<void>),
}));

vi.mock('../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/core/harness-runner.js', () => ({
  runFeatureHarness: vi.fn(async (options: { cwd: string; feature: { id: string } }) => {
    if (harnessState.onInvoke) {
      await harnessState.onInvoke(options);
    }
    return harnessState.queue.shift() ?? { outcome: 'approved', summary: 'approved' };
  }),
}));

vi.mock('../../src/core/safe-exec.js', () => ({
  gitExec: vi.fn(async () => ({ stdout: '', stderr: '' })),
  safeExecCommand: vi.fn(async () => ({ stdout: '', stderr: '' })),
  sanitizeCommitMessage: vi.fn((message: string) => message),
}));

class FakeRunner implements Runner {
  readonly type = 'claude' as const;

  async invoke(): Promise<number> {
    return 0;
  }

  async checkInstalled(): Promise<boolean> {
    return true;
  }
}

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

  async merge(worktree: Worktree, cwd: string): Promise<MergeResult> {
    const sourceDir = path.join(worktree.path, RALPH_DIR, RALPH_FEATURES_DIR, worktree.featureId);
    const targetDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, worktree.featureId);
    if (existsSync(sourceDir)) {
      await mkdir(path.dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    }
    return { success: true, conflicted: false, mergeCommit: `merge-${worktree.featureId}` };
  }

  async cleanup(): Promise<void> {}
  async cleanupAll(): Promise<void> {}
  async revertLastMerge(): Promise<void> {}
}

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, maxIterations: 3, sleepBetween: 0, teammates: 2, ...overrides };
}

describe('TeamOrchestrator (integration)', () => {
  let tmpDir: string;
  let runner: FakeRunner;
  let wtManager: FakeWorktreeManager;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ralph-team-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(path.join(tmpDir, '.git'), { recursive: true });
    runner = new FakeRunner();
    wtManager = new FakeWorktreeManager();
    harnessState.queue = [];
    harnessState.onInvoke = undefined;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('completes batches and persists progress artifacts', async () => {
    const data = createFeatureList({ pending: 2 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    harnessState.queue = [
      { outcome: 'approved', summary: 'F001 approved' },
      { outcome: 'approved', summary: 'F002 approved' },
    ];
    harnessState.onInvoke = async ({ cwd, feature }) => {
      const featureDir = path.join(cwd, RALPH_DIR, RALPH_FEATURES_DIR, feature.id);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'verification-report.json'), '{}', 'utf-8');
    };

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 5 }), tmpDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(0);
    const final = JSON.parse(await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8')) as FeatureList;
    expect(final.stats.complete).toBe(2);
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F001', 'verification-report.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F002', 'verification-report.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F001', 'post-merge-verification.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, RALPH_DIR, RALPH_FEATURES_DIR, 'F002', 'post-merge-verification.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, '.ralph', 'runtime', 'events.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, '.ralph', 'runtime', 'features', 'F001.json'))).toBe(true);
  });

  it('stops after maxIterations when the harness keeps retrying', async () => {
    const data = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));
    harnessState.queue = [{ outcome: 'retry', summary: 'needs retry' }];

    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 1 }), tmpDir, tmpDir, wtManager);
    const result = await orch.run();

    expect(result).toBe(1);
    const progress = await readFile(path.join(tmpDir, PROGRESS_FILE), 'utf-8');
    expect(progress).toContain('RETRY: F001');
  });
});
