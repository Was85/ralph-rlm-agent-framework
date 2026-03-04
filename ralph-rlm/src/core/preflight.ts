import { access } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { RunnerType } from '../config/types.js';
import * as logger from '../ui/logger.js';
import { ensureExists } from './progress-log.js';

const execAsync = promisify(exec);

export async function checkGit(cwd: string): Promise<boolean> {
  try {
    await access(path.join(cwd, '.git'));
    return true;
  } catch {
    logger.error('Not a git repository. Run "git init" first.');
    return false;
  }
}

export async function checkCli(runner: RunnerType): Promise<boolean> {
  const cmd = process.platform === 'win32' ? `where ${runner}` : `which ${runner}`;
  try {
    await execAsync(cmd);
    return true;
  } catch {
    const installHint = runner === 'claude'
      ? 'npm install -g @anthropic-ai/claude-code'
      : 'See https://github.com/features/copilot/cli';
    logger.error(`${runner} CLI not found. Install it: ${installHint}`);
    return false;
  }
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
      await ensureExists(path.join(cwd, 'claude-progress.txt'));
      break;

    default:
      logger.error(`Unknown phase: ${phase}`);
      return false;
  }

  logger.success(`Preflight checks passed for phase: ${phase}`);
  return true;
}
