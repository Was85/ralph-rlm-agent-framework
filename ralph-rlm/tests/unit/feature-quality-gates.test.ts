import type { Feature, FeatureList } from '../../src/config/types.js';
import {
  formatFeatureQualityIssues,
  normalizeFeatureListQuality,
  validateFeatureListQuality,
} from '../../src/core/feature-quality-gates.js';

function createBackendFeature(overrides: Partial<Feature> = {}): Feature {
  return {
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
      'Unit tests pass (`npm test`) for the todo route.',
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
    ...overrides,
  };
}

function createUiFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'F002',
    description: 'Create TodoList page in src/pages/TodoList.tsx showing the saved todos.',
    status: 'pending',
    attempts: 0,
    last_error: null,
    priority: 2,
    depends_on: ['F001'],
    source_requirement: '## Todos > UI',
    acceptance_criteria: [
      'The TodoList page renders the current todos.',
      'Build passes (`npm run build`).',
      'Playwright E2E tests pass (`npm test`) for the TodoList page.',
    ],
    verification_steps: [
      'npm run build',
      'npm test',
      'Run the Playwright E2E test for the TodoList page.',
    ],
    related_files: [
      'src/pages/TodoList.tsx',
      'tests/e2e/todo-list.spec.ts',
    ],
    ...overrides,
  };
}

