import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { runInit } from '../../../src/commands/init.js';
import type { RalphConfig, Runner, RunnerConfig } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

function createMockRunner(behavior?: (prompt: string) => Promise<void>): Runner {
  return {
    type: 'claude',
    async invoke(prompt: string, _config: RunnerConfig): Promise<number> {
      if (behavior) await behavior(prompt);
      return 0;
    },
    async checkInstalled(): Promise<boolean> {
      return true;
    },
  };
}

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe('init command', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'init-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    // Set up preflight requirements
    await mkdir(path.join(tmpDir, '.git'));
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n- Feature A\n', 'utf-8');
    await writeFile(path.join(promptsDir, 'initializer.md'), 'Initialize features from PRD', 'utf-8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('passes a short prompt that points to the initializer file', async () => {
    let capturedPrompt = '';
    const runner = createMockRunner(async (prompt) => {
      capturedPrompt = prompt;
      // Simulate runner creating feature_list.json
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify({
        project: 'test',
        config: { max_attempts_per_feature: 5 },
        stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
        features: [{ id: 'F001', description: 'Feature A', status: 'pending', attempts: 0, last_error: null }],
      }, null, 2), 'utf-8');
    });

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    // Must reference file path, not contain raw prompt content
    expect(capturedPrompt).toContain('initializer.md');
    expect(capturedPrompt).toContain('prd.md');
    // Must be short enough for Windows cmd.exe (8191 char limit)
    expect(capturedPrompt.length).toBeLessThan(8000);
    // Must not contain newlines — cmd.exe truncates at line breaks
    expect(capturedPrompt).not.toContain('\n');
  });

  it('returns 1 if feature_list.json is not created by runner', async () => {
    const runner = createMockRunner();

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('returns 1 if preflight fails', async () => {
    // Remove .git to fail preflight
    await rm(path.join(tmpDir, '.git'), { recursive: true });
    const runner = createMockRunner();

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('performs git stash before running', async () => {
    let invoked = false;
    const runner = createMockRunner(async () => {
      invoked = true;
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify({
        project: 'test',
        config: { max_attempts_per_feature: 5 },
        stats: { total: 0, complete: 0, in_progress: 0, pending: 0, blocked: 0 },
        features: [],
      }, null, 2), 'utf-8');
    });

    await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(invoked).toBe(true);
  });
});
