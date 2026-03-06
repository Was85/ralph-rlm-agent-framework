/**
 * Real E2E tests — invoke actual AI runners (Claude / Copilot).
 *
 * These tests cost real API tokens and take minutes each.
 * They are SKIPPED by default. Run them locally with:
 *
 *   RALPH_E2E=true npx vitest run tests/e2e/real-runner.test.ts
 *
 * Run a single runner:
 *   RALPH_E2E=true npx vitest run tests/e2e/real-runner.test.ts -t "Claude"
 *   RALPH_E2E=true npx vitest run tests/e2e/real-runner.test.ts -t "Copilot"
 *
 * Both runners must be installed and authenticated on the machine.
 */
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { FeatureList, ValidationState } from '../../src/config/types.js';

const execAsync = promisify(exec);

const cliPath = path.resolve('src/cli.ts').replace(/\\/g, '/');

const ENABLED = process.env['RALPH_E2E'] === 'true';
const describeE2E = ENABLED ? describe : describe.skip;

// Build a clean env that removes ALL Claude Code env vars to avoid
// nested session errors and the child process trying to connect to
// the parent session's SSE port / access token.
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
      delete env[key];
    }
  }
  return env;
}

// Uses spawn with stdin closed ('ignore') to prevent the child claude
// process from hanging waiting for input via piped stdin.
async function runCli(
  args: string[],
  cwd: string,
  timeoutMs = 300_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const escaped = args.map(a => `"${a}"`).join(' ');
  const cmd = `npx tsx "${cliPath}" ${escaped}`;

  return new Promise((resolve) => {
    const proc = spawn(cmd, [], {
      cwd,
      env: cleanEnv(),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout, stderr, exitCode: 1 });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

// Minimal PRD — produces 1-2 trivial features (cheap, fast)
const MINIMAL_PRD = `# Product Requirements Document

## Project Overview
A simple Node.js utility that exports a single function.

## Functional Requirements
1. Create a file src/greet.ts that exports a function \`greet(name: string): string\` which returns "Hello, <name>!".
2. Create a file tests/greet.test.ts that tests the greet function with at least two test cases.
`;

async function setupProject(tmpDir: string): Promise<void> {
  await execAsync('git init', { cwd: tmpDir });
  await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
  await execAsync('git config user.name "Test"', { cwd: tmpDir });

  await writeFile(path.join(tmpDir, 'prd.md'), MINIMAL_PRD, 'utf-8');

  const pkg = {
    name: 'e2e-test-project',
    version: '1.0.0',
    type: 'module',
    scripts: { test: 'npx vitest run' },
    devDependencies: { vitest: '^3.0.0', typescript: '^5.0.0' },
  };
  await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      outDir: 'dist',
    },
    include: ['src', 'tests'],
  };
  await writeFile(path.join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');

  await execAsync('git add -A && git commit -m "initial"', { cwd: tmpDir });
}

// Creates a feature_list.json with pending features (for validate/run tests)
async function seedFeatureList(tmpDir: string): Promise<void> {
  const fl: FeatureList = {
    project: 'e2e-test-project',
    config: { max_attempts_per_feature: 3 },
    stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
    features: [{
      id: 'F001',
      description: 'Create src/greet.ts with a greet(name) function that returns "Hello, <name>!"',
      status: 'pending',
      attempts: 0,
      last_error: null,
    }],
  };
  await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
  await execAsync('git add -A && git commit -m "add feature list"', { cwd: tmpDir });
}

// Creates a complete validation-state.json (for run tests that skip validate)
async function seedValidationComplete(tmpDir: string): Promise<void> {
  const vs: ValidationState = {
    coverage_percent: 100,
    iteration: 1,
    status: 'complete',
    gaps: [],
    last_updated: new Date().toISOString(),
  };
  await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(vs, null, 2), 'utf-8');
}

// ============================================================================
// Per-runner test suites
// ============================================================================

for (const runner of ['claude', 'copilot'] as const) {
  const permFlag = runner === 'claude' ? '--dangerously-skip-permissions' : '--allow-all-tools';

  describeE2E(`real E2E — ${runner}`, () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(path.join(tmpdir(), `real-e2e-${runner}-`));
      await setupProject(tmpDir);
    }, 60_000);

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    // ------------------------------------------------------------------
    // scaffold (no AI needed, fast)
    // ------------------------------------------------------------------
    describe('scaffold', () => {
      it('creates project files', async () => {
        const result = await runCli(['scaffold', '--runner', runner], tmpDir);

        expect(result.exitCode).toBe(0);
        expect(existsSync(path.join(tmpDir, 'templates'))).toBe(true);

        if (runner === 'claude') {
          expect(existsSync(path.join(tmpDir, '.claude'))).toBe(true);
          expect(existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
          expect(existsSync(path.join(tmpDir, '.claude', 'rules'))).toBe(true);
          expect(existsSync(path.join(tmpDir, '.claude', 'skills', 'ralph'))).toBe(true);
        } else {
          expect(existsSync(path.join(tmpDir, '.github', 'instructions'))).toBe(true);
        }
      }, 60_000);
    });

    // ------------------------------------------------------------------
    // init — AI generates feature_list.json from PRD
    // ------------------------------------------------------------------
    describe('init', () => {
      it('generates feature_list.json from PRD', async () => {
        const result = await runCli(
          ['init', '--runner', runner, permFlag],
          tmpDir,
        );

        expect(result.exitCode).toBe(0);

        const flPath = path.join(tmpDir, 'feature_list.json');
        expect(existsSync(flPath)).toBe(true);

        const data = JSON.parse(await readFile(flPath, 'utf-8')) as FeatureList;
        expect(data.features.length).toBeGreaterThanOrEqual(1);
        // All features must be pending after init
        expect(data.features.every(f => f.status === 'pending')).toBe(true);
      }, 300_000);

      it('works with --verbose', async () => {
        const result = await runCli(
          ['init', '--runner', runner, permFlag, '--verbose'],
          tmpDir,
        );

        expect(result.exitCode).toBe(0);
        expect(existsSync(path.join(tmpDir, 'feature_list.json'))).toBe(true);
      }, 300_000);

      it('works with --debug', async () => {
        const result = await runCli(
          ['init', '--runner', runner, permFlag, '--debug'],
          tmpDir,
        );

        expect(result.exitCode).toBe(0);
        expect(existsSync(path.join(tmpDir, 'feature_list.json'))).toBe(true);
      }, 300_000);
    });

    // ------------------------------------------------------------------
    // validate — AI checks PRD coverage
    // ------------------------------------------------------------------
    describe('validate', () => {
      it('validates PRD coverage and completes', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['validate', '--runner', runner, permFlag, '--max-validate-iterations', '3'],
          tmpDir,
        );

        // 0 = complete, 1 = max iterations, 2 = blocked — all acceptable
        expect([0, 1, 2]).toContain(result.exitCode);

        // validation-state.json should exist after validate
        expect(existsSync(path.join(tmpDir, 'validation-state.json'))).toBe(true);
      }, 300_000);
    });

    // ------------------------------------------------------------------
    // run — AI implements features
    // ------------------------------------------------------------------
    describe('run', () => {
      it('implements at least one feature', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['run', '--runner', runner, permFlag, '--max-iterations', '3'],
          tmpDir,
        );

        // 0 = all complete, 1 = max iterations, 2 = blocked
        expect([0, 1, 2]).toContain(result.exitCode);

        // Feature list should still be valid
        const data = JSON.parse(await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8')) as FeatureList;
        expect(data.features.length).toBeGreaterThanOrEqual(1);

        // At least one attempt should have been made
        const totalAttempts = data.features.reduce((sum, f) => sum + f.attempts, 0);
        expect(totalAttempts).toBeGreaterThanOrEqual(1);
      }, 300_000);

      it('works with --verbose', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['run', '--runner', runner, permFlag, '--verbose', '--max-iterations', '1'],
          tmpDir,
        );

        expect([0, 1, 2]).toContain(result.exitCode);
      }, 300_000);

      it('works with --stream', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['run', '--runner', runner, permFlag, '--stream', '--max-iterations', '1'],
          tmpDir,
        );

        expect([0, 1, 2]).toContain(result.exitCode);
      }, 300_000);
    });

    // ------------------------------------------------------------------
    // auto — full pipeline: init → validate → run
    // ------------------------------------------------------------------
    describe('auto', () => {
      it('runs full pipeline from scratch', async () => {
        const result = await runCli(
          ['auto', '--runner', runner, permFlag, '--max-iterations', '3', '--max-validate-iterations', '2'],
          tmpDir,
          900_000,
        );

        // feature_list.json must exist (created by init phase)
        const flPath = path.join(tmpDir, 'feature_list.json');
        expect(existsSync(flPath)).toBe(true);

        const data = JSON.parse(await readFile(flPath, 'utf-8')) as FeatureList;
        expect(data.features.length).toBeGreaterThanOrEqual(1);

        // The run phase may not get iterations if validate consumes the
        // time budget, so we only assert that init produced features.
        expect([0, 1, 2]).toContain(result.exitCode);
      }, 900_000);
    });

    // ------------------------------------------------------------------
    // author — interactive PRD assistant
    // ------------------------------------------------------------------
    describe('author', () => {
      it('runs without crashing', async () => {
        // Scaffold first to get the skill files
        await runCli(['scaffold', '--runner', runner], tmpDir);

        // Author is interactive — it will invoke the runner which will try to
        // ask user questions. With --dangerously-skip-permissions it should at
        // least start and produce prd.md or exit gracefully.
        const result = await runCli(
          ['author', '--runner', runner, permFlag],
          tmpDir,
        );

        // Author may or may not create prd.md (it's interactive),
        // but it should not crash. Exit 0 or 1 are both valid.
        expect([0, 1]).toContain(result.exitCode);
        // Should not have unhandled exceptions
        const output = result.stdout + result.stderr;
        expect(output).not.toContain('UnhandledPromiseRejection');
      }, 300_000);
    });

    // ------------------------------------------------------------------
    // status — verify it works after commands have run
    // ------------------------------------------------------------------
    describe('status after init', () => {
      it('shows correct project state after init', async () => {
        // Run init first
        await runCli(['init', '--runner', runner, permFlag], tmpDir);

        // Now check status
        const result = await runCli(['status'], tmpDir);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('feature_list.json');
        expect(result.stdout).toContain('prd.md');
      }, 360_000);
    });

    // ------------------------------------------------------------------
    // Parameter combinations
    // ------------------------------------------------------------------
    describe('parameter combinations', () => {
      it('all output flags together: --verbose --debug --stream', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['run', '--runner', runner, permFlag, '--verbose', '--debug', '--stream', '--max-iterations', '1'],
          tmpDir,
        );

        expect([0, 1, 2]).toContain(result.exitCode);
      }, 300_000);

      it('custom iteration limits: --max-iterations 2 --sleep-between 1', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['run', '--runner', runner, permFlag, '--max-iterations', '2', '--sleep-between', '1'],
          tmpDir,
        );

        expect([0, 1, 2]).toContain(result.exitCode);
      }, 300_000);

      it('validate with --coverage-threshold', async () => {
        await seedFeatureList(tmpDir);

        const result = await runCli(
          ['validate', '--runner', runner, permFlag, '--coverage-threshold', '50', '--max-validate-iterations', '1'],
          tmpDir,
          600_000,
        );

        expect([0, 1, 2]).toContain(result.exitCode);
        expect(existsSync(path.join(tmpDir, 'validation-state.json'))).toBe(true);
      }, 600_000);
    });
  });
}
