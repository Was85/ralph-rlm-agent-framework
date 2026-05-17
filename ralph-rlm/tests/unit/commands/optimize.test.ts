import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOptimize } from '../../../src/commands/optimize.js';
import type { Feature, FeatureList, RalphConfig, Runner, RunnerConfig } from '../../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

vi.mock('../../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function createMockRunner(
  onInvoke?: (prompt: string) => Promise<void>,
  exitCode: number = 0,
): Runner {
  return {
    type: 'claude',
    async invoke(prompt: string, _config: RunnerConfig): Promise<number> {
      if (onInvoke) await onInvoke(prompt);
      return exitCode;
    },
    async checkInstalled(): Promise<boolean> {
      return true;
    },
  };
}

function makeFeatureList(overrides: Partial<FeatureList> = {}): FeatureList {
  const features: Feature[] = [
    {
      id: 'F001',
      description: 'Create GET /api/todos endpoint in src/routes/todos.ts returning all todos as JSON.',
      status: 'pending',
      attempts: 0,
      last_error: null,
      priority: 1,
      depends_on: [],
      source_requirement: '## Todos > List',
      acceptance_criteria: [
        'GET /api/todos returns all todos as JSON.',
        'Build passes (`npm run build`).',
        'Unit tests pass (`npm test`) for the todos route.',
      ],
      verification_steps: [
        'npm run build',
        'npm test',
        'Run the Vitest unit test for GET /api/todos.',
      ],
      related_files: [
        'src/routes/todos.ts',
        'tests/routes/todos.test.ts',
      ],
    },
    {
      id: 'F002',
      description: 'Create POST /api/todos endpoint in src/routes/todos-create.ts to store a todo and return 201.',
      status: 'pending',
      attempts: 0,
      last_error: null,
      priority: 2,
      depends_on: ['F001'],
      source_requirement: '## Todos > Create',
      acceptance_criteria: [
        'POST /api/todos stores the todo and returns 201 with the created payload.',
        'Build passes (`npm run build`).',
        'Unit tests pass (`npm test`) for todo creation.',
      ],
      verification_steps: [
        'npm run build',
        'npm test',
        'Run the Vitest unit test for POST /api/todos.',
      ],
      related_files: [
        'src/routes/todos-create.ts',
        'tests/routes/todos-create.test.ts',
      ],
    },
  ];

  return {
    project: 'test',
    config: {
      max_attempts_per_feature: 5,
      build_command: 'npm run build',
      test_command: 'npm test',
    },
    stats: { total: features.length, complete: 0, in_progress: 0, pending: features.length, blocked: 0 },
    features,
    ...overrides,
  };
}

