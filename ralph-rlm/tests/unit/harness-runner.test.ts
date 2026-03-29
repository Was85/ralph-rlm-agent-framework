import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runFeatureHarness } from '../../src/core/harness-runner.js';
import { gitExec } from '../../src/core/safe-exec.js';
import type { Feature, RalphConfig, Runner, RunnerConfig } from '../../src/config/types.js';

class ScriptedRunner implements Runner {
  readonly type = 'claude' as const;
  readonly invocations: Array<{ prompt: string; config: RunnerConfig }> = [];

  constructor(
    private readonly onInvoke: (prompt: string, config: RunnerConfig) => Promise<number>,
  ) {}

  async invoke(prompt: string, config: RunnerConfig): Promise<number> {
    this.invocations.push({ prompt, config });
    return this.onInvoke(prompt, config);
  }

  async checkInstalled(): Promise<boolean> {
    return true;
  }
}

const baseFeature: Feature = {
  id: 'F001',
  description: 'Implement the assigned feature only',
  status: 'in_progress',
  attempts: 0,
  last_error: null,
  related_files: ['src/app.ts', 'tests/app.test.ts'],
};

const baseConfig: RalphConfig = {
  runner: 'claude',
  maxIterations: 20,
  maxValidateIterations: 10,
  coverageThreshold: 100,
  sleepBetween: 0,
  verbose: false,
  debug: false,
  dangerouslySkipPermissions: true,
  stream: false,
  team: false,
  teammates: 1,
  skipReview: false,
  optimize: false,
};

