import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOptimizerLoop } from '../../../src/commands/optimizer-loop.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList } from '../../../src/config/types.js';
import { DEFAULT_CONFIG, OPTIMIZER_LOG_FILE } from '../../../src/config/defaults.js';

vi.mock('../../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

// Mock gitExec to avoid needing a real git repo
const mockGitExec = vi.fn().mockResolvedValue({ stdout: 'abc123\n', stderr: '' });
vi.mock('../../../src/core/safe-exec.js', () => ({
  gitExec: (...args: unknown[]) => mockGitExec(...args),
  sanitizeCommitMessage: (msg: string) => msg.slice(0, 500),
}));

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, sleepBetween: 0, maxIterations: 3, generations: 2, staleLimit: 3, ...overrides };
}

function makeFeatureList(complete = 0, total = 3): FeatureList {
  const features = [];
  for (let i = 0; i < total; i++) {
    features.push({
      id: `F${String(i + 1).padStart(3, '0')}`,
      description: `Feature ${i + 1}`,
      status: i < complete ? 'complete' as const : 'pending' as const,
      attempts: i < complete ? 1 : 0,
      last_error: null,
    });
  }
  return {
    project: 'test',
    config: { max_attempts_per_feature: 5 },
    stats: { total, complete, in_progress: 0, pending: total - complete, blocked: 0 },
    features,
  };
}

function createMockRunner(onInvoke?: (prompt: string, callNum: number) => Promise<void>): Runner {
  let callCount = 0;
  return {
    type: 'claude',
    async invoke(prompt: string, _config: RunnerConfig): Promise<number> {
      callCount++;
      if (onInvoke) await onInvoke(prompt, callCount);
      return 0;
    },
    async checkInstalled(): Promise<boolean> { return true; },
  };
}

describe('optimizer loop', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'opt-loop-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await mkdir(path.join(tmpDir, '.git'));
    await writeFile(path.join(promptsDir, 'optimizer.md'), '# Optimizer', 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), '# Implementer', 'utf-8');
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    mockGitExec.mockClear();
    mockGitExec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs N generations and creates log file', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList(0, 3)), 'utf-8');

    let optimizerCalls = 0;
    const runner = createMockRunner(async (prompt, _callNum) => {
      if (prompt.includes('optimizer.md')) {
        optimizerCalls++;
        // Optimizer doesn't change anything
      } else {
        // Run phase: complete one feature per generation
        const fl = makeFeatureList(optimizerCalls, 3);
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
      }
    });

    const result = await runOptimizerLoop(makeConfig({ generations: 2 }), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    // Log file should exist
    const logPath = path.join(tmpDir, OPTIMIZER_LOG_FILE);
    const log = JSON.parse(await readFile(logPath, 'utf-8'));
    expect(log).toHaveLength(2);
    expect(log[0].generation).toBe(1);
    expect(log[1].generation).toBe(2);
  });

  it('keeps generation when score improves', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList(0, 3)), 'utf-8');

    const runner = createMockRunner(async (prompt) => {
      if (!prompt.includes('optimizer.md')) {
        // Complete 2 features
        const fl = makeFeatureList(2, 3);
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
      }
    });

    await runOptimizerLoop(makeConfig({ generations: 1 }), promptsDir, runner, tmpDir);

    // Should have committed (git add + git commit)
    const commitCalls = mockGitExec.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[])[0] === 'commit'
    );
    expect(commitCalls.length).toBeGreaterThan(0);
  });

  it('discards generation when score does not improve', async () => {
    // Start with 2 already complete
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList(2, 3)), 'utf-8');

    const runner = createMockRunner(async (prompt) => {
      if (!prompt.includes('optimizer.md')) {
        // Still only 2 complete — no improvement
        const fl = makeFeatureList(2, 3);
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
      }
    });

    await runOptimizerLoop(makeConfig({ generations: 1 }), promptsDir, runner, tmpDir);

    // Should have reset (git reset --hard)
    const resetCalls = mockGitExec.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[0]) && (call[0] as string[]).includes('reset')
    );
    expect(resetCalls.length).toBeGreaterThan(0);
  });

  it('early-stops after staleLimit consecutive non-improvements', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList(0, 3)), 'utf-8');

    // Runner never completes any features
    const runner = createMockRunner(async () => {});

    await runOptimizerLoop(makeConfig({ generations: 10, staleLimit: 2 }), promptsDir, runner, tmpDir);

    // Should have stopped after 2 generations (staleLimit), not 10
    const logPath = path.join(tmpDir, OPTIMIZER_LOG_FILE);
    const log = JSON.parse(await readFile(logPath, 'utf-8'));
    expect(log.length).toBe(2);
  });

  it('log entries have correct shape', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList(0, 3)), 'utf-8');

    const runner = createMockRunner(async (prompt) => {
      if (!prompt.includes('optimizer.md')) {
        const fl = makeFeatureList(1, 3);
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
      }
    });

    await runOptimizerLoop(makeConfig({ generations: 1 }), promptsDir, runner, tmpDir);

    const logPath = path.join(tmpDir, OPTIMIZER_LOG_FILE);
    const log = JSON.parse(await readFile(logPath, 'utf-8'));
    const entry = log[0];
    expect(entry).toHaveProperty('generation');
    expect(entry).toHaveProperty('complete');
    expect(entry).toHaveProperty('total');
    expect(entry).toHaveProperty('baselineTotal');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('kept');
  });
});
