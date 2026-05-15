import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RunnerType } from '../config/types.js';
import * as logger from '../ui/logger.js';
import { ensureExists } from './progress-log.js';

function shellEscapeArg(arg: string): string {
  if (process.platform === 'win32') {
    return `"${arg.replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

interface CommandResult {
  code: number;
  stdout: string;
}

/**
 * Runs `command args...` through a shell, resolving its exit code and stdout.
 *
 * `shell: true` is required on Windows: npm installs CLI runners
 * (`claude`, `copilot`) as `.cmd` batch shims, and Node's `execFile`/`spawn`
 * without a shell cannot execute `.cmd`/`.bat` — so a bare `execFile` lookup
 * reports the CLI as missing even when it is installed and on PATH. The
 * command line is a single string with an empty args array (avoids the
 * shell+args deprecation) and arguments are shell-escaped. Mirrors the
 * established pattern in `src/runners/shell-spawn.ts`. `command` is a
 * controlled value (RunnerType), never user input.
 */
function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const cmdLine = [command, ...args.map(shellEscapeArg)].join(' ');
    const proc = spawn(cmdLine, [], { shell: true });
    let stdout = '';
    proc.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout }));
    proc.on('error', () => resolve({ code: 1, stdout: '' }));
  });
}

export async function checkGit(cwd: string): Promise<boolean> {
  try {
    await access(path.join(cwd, '.git'));
    return true;
  } catch {
    logger.error('Not a git repository. Run "git init" first.');
    return false;
  }
}

/**
 * Returns true if `command` can be invoked, by running `command --version`
 * through a shell. Replaces the legacy `where`/`which` lookup, which failed
 * on Windows because Node's `execFile` does not resolve bare command names
 * (e.g. `where`) against PATH even when the runner CLI is installed.
 */
export async function isCliAvailable(command: string): Promise<boolean> {
  const { code } = await runCommand(command, ['--version']);
  return code === 0;
}

export async function checkCli(runner: RunnerType): Promise<boolean> {
  if (await isCliAvailable(runner)) {
    return true;
  }

  const installHint = runner === 'claude'
    ? 'npm install -g @anthropic-ai/claude-code'
    : 'See https://github.com/features/copilot/cli';
  logger.error(`${runner} CLI not found. Install it: ${installHint}`);
  return false;
}

export async function checkRunnerAuth(runner: RunnerType): Promise<boolean> {
  if (runner !== 'claude') {
    return true;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return true;
  }

  const { code, stdout } = await runCommand('claude', ['auth', 'status']);
  if (code === 0) {
    try {
      const parsed = JSON.parse(stdout) as { loggedIn?: boolean };
      if (parsed.loggedIn) {
        return true;
      }
    } catch {
      // Fall through to the shared error below.
    }
  }

  logger.error('claude CLI is installed but not authenticated. Run "claude auth login" or set ANTHROPIC_API_KEY.');
  return false;
}

export async function checkFile(filePath: string, label: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    logger.error(`Required file missing: ${label}`);
    printFileHint(label);
    return false;
  }
}

function printFileHint(label: string): void {
  switch (label) {
    case 'prd.md':
      logger.info('');
      logger.info('To get started:');
      logger.info('  ralph scaffold    — creates prd.md template + project files');
      logger.info('  ralph author      — interactive assistant to write your PRD');
      logger.info('');
      logger.info('Then edit prd.md with your requirements and re-run.');
      break;
    case 'feature_list.json':
      logger.info('');
      logger.info('Run "ralph init" first to generate features from your prd.md.');
      break;
  }
}

export async function runPreflight(
  phase: string,
  runner: RunnerType,
  promptsDir: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  logger.info(`Running preflight checks for phase: ${phase}`);

  if (!(await checkGit(cwd))) return false;
  if (!(await checkCli(runner))) return false;
  if (!(await checkRunnerAuth(runner))) return false;

  switch (phase) {
    case 'init':
      if (!(await checkFile(path.join(cwd, 'prd.md'), 'prd.md'))) return false;
      if (!(await checkFile(path.join(promptsDir, 'initializer.md'), 'prompts/initializer.md'))) return false;
      break;

    case 'validate':
      if (!(await checkFile(path.join(cwd, 'prd.md'), 'prd.md'))) return false;
      if (!(await checkFile(path.join(cwd, 'feature_list.json'), 'feature_list.json'))) return false;
      if (!(await checkFile(path.join(promptsDir, 'validator.md'), 'prompts/validator.md'))) return false;
      break;

    case 'run':
      if (!(await checkFile(path.join(cwd, 'feature_list.json'), 'feature_list.json'))) return false;
      if (!(await checkFile(path.join(promptsDir, 'implementer.md'), 'prompts/implementer.md'))) return false;
      if (!(await checkFile(path.join(promptsDir, 'feature-planner.md'), 'prompts/feature-planner.md'))) return false;
      if (!(await checkFile(path.join(promptsDir, 'evaluator.md'), 'prompts/evaluator.md'))) return false;
      await ensureExists(path.join(cwd, 'claude-progress.txt'));
      break;

    case 'optimize':
      if (!(await checkFile(path.join(cwd, 'prd.md'), 'prd.md'))) return false;
      if (!(await checkFile(path.join(cwd, 'feature_list.json'), 'feature_list.json'))) return false;
      if (!(await checkFile(path.join(promptsDir, 'optimizer.md'), 'prompts/optimizer.md'))) return false;
      break;

    default:
      logger.error(`Unknown phase: ${phase}`);
      return false;
  }

  logger.success(`Preflight checks passed for phase: ${phase}`);
  return true;
}