const PLANNER_BASE_TURNS = 8;
const CONTRACT_REVIEW_BASE_TURNS = 6;

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('runFeatureHarness', () => {
  it('retries planner and contract review once with larger budgets when artifacts are missing', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');
    const bootstrapFeature: Feature = {
      ...baseFeature,
      description: 'Bootstrap Node.js project with TypeScript and Vitest',
      related_files: ['package.json', 'src/app.ts', 'tests/app.test.ts'],
      acceptance_criteria: [
        'package.json exists with build and test scripts',
        'App exports an Express app',
        'Unit test verifies the app responds',
        'Build passes (npm run build)',
        'Tests pass (npm test)',
      ],
      verification_steps: ['npm run build', 'npm test'],
    };
    let plannerAttempts = 0;
    let contractReviewAttempts = 0;

    const runner = new ScriptedRunner(async (prompt, config) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        plannerAttempts += 1;
        if (plannerAttempts === 1) {
          expect(config.maxTurns).toBeGreaterThan(PLANNER_BASE_TURNS);
          return 1;
        }

        expect(config.maxTurns).toBeGreaterThan(PLANNER_BASE_TURNS + 3);
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Bootstrap the project',
          scope_summary: 'Create the initial app and smoke test',
          planned_changes: ['Create package manifest', 'Create app', 'Add test'],
          files_to_touch: ['package.json', 'src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Bootstrap is complete'],
          commit_message: 'feat(F001): bootstrap project',
          risks: ['Package scripts may be missing'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        contractReviewAttempts += 1;
        if (contractReviewAttempts === 1) {
          expect(config.maxTurns).toBeGreaterThan(CONTRACT_REVIEW_BASE_TURNS);
          return 1;
        }

        expect(config.maxTurns).toBeGreaterThan(CONTRACT_REVIEW_BASE_TURNS + 3);
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Bootstrap is complete',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'package.json'), '{"name":"smoke"}\n', 'utf-8');
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'package.json', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): bootstrap project'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the bootstrap feature.',
          commit_sha: stdout.trim(),
          changed_files: ['package.json', 'src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: bootstrapFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });
    expect(plannerAttempts).toBe(2);
    expect(contractReviewAttempts).toBe(2);
  });

  it('prefers prompt files copied into the worktree over external prompt paths', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await mkdtemp(path.join(tmpdir(), 'ralph-shared-prompts-'));
    createdDirs.push(promptsDir);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');
    const localPromptsDir = await createPromptsDir(cwd);
    await writeFile(path.join(promptsDir, 'feature-planner.md'), 'shared planner', 'utf-8');
    await writeFile(path.join(promptsDir, 'evaluator.md'), 'shared evaluator', 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'shared implementer', 'utf-8');
    await writeFile(path.join(localPromptsDir, 'feature-planner.md'), 'local planner', 'utf-8');
    await writeFile(path.join(localPromptsDir, 'evaluator.md'), 'local evaluator', 'utf-8');
    await writeFile(path.join(localPromptsDir, 'implementer.md'), 'local implementer', 'utf-8');

    const expectedPlannerPath = path.join(cwd, '.ralph', 'prompts', 'feature-planner.md');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        expect(prompt).toContain(expectedPlannerPath);
        expect(prompt).not.toContain(path.join(promptsDir, 'feature-planner.md'));
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });
  });

  it('rejects implementers that create more than one commit and bounds implementer execution', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt, config) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });

        await writeFile(path.join(cwd, 'src', 'store.ts'), 'export const store = [];\n', 'utf-8');
        await gitExec(['add', '--', 'src/store.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F002): bleed into another feature'], cwd);
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'retry',
      summary: 'Implementer created 2 commits for F001; exactly 1 feature commit is required',
    });

    const implementerInvocation = runner.invocations.find(invocation => invocation.prompt.includes('implementation-report.json'));
    expect(implementerInvocation?.config.maxTurns).toBe(20);
    expect(implementerInvocation?.config.timeout).toBe(20 * 60 * 1000);
  });

  it('rejects out-of-scope dirty changes even when the feature report exists', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });

        await writeFile(path.join(cwd, 'src', 'future-feature.ts'), 'export const future = true;\n', 'utf-8');
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'retry',
      summary: 'Implementer left non-managed changes after completion: src/future-feature.ts',
    });
  });

  it('allows minimal bootstrap entry files outside the explicit contract file list', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');
    const bootstrapFeature: Feature = {
      ...baseFeature,
      description: 'Bootstrap the Node.js project foundation with TypeScript.',
      related_files: ['package.json', 'tsconfig.json', 'vitest.config.ts', 'tests/setup.test.ts'],
      acceptance_criteria: [
        'package.json defines the app scripts.',
        'Build passes (`npm run build`).',
        'Unit test: setup smoke test proves the bootstrap works.',
        'Tests pass (`npm test`).',
      ],
      verification_steps: ['npm run build', 'npm test'],
    };

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Bootstrap the project',
          scope_summary: 'Create the initial runnable TypeScript scaffold',
          planned_changes: ['Add manifest and configs', 'Add bootstrap entry file', 'Add smoke test'],
          files_to_touch: ['package.json', 'tsconfig.json', 'vitest.config.ts', 'tests/setup.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Bootstrap is complete'],
          commit_message: 'feat(F001): bootstrap project',
          risks: ['Tooling may require a runtime entry file'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Bootstrap is complete',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, '.gitignore'), 'node_modules/\ndist/\n', 'utf-8');
        await writeFile(path.join(cwd, 'package.json'), '{"name":"smoke"}\n', 'utf-8');
        await writeFile(path.join(cwd, 'tsconfig.json'), '{"compilerOptions":{"outDir":"dist"}}\n', 'utf-8');
        await writeFile(path.join(cwd, 'vitest.config.ts'), 'export default {};\n', 'utf-8');
        await writeFile(path.join(cwd, 'src', 'index.ts'), 'export const ready = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'setup.test.ts'), 'export const smoke = true;\n', 'utf-8');
        await gitExec(['add', '--', '.gitignore', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'src/index.ts', 'tests/setup.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): bootstrap project'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the bootstrap feature.',
          commit_sha: stdout.trim(),
          changed_files: ['.gitignore', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'src/index.ts', 'tests/setup.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: bootstrapFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });
  });

  it('cleans untracked build outputs before enforcing the dirty-file guard', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });

        await mkdir(path.join(cwd, 'dist'), { recursive: true });
        await writeFile(path.join(cwd, 'dist', 'app.js'), 'export const built = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'dist', 'app.d.ts'), 'export declare const built: boolean;\n', 'utf-8');
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });

    await expect(readFile(path.join(cwd, 'dist', 'app.js'), 'utf-8')).rejects.toThrow();
  });

  it('accepts abbreviated commit SHAs in implementation reports when they resolve to HEAD', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);
        const shortSha = stdout.trim().slice(0, 7);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: shortSha,
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });
  });

  it('compares the contract commit subject against the actual git subject even when the contract includes trailers', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature\n\nCo-authored-by: Copilot <copilot@example.com>',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });
  });

  it('accepts verifier reports that paraphrase acceptance checks but preserve the same proof', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm run build', 'npm test'],
          acceptance_checks: [
            'GET /todos/:id returns HTTP 404 with JSON body {"error": "Todo not found"} when the id does not exist',
            '404 response body is exactly {"error": "Todo not found"}',
            'npm run build succeeds with no errors',
            'npm test passes all tests',
          ],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [
            {
              command: 'npm run build',
              status: 'pass',
              details: 'Verifier reran build successfully.',
            },
            {
              command: 'npm test',
              status: 'pass',
              details: 'Verifier reran tests successfully.',
            },
          ],
          acceptance_results: [
            {
              criterion: 'GET /todos/:id returns HTTP 404 with JSON body containing an error field when the id does not exist',
              status: 'pass',
              notes: 'The route returns exactly { error: "Todo not found" } for a missing id.',
            },
            {
              criterion: '404 response body is JSON with {"error": "Todo not found"} or similar message',
              status: 'pass',
              notes: 'Confirmed with a strict equality assertion against the exact error payload.',
            },
          ],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm run build', 'npm test'],
          verification_results: [
            {
              command: 'npm run build',
              status: 'pass',
              details: 'Build passed during implementation.',
            },
            {
              command: 'npm test',
              status: 'pass',
              details: 'Tests passed during implementation.',
            },
          ],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'approved',
      summary: 'Verified',
    });
  });

  it('rejects ready-for-review reports whose claimed commands did not pass', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'fail',
            details: 'Pretended test failure',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'retry',
      summary: 'Implementation reported non-passing verification commands: npm test',
    });
  });

  it('rejects verification reports that omit required contract commands', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'pass',
            notes: 'Verified',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'retry',
      summary: 'Verification report omitted required contract commands: npm test',
    });
  });

  it('rejects approved verification reports with untested acceptance checks', async () => {
    const cwd = await createGitRepo();
    const promptsDir = await createPromptsDir(cwd);
    const featureDir = path.join(cwd, '.ralph', 'features', 'F001');

    const runner = new ScriptedRunner(async (prompt) => {
      if (
        prompt.includes('then write exactly one valid JSON file at')
        && prompt.includes('contract.json')
        && !prompt.includes('Mode: CONTRACT_REVIEW')
        && !prompt.includes('Mode: VERIFICATION_REVIEW')
      ) {
        await writeJson(path.join(featureDir, 'contract.json'), {
          feature_id: 'F001',
          goal: 'Implement the feature',
          scope_summary: 'Keep the change tight',
          planned_changes: ['Create app and smoke test'],
          files_to_touch: ['src/app.ts', 'tests/app.test.ts'],
          commands_to_run: ['npm test'],
          acceptance_checks: ['Feature is implemented'],
          commit_message: 'feat(F001): implement assigned feature',
          risks: ['None'],
        });
        return 0;
      }

      if (prompt.includes('Mode: CONTRACT_REVIEW')) {
        await writeJson(path.join(featureDir, 'contract-review.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Approved',
          findings: [],
        });
        return 0;
      }

      if (prompt.includes('Mode: VERIFICATION_REVIEW')) {
        await writeJson(path.join(featureDir, 'verification-report.json'), {
          feature_id: 'F001',
          outcome: 'approved',
          summary: 'Verified',
          findings: [],
          command_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Verifier reran tests successfully.',
          }],
          acceptance_results: [{
            criterion: 'Feature is implemented',
            status: 'untested',
            notes: 'Verifier did not actually inspect the behavior.',
          }],
        });
        return 0;
      }

      if (prompt.includes('implementation-report.json')) {
        await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const app = true;\n', 'utf-8');
        await writeFile(path.join(cwd, 'tests', 'app.test.ts'), 'export const testFile = true;\n', 'utf-8');
        await gitExec(['add', '--', 'src/app.ts', 'tests/app.test.ts'], cwd);
        await gitExec(['commit', '-m', 'feat(F001): implement assigned feature'], cwd);
        const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);

        await writeJson(path.join(featureDir, 'implementation-report.json'), {
          feature_id: 'F001',
          outcome: 'ready_for_review',
          summary: 'Implemented the assigned feature.',
          commit_sha: stdout.trim(),
          changed_files: ['src/app.ts', 'tests/app.test.ts'],
          commands_run: ['npm test'],
          verification_results: [{
            command: 'npm test',
            status: 'pass',
            details: 'Command passed during implementation.',
          }],
          notes: [],
        });
        return 0;
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const result = await runFeatureHarness({
      runner,
      config: baseConfig,
      promptsDir,
      cwd,
      feature: baseFeature,
    });

    expect(result).toEqual({
      outcome: 'retry',
      summary: 'Verification report omitted required acceptance checks: Feature is implemented',
    });
  });
});

async function createGitRepo(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ralph-harness-'));
  createdDirs.push(cwd);

  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'tests'), { recursive: true });
  await gitExec(['init'], cwd);
  await gitExec(['config', 'user.name', 'Harness Test'], cwd);
  await gitExec(['config', 'user.email', 'harness-test@example.com'], cwd);
  await writeFile(path.join(cwd, 'README.md'), '# harness test\n', 'utf-8');
  await gitExec(['add', '--', 'README.md'], cwd);
  await gitExec(['commit', '-m', 'chore: seed repo'], cwd);

  return cwd;
}

async function createPromptsDir(cwd: string): Promise<string> {
  const promptsDir = path.join(cwd, '.ralph', 'prompts');
  await mkdir(promptsDir, { recursive: true });
  return promptsDir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}