function createFeatureList(features: Feature[]): FeatureList {
  return {
    project: 'todo-api',
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

describe('feature quality gates', () => {
  it('accepts a valid backend and UI feature set', () => {
    const data = createFeatureList([
      createBackendFeature(),
      createUiFeature(),
    ]);

    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('accepts backend endpoint features that prove behavior with integration tests', () => {
    const data = createFeatureList([
      createBackendFeature({
        acceptance_criteria: [
          'GET /api/todos returns all todos as JSON.',
          'Build passes (`npm run build`).',
          'Integration test: Supertest verifies the todo route.',
          'Tests pass (`npm test`).',
        ],
        verification_steps: [
          'npm run build',
          'npm test',
          'Run the Supertest integration test for GET /api/todos.',
        ],
      }),
    ]);

    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('rejects oversized and vague CRUD stories', () => {
    const data = createFeatureList([
      createBackendFeature({
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
      }),
    ]);

    const issues = validateFeatureListQuality(data);
    expect(formatFeatureQualityIssues(issues).join('\n')).toContain('Description is too broad');
    expect(formatFeatureQualityIssues(issues).join('\n')).toContain('related_files must stay at 1-4 files');
  });

  it('rejects UI features without Playwright or E2E evidence', () => {
    const data = createFeatureList([
      createBackendFeature(),
      createUiFeature({
        acceptance_criteria: [
          'The TodoList page renders the current todos.',
          'Build passes (`npm run build`).',
          'Tests pass (`npm test`).',
        ],
        verification_steps: [
          'npm run build',
          'npm test',
          'Open the app manually.',
        ],
      }),
    ]);

    const issues = validateFeatureListQuality(data);
    expect(formatFeatureQualityIssues(issues).join('\n')).toContain('UI features must include Playwright or E2E verification criteria');
  });

  it('accepts focused store features that mention CRUD helpers without treating them as oversized by default', () => {
    const data = createFeatureList([
      createBackendFeature({
        description: 'Define the todos model interface and in-memory store with CRUD helpers.',
        acceptance_criteria: [
          'The store exposes add, getAll, getById, update, and remove operations.',
          'Build passes (`npm run build`).',
          'Unit test: store.test.ts verifies each CRUD helper.',
          'Tests pass (`npm test`).',
        ],
        verification_steps: [
          'npm run build',
          'npm test',
          'Run the Vitest unit test for the todo store.',
        ],
        related_files: [
          'src/models/todos.ts',
          'src/store.ts',
          'tests/store.test.ts',
        ],
      }),
    ]);

    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('rejects dependency cycles and missing traceability', () => {
    const data = createFeatureList([
      createBackendFeature({
        id: 'F001',
        priority: 2,
        depends_on: ['F002'],
        source_requirement: '',
      }),
      createBackendFeature({
        id: 'F002',
        priority: 1,
        depends_on: ['F001'],
      }),
    ]);

    const issues = validateFeatureListQuality(data);
    const rendered = formatFeatureQualityIssues(issues, 20).join('\n');
    expect(rendered).toContain('source_requirement is required');
    expect(rendered).toContain('Dependency cycle detected');
  });

  it('normalizes missing test-pass criteria and inferred test files', () => {
    const data = createFeatureList([
      createBackendFeature({
        acceptance_criteria: [
          'GET /api/todos returns all todos as JSON.',
          'Build passes (`npm run build`).',
          'Unit test: the todo route works.',
        ],
        verification_steps: ['npm run build', 'npm test'],
        related_files: [
          'package.json',
          'tsconfig.json',
          'src/app.ts',
          'src/index.ts',
        ],
      }),
    ]);

    const changes = normalizeFeatureListQuality(data);

    expect(changes).toHaveLength(1);
    expect(data.features[0]!.acceptance_criteria).toContain('Unit tests pass (npm test)');
    expect(data.features[0]!.related_files).toContain('tests/app.test.ts');
    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('normalizes bootstrap stories into a runnable Node and TypeScript starter shape', () => {
    const data = createFeatureList([
      createBackendFeature({
        description: 'Bootstrap the Node.js and TypeScript todo API foundation.',
        acceptance_criteria: [
          'package.json defines the app scripts.',
          'Build passes (`npm run build`).',
          'Unit test: setup smoke test proves the bootstrap works.',
        ],
        verification_steps: ['npm run build', 'npm test'],
        related_files: [
          'package.json',
          'tsconfig.json',
          'vitest.config.ts',
          'tests/setup.test.ts',
        ],
      }),
    ]);

    const changes = normalizeFeatureListQuality(data);

    expect(changes).toHaveLength(1);
    expect(data.features[0]!.related_files).toEqual([
      'package.json',
      'tsconfig.json',
      'vitest.config.ts',
      'tests/setup.test.ts',
      '.gitignore',
      'src/index.ts',
    ]);
    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('infers test files for source files without src/ prefix', () => {
    const data = createFeatureList([
      createBackendFeature({
        acceptance_criteria: [
          'SourceType enum has correct values.',
          'Build passes (`npm run build`).',
          'Unit test: SourceType enum is verified.',
        ],
        verification_steps: ['npm run build', 'npm test'],
        related_files: [
          'Models/SourceType.cs',
        ],
      }),
    ]);

    const changes = normalizeFeatureListQuality(data);

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(data.features[0]!.related_files.some(f => /test/i.test(f))).toBe(true);
    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('infers test files for nested non-src paths like Controllers/FooController.cs', () => {
    const data = createFeatureList([
      createBackendFeature({
        acceptance_criteria: [
          'ActionsController returns correct responses.',
          'Build passes (`npm run build`).',
          'Unit test: ActionsController verified.',
        ],
        verification_steps: ['npm run build', 'npm test'],
        related_files: [
          'Controllers/ActionsController.cs',
          'Services/FrendsApiService.cs',
        ],
      }),
    ]);

    const changes = normalizeFeatureListQuality(data);

    expect(data.features[0]!.related_files.some(f => /test/i.test(f))).toBe(true);
    expect(validateFeatureListQuality(data)).toEqual([]);
  });

  it('normalization satisfies unit-test evidence requirement without manual test criteria', () => {
    const data = createFeatureList([
      createBackendFeature({
        acceptance_criteria: [
          'SourceType enum has MonitoringFrendsProcess value.',
          'Build passes (`npm run build`).',
        ],
        verification_steps: ['npm run build'],
        related_files: [
          'src/models/SourceType.ts',
        ],
      }),
    ]);

    normalizeFeatureListQuality(data);
    const issues = validateFeatureListQuality(data);

    expect(issues.filter(i => i.message.includes('unit-test or integration-test'))).toEqual([]);
  });
});
