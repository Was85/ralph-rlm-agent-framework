import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { runInit } from '../../src/commands/init.js';
import { runValidate } from '../../src/commands/validate.js';
import { runImplement } from '../../src/commands/run.js';
import { runAuto } from '../../src/commands/auto.js';
import type { RalphConfig, Runner, RunnerConfig, FeatureList, ValidationState } from '../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';

const execAsync = promisify(exec);

// Mock runPreflight so tests don't require the actual CLI binary on the system.
vi.mock('../../src/core/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(true),
}));

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, sleepBetween: 0, ...overrides };
}

interface SpyInvocation {
  prompt: string;
  config: RunnerConfig;
}

function createSpyRunner(onInvoke?: (prompt: string, config: RunnerConfig) => Promise<void>): Runner & { invocations: SpyInvocation[] } {
  const invocations: SpyInvocation[] = [];
  return {
    type: 'claude',
    invocations,
    async invoke(prompt: string, config: RunnerConfig): Promise<number> {
      invocations.push({ prompt, config: { ...config } });
      if (onInvoke) await onInvoke(prompt, config);
      return 0;
    },
    async checkInstalled(): Promise<boolean> {
      return true;
    },
  };
}

describe('config-to-runner', () => {
  let tmpDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'cfg-runner-'));
    promptsDir = path.join(tmpDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -- init command setup --
  async function setupInitEnv(): Promise<void> {
    await mkdir(path.join(tmpDir, '.git'));
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n- Feature A\n', 'utf-8');
    await writeFile(path.join(promptsDir, 'initializer.md'), 'Initialize features from PRD', 'utf-8');
  }

  function initOnInvoke(): (prompt: string, config: RunnerConfig) => Promise<void> {
    return async () => {
      const fl: FeatureList = {
        project: 'test',
        config: { max_attempts_per_feature: 5 },
        stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
        features: [{ id: 'F001', description: 'Feature A', status: 'pending', attempts: 0, last_error: null }],
      };
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    };
  }

  // -- validate command setup --
  async function setupValidateEnv(): Promise<void> {
    await mkdir(path.join(tmpDir, '.git'));
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n- Feature A\n', 'utf-8');
    const fl = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    await writeFile(path.join(promptsDir, 'validator.md'), 'Validate PRD coverage', 'utf-8');
  }

  function validateOnInvoke(): (prompt: string, config: RunnerConfig) => Promise<void> {
    return async () => {
      const valState: ValidationState = {
        coverage_percent: 100,
        iteration: 1,
        status: 'complete',
        gaps: [],
        last_updated: new Date().toISOString(),
      };
      await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');
    };
  }

  // -- run command setup --
  async function setupRunEnv(): Promise<void> {
    await execAsync('git init', { cwd: tmpDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
    await execAsync('git config user.name "Test"', { cwd: tmpDir });
    const fl = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    await execAsync('git add feature_list.json', { cwd: tmpDir });
    await execAsync('git commit -m "seed feature list"', { cwd: tmpDir });
    await writeFile(path.join(promptsDir, 'feature-planner.md'), 'Plan the feature', 'utf-8');
    await writeFile(path.join(promptsDir, 'evaluator.md'), 'Evaluate the feature', 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement the next feature', 'utf-8');
  }

  function runOnInvoke(): (prompt: string, config: RunnerConfig) => Promise<void> {
    return async (prompt, config) => {
      await handleHarnessPrompt(prompt, config);
    };
  }

  // -- auto command setup --
  async function setupAutoEnv(): Promise<void> {
    await execAsync('git init', { cwd: tmpDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
    await execAsync('git config user.name "Test"', { cwd: tmpDir });
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n- Feature A\n', 'utf-8');
    await writeFile(path.join(promptsDir, 'initializer.md'), 'Initialize', 'utf-8');
    await writeFile(path.join(promptsDir, 'validator.md'), 'Validate', 'utf-8');
    await writeFile(path.join(promptsDir, 'feature-planner.md'), 'Plan', 'utf-8');
    await writeFile(path.join(promptsDir, 'evaluator.md'), 'Evaluate', 'utf-8');
    await writeFile(path.join(promptsDir, 'implementer.md'), 'Implement', 'utf-8');
    await execAsync('git add prd.md', { cwd: tmpDir });
    await execAsync('git commit -m "seed prd"', { cwd: tmpDir });
  }

  function autoOnInvoke(): (prompt: string, config: RunnerConfig) => Promise<void> {
    return async (prompt, config) => {
      if (prompt.includes('initializer.md')) {
        const fl: FeatureList = {
          project: 'test',
          config: { max_attempts_per_feature: 5 },
          stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
          features: [{ id: 'F001', description: 'Feature A', status: 'pending', attempts: 0, last_error: null }],
        };
        await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');

        const valState: ValidationState = {
          coverage_percent: 100,
          iteration: 1,
          status: 'complete',
          gaps: [],
          last_updated: null,
        };
        await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');
        return;
      }

      await handleHarnessPrompt(prompt, config);
    };
  }

  async function handleHarnessPrompt(prompt: string, config: RunnerConfig): Promise<void> {
    const cwd = config.cwd!;
    const featuresRoot = path.join(cwd, '.ralph', 'features');
    const [featureId] = await readdir(featuresRoot);
    const featureDir = path.join(featuresRoot, featureId!);

    if (prompt.includes('contract-review.json')) {
      await writeFile(path.join(featureDir, 'contract-review.json'), JSON.stringify({
        feature_id: featureId,
        outcome: 'approved',
        summary: 'contract approved',
        findings: [],
      }, null, 2), 'utf-8');
      return;
    }

    if (prompt.includes('verification-report.json')) {
      await writeFile(path.join(featureDir, 'verification-report.json'), JSON.stringify({
        feature_id: featureId,
        outcome: 'approved',
        summary: 'implementation approved',
        findings: [],
        command_results: [],
        acceptance_results: [],
      }, null, 2), 'utf-8');
      return;
    }

    if (prompt.includes('implementation-report.json')) {
      await writeFile(path.join(cwd, 'implemented.txt'), 'implemented', 'utf-8');
      await execAsync('git add -A', { cwd });
      await execAsync('git commit -m "feat(F001): implement test feature"', { cwd });
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd });
      await writeFile(path.join(featureDir, 'implementation-report.json'), JSON.stringify({
        feature_id: featureId,
        outcome: 'ready_for_review',
        summary: 'implementation complete',
        commit_sha: stdout.trim(),
        changed_files: ['implemented.txt'],
        commands_run: [],
        verification_results: [],
        notes: [],
      }, null, 2), 'utf-8');
      return;
    }

    await writeFile(path.join(featureDir, 'contract.json'), JSON.stringify({
      feature_id: featureId,
      goal: 'Implement the feature',
      scope_summary: 'Minimal test scope',
      planned_changes: ['implemented.txt'],
      files_to_touch: ['implemented.txt'],
      commands_to_run: [],
      acceptance_checks: [],
      commit_message: `feat(${featureId}): implement test feature`,
      risks: [],
    }, null, 2), 'utf-8');
  }

  // ========================================================================
  // init command
  // ========================================================================
  describe('init', () => {
    it('passes verbose=true to runner', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(makeConfig({ verbose: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.verbose).toBe(true);
    });

    it('passes debug=true to runner', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(makeConfig({ debug: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.debug).toBe(true);
    });

    it('passes dangerouslySkipPermissions=true to runner', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(makeConfig({ dangerouslySkipPermissions: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.dangerouslySkipPermissions).toBe(true);
    });

    it('passes stream=true to runner', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(makeConfig({ stream: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.stream).toBe(true);
    });

    it('does not force bare mode for init', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(makeConfig(), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.bare).toBeUndefined();
      expect(runner.invocations[0]?.config.settingSources).toBe('project,local');
    });

    it('defaults: all RunnerConfig fields are false', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(makeConfig(), promptsDir, runner, tmpDir);

      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(false);
      expect(cfg?.debug).toBe(false);
      expect(cfg?.dangerouslySkipPermissions).toBe(false);
      expect(cfg?.stream).toBe(false);
    });

    it('passes all flags=true together', async () => {
      await setupInitEnv();
      const runner = createSpyRunner(initOnInvoke());

      await runInit(
        makeConfig({ verbose: true, debug: true, dangerouslySkipPermissions: true, stream: true }),
        promptsDir, runner, tmpDir,
      );

      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(true);
      expect(cfg?.debug).toBe(true);
      expect(cfg?.dangerouslySkipPermissions).toBe(true);
      expect(cfg?.stream).toBe(true);
    });
  });

  // ========================================================================
  // validate command
  // ========================================================================
  describe('validate', () => {
    it('passes verbose=true to runner', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(makeConfig({ verbose: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.verbose).toBe(true);
    });

    it('passes debug=true to runner', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(makeConfig({ debug: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.debug).toBe(true);
    });

    it('passes dangerouslySkipPermissions=true to runner', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(makeConfig({ dangerouslySkipPermissions: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.dangerouslySkipPermissions).toBe(true);
    });

    it('passes stream=true to runner', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(makeConfig({ stream: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.stream).toBe(true);
    });

    it('does not force bare mode for validation', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(makeConfig(), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.bare).toBeUndefined();
      expect(runner.invocations[0]?.config.settingSources).toBe('project,local');
    });

    it('defaults: all RunnerConfig fields are false', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(makeConfig(), promptsDir, runner, tmpDir);

      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(false);
      expect(cfg?.debug).toBe(false);
      expect(cfg?.dangerouslySkipPermissions).toBe(false);
      expect(cfg?.stream).toBe(false);
    });

    it('passes all flags=true together', async () => {
      await setupValidateEnv();
      const runner = createSpyRunner(validateOnInvoke());

      await runValidate(
        makeConfig({ verbose: true, debug: true, dangerouslySkipPermissions: true, stream: true }),
        promptsDir, runner, tmpDir,
      );

      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(true);
      expect(cfg?.debug).toBe(true);
      expect(cfg?.dangerouslySkipPermissions).toBe(true);
      expect(cfg?.stream).toBe(true);
    });
  });

  // ========================================================================
  // run command
  // ========================================================================
  describe('run', () => {
    it('passes verbose=true to runner', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(makeConfig({ verbose: true, maxIterations: 5 }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.verbose).toBe(true);
    });

    it('passes debug=true to runner', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(makeConfig({ debug: true, maxIterations: 5 }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.debug).toBe(true);
    });

    it('passes dangerouslySkipPermissions=true to runner', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(makeConfig({ dangerouslySkipPermissions: true, maxIterations: 5 }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.dangerouslySkipPermissions).toBe(true);
    });

    it('passes stream=true to runner', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(makeConfig({ stream: true, maxIterations: 5 }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.stream).toBe(true);
    });

    it('does not force bare mode for harness phases', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

      expect(runner.invocations[0]?.config.bare).toBeUndefined();
      expect(runner.invocations.every(invocation => invocation.config.bare === undefined)).toBe(true);
      expect(runner.invocations.every(invocation => invocation.config.settingSources === 'project,local')).toBe(true);
    });

    it('defaults: all RunnerConfig fields are false', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(makeConfig({ maxIterations: 5 }), promptsDir, runner, tmpDir);

      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(false);
      expect(cfg?.debug).toBe(false);
      expect(cfg?.dangerouslySkipPermissions).toBe(false);
      expect(cfg?.stream).toBe(false);
    });

    it('passes all flags=true together', async () => {
      await setupRunEnv();
      const runner = createSpyRunner(runOnInvoke());

      await runImplement(
        makeConfig({ verbose: true, debug: true, dangerouslySkipPermissions: true, stream: true, maxIterations: 5 }),
        promptsDir, runner, tmpDir,
      );

      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(true);
      expect(cfg?.debug).toBe(true);
      expect(cfg?.dangerouslySkipPermissions).toBe(true);
      expect(cfg?.stream).toBe(true);
    });
  });

  // ========================================================================
  // auto command
  // ========================================================================
  describe('auto', () => {
    it('passes verbose=true through to runner', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(makeConfig({ verbose: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      expect(runner.invocations[0]?.config.verbose).toBe(true);
    });

    it('passes debug=true through to runner', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(makeConfig({ debug: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      expect(runner.invocations[0]?.config.debug).toBe(true);
    });

    it('passes dangerouslySkipPermissions=true through to runner', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(makeConfig({ dangerouslySkipPermissions: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      expect(runner.invocations[0]?.config.dangerouslySkipPermissions).toBe(true);
    });

    it('passes stream=true through to runner', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(makeConfig({ stream: true }), promptsDir, runner, tmpDir);

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      expect(runner.invocations[0]?.config.stream).toBe(true);
    });

    it('does not force bare mode through auto phases', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(makeConfig(), promptsDir, runner, tmpDir);

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      expect(runner.invocations.every(invocation => invocation.config.bare === undefined)).toBe(true);
      expect(runner.invocations.every(invocation => invocation.config.settingSources === 'project,local')).toBe(true);
    });

    it('defaults: all RunnerConfig fields are false', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(makeConfig(), promptsDir, runner, tmpDir);

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(false);
      expect(cfg?.debug).toBe(false);
      expect(cfg?.dangerouslySkipPermissions).toBe(false);
      expect(cfg?.stream).toBe(false);
    });

    it('passes all flags=true together', async () => {
      await setupAutoEnv();
      const runner = createSpyRunner(autoOnInvoke());

      await runAuto(
        makeConfig({ verbose: true, debug: true, dangerouslySkipPermissions: true, stream: true }),
        promptsDir, runner, tmpDir,
      );

      expect(runner.invocations.length).toBeGreaterThanOrEqual(1);
      const cfg = runner.invocations[0]?.config;
      expect(cfg?.verbose).toBe(true);
      expect(cfg?.debug).toBe(true);
      expect(cfg?.dangerouslySkipPermissions).toBe(true);
      expect(cfg?.stream).toBe(true);
    });
  });
});