describe('optimize command', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'optimize-cmd-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await mkdir(path.join(tmpDir, '.git'));
    await writeFile(path.join(promptsDir, 'optimizer.md'), '# Optimizer', 'utf-8');
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('invokes runner with optimizer prompt referencing optimizer.md', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList()), 'utf-8');

    let capturedPrompt = '';
    const runner = createMockRunner(async (prompt) => {
      capturedPrompt = prompt;
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(0);
    expect(capturedPrompt).toContain('optimizer.md');
  });

  it('returns 1 if feature_list.json does not exist', async () => {
    const runner = createMockRunner();
    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(1);
  });

  it('returns 1 if feature_list.json is invalid after optimizer run', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList()), 'utf-8');

    const runner = createMockRunner(async () => {
      await writeFile(path.join(tmpDir, 'feature_list.json'), 'not json', 'utf-8');
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(1);
  });

  it('returns 0 if feature_list.json is valid after optimizer run', async () => {
    const fl = makeFeatureList();
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    const runner = createMockRunner(async () => {
      fl.features[0]!.acceptance_criteria = [
        'GET /api/todos returns all todos as JSON.',
        'Build passes (`npm run build`).',
        'Unit tests pass (`npm test`) for the todos route.',
      ];
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(0);
  });

  it('returns 0 if the runner exits non-zero without changing an already-valid feature_list.json', async () => {
    const fl = makeFeatureList();
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    const runner = createMockRunner(undefined, 1);

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(0);
  });

  it('returns 0 when the runner exits non-zero but leaves a valid updated feature_list.json', async () => {
    const fl = makeFeatureList();
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    const runner = createMockRunner(async () => {
      fl.features[0]!.description = 'Sharper feature A';
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
    }, 1);

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(0);
  });

  it('returns 1 when the optimized feature list fails the Phase 3 quality gate', async () => {
    const fl = makeFeatureList();
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    const runner = createMockRunner(async () => {
      fl.features[0] = {
        ...fl.features[0]!,
        description: 'Implement full CRUD for todos',
        acceptance_criteria: [
          'Todos work',
          'Build passes (`npm run build`).',
          'Tests pass (`npm test`).',
        ],
        verification_steps: ['npm run build', 'npm test'],
        related_files: [
          'src/routes/todos.ts',
          'src/services/todos.ts',
          'src/repositories/todos.ts',
          'tests/routes/todos.test.ts',
          'tests/services/todos.test.ts',
        ],
      };
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(result).toBe(1);
  });

  it('returns 1 if the runner exits non-zero without changes and the current feature list is still weak', async () => {
    const weak = makeFeatureList();
    weak.features[0] = {
      ...weak.features[0]!,
      description: 'Implement full CRUD for todos',
      acceptance_criteria: [
        'Todos work',
        'Build passes (`npm run build`).',
        'Tests pass (`npm test`).',
      ],
      verification_steps: ['npm run build', 'npm test'],
      related_files: [
        'src/routes/todos.ts',
        'src/services/todos.ts',
        'src/repositories/todos.ts',
        'tests/routes/todos.test.ts',
        'tests/services/todos.test.ts',
      ],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(weak), 'utf-8');

    const runner = createMockRunner(undefined, 1);
    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);

    expect(result).toBe(1);
  });

  it('normalizes mechanical quality gaps after optimization and still succeeds', async () => {
    const fl = makeFeatureList();
    fl.features[0] = {
      ...fl.features[0]!,
      acceptance_criteria: [
        'GET /api/todos returns all todos as JSON.',
        'Build passes (`npm run build`).',
        'Unit test: the todos route works.',
      ],
      related_files: [
        'package.json',
        'tsconfig.json',
        'src/app.ts',
        'src/index.ts',
      ],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    const runner = createMockRunner();
    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    const repaired = JSON.parse(await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8'));

    expect(result).toBe(0);
    expect(repaired.features[0].acceptance_criteria).toContain('Unit tests pass (npm test)');
    expect(repaired.features[0].related_files).toContain('tests/app.test.ts');
  });

  it('passes dedicated max turns to runner config independent of maxAgentTurns', async () => {
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(makeFeatureList()), 'utf-8');

    let capturedConfig: RunnerConfig | null = null;
    const runner: Runner = {
      type: 'claude',
      async invoke(_prompt: string, config: RunnerConfig): Promise<number> {
        capturedConfig = config;
        return 0;
      },
      async checkInstalled(): Promise<boolean> { return true; },
    };

    await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    expect(capturedConfig?.maxTurns).toBe(25);
  });

  it('runs one targeted repair pass when the optimized feature list still fails the quality gate', async () => {
    const fl = makeFeatureList();
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');

    let invocations = 0;
    const runner = createMockRunner(async () => {
      invocations += 1;
      if (invocations === 1) {
        fl.features[0] = {
          ...fl.features[0]!,
          source_requirement: '',
        };
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
        return;
      }

      fl.features[0] = {
        ...makeFeatureList().features[0]!,
      };
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl), 'utf-8');
    });

    const result = await runOptimize(makeConfig(), promptsDir, runner, tmpDir);
    const repaired = JSON.parse(await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8'));

    expect(result).toBe(0);
    expect(invocations).toBe(2);
    expect(repaired.features[0].source_requirement).toBe('## Todos > List');
  });
});
