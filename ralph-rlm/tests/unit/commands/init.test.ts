import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { runInit } from '../../../src/commands/init.js';
import type { Feature, FeatureList, RalphConfig, Runner, RunnerConfig } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { gitExec } from '../../../src/core/safe-exec.js';

// Mock runPreflight so tests don't require the actual CLI binary on the system.
import { runPreflight } from '../../../src/core/preflight.js';
vi.mock('../../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

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

function createValidFeature(id: string, priority: number): Feature {
  return {
    id,
    description: `Create GET /api/todos/${id.toLowerCase()} endpoint in src/routes/${id.toLowerCase()}.ts returning JSON.`,
    status: 'pending',
    attempts: 0,
    last_error: null,
    priority,
    depends_on: [],
    source_requirement: `## Todos > ${id}`,
    acceptance_criteria: [
      `GET /api/todos/${id.toLowerCase()} returns the expected JSON payload.`,
      'Build passes (`npm run build`).',
      'Unit tests pass (`npm test`) for the todo endpoint.',
    ],
    verification_steps: [
      'npm run build',
      'npm test',
      `Run the Vitest unit test covering ${id}.`,
    ],
    related_files: [
      `src/routes/${id.toLowerCase()}.ts`,
      `tests/routes/${id.toLowerCase()}.test.ts`,
    ],
  };
}

function createValidFeatureList(features: Feature[]): FeatureList {
  return {
    project: 'test',
    config: {
      max_attempts_per_feature: 5,
      build_command: 'npm run build',
      test_command: 'npm test',
    },
    stats: {
      total: features.length,
      complete: 0,
      in_progress: 0,
      pending: features.length,
      blocked: 0,
    },
    features,
  };
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
      await writeFile(
        path.join(tmpDir, 'feature_list.json'),
        JSON.stringify(createValidFeatureList([createValidFeature('F001', 1)]), null, 2),
        'utf-8',
      );
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
    vi.mocked(runPreflight).mockResolvedValueOnce(false);
    const runner = createMockRunner();

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('performs git stash before running', async () => {
    let invoked = false;
    const runner = createMockRunner(async () => {
      invoked = true;
      await writeFile(
        path.join(tmpDir, 'feature_list.json'),
        JSON.stringify(createValidFeatureList([createValidFeature('F001', 1)]), null, 2),
        'utf-8',
      );
    });

    await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(invoked).toBe(true);
  });

  it('restores stashed user files such as prd.md after init cleanup', async () => {
    await rm(path.join(tmpDir, '.git'), { recursive: true, force: true });
    await gitExec(['init'], tmpDir);
    await gitExec(['config', 'user.name', 'Init Test'], tmpDir);
    await gitExec(['config', 'user.email', 'init-test@example.com'], tmpDir);
    await gitExec(['add', '--', 'prd.md'], tmpDir);
    await gitExec(['commit', '-m', 'seed repo'], tmpDir);

    await writeFile(path.join(tmpDir, 'notes.txt'), 'keep me\n', 'utf-8');

    const runner = createMockRunner(async () => {
      await writeFile(
        path.join(tmpDir, 'feature_list.json'),
        JSON.stringify(createValidFeatureList([createValidFeature('F001', 1)]), null, 2),
        'utf-8',
      );
    });

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);
    const stashList = await gitExec(['stash', 'list'], tmpDir);

    expect(result).toBe(0);
    expect(await readFile(path.join(tmpDir, 'prd.md'), 'utf-8')).toContain('# Requirements');
    expect(await readFile(path.join(tmpDir, 'notes.txt'), 'utf-8')).toContain('keep me');
    expect(stashList.stdout.trim()).toBe('');
  });

  it('returns 1 when the generated feature list fails the Phase 3 quality gate', async () => {
    const runner = createMockRunner(async () => {
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify({
        project: 'test',
        config: {
          max_attempts_per_feature: 5,
          build_command: 'npm run build',
          test_command: 'npm test',
        },
        stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
        features: [{
          id: 'F001',
          description: 'Implement full CRUD for todos',
          status: 'pending',
          attempts: 0,
          last_error: null,
          priority: 1,
          depends_on: [],
          source_requirement: '## Todos',
          acceptance_criteria: ['Todos work', 'Build passes (`npm run build`)', 'Tests pass (`npm test`)'],
          verification_steps: ['npm run build', 'npm test'],
          related_files: [
            'src/routes/todos.ts',
            'src/services/todos.ts',
            'src/repositories/todos.ts',
            'tests/routes/todos.test.ts',
            'tests/services/todos.test.ts',
          ],
        }],
      }, null, 2), 'utf-8');
    });

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('normalizes mechanical quality gaps after init and still succeeds', async () => {
    const runner = createMockRunner(async () => {
      const feature = createValidFeature('F001', 1);
      feature.acceptance_criteria = [
        'GET /api/todos/f001 returns the expected JSON payload.',
        'Build passes (`npm run build`).',
        'Unit test: the todo endpoint works.',
      ];
      feature.related_files = ['package.json', 'tsconfig.json', 'src/app.ts', 'src/index.ts'];

      await writeFile(
        path.join(tmpDir, 'feature_list.json'),
        JSON.stringify(createValidFeatureList([feature]), null, 2),
        'utf-8',
      );
    });

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);
    const repaired = JSON.parse(await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8'));

    expect(result).toBe(0);
    expect(repaired.features[0].acceptance_criteria).toContain('Tests pass (npm test)');
    expect(repaired.features[0].related_files).toContain('tests/app.test.ts');
  });

  it('runs one targeted repair pass when the initial feature list fails the quality gate', async () => {
    let invocations = 0;
    const runner = createMockRunner(async () => {
      invocations += 1;
      if (invocations === 1) {
        const feature = createValidFeature('F001', 1);
        feature.source_requirement = '';
        await writeFile(
          path.join(tmpDir, 'feature_list.json'),
          JSON.stringify(createValidFeatureList([feature]), null, 2),
          'utf-8',
        );
        return;
      }

      const repairedFeature = createValidFeature('F001', 1);
      await writeFile(
        path.join(tmpDir, 'feature_list.json'),
        JSON.stringify(createValidFeatureList([repairedFeature]), null, 2),
        'utf-8',
      );
    });

    const result = await runInit(makeConfig(), promptsDir, runner, tmpDir);
    const repaired = JSON.parse(await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8'));

    expect(result).toBe(0);
    expect(invocations).toBe(2);
    expect(repaired.features[0].source_requirement).toBe('## Todos > F001');
    expect(repaired.features[0].related_files).toContain('tests/routes/f001.test.ts');
  });
});
