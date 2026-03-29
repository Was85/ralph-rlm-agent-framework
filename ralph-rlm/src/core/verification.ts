import { existsSync } from 'node:fs';
import path from 'node:path';
import { gitExec, safeExecCommand } from './safe-exec.js';
import type { VerificationCommandResult } from '../config/types.js';

export interface VerificationResult {
  ok: boolean;
  command?: string;
  error?: string;
  commandResults: VerificationCommandResult[];
}

interface VerificationOptions {
  mergeCommit?: string;
  installCommand?: string;
  commandTimeoutMs?: number;
  setupTimeoutMs?: number;
}

const NODE_MANIFEST_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

export async function runVerificationCommands(
  cwd: string,
  commands: string[],
  options: VerificationOptions = {},
): Promise<VerificationResult> {
  const executableCommands = commands.filter(command => command.trim().length > 0);
  if (executableCommands.length === 0) {
    return { ok: true, commandResults: [] };
  }

  const setupCommand = options.installCommand?.trim() || await detectSetupCommand(cwd, options.mergeCommit);
  const executionPlan = setupCommand
    ? [setupCommand, ...executableCommands]
    : executableCommands;
  const commandResults: VerificationCommandResult[] = [];

  for (const [index, command] of executionPlan.entries()) {
    try {
      await safeExecCommand(command, cwd, {
        timeout: index === 0 && setupCommand
          ? (options.setupTimeoutMs ?? 600_000)
          : (options.commandTimeoutMs ?? 300_000),
      });
      commandResults.push({
        command,
        status: 'pass',
        details: index === 0 && setupCommand
          ? 'Dependency setup completed successfully'
          : 'Command completed successfully',
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      commandResults.push({
        command,
        status: 'fail',
        details: error,
      });
      return {
        ok: false,
        command,
        error,
        commandResults,
      };
    }
  }

  return { ok: true, commandResults };
}

async function detectSetupCommand(cwd: string, mergeCommit?: string): Promise<string | undefined> {
  if (!existsSync(path.join(cwd, 'package.json'))) {
    return undefined;
  }

  const changedFiles = await getChangedFiles(cwd, mergeCommit);
  const packageFilesChanged = changedFiles.some(file => NODE_MANIFEST_FILES.has(path.posix.basename(file)));
  const nodeModulesMissing = !existsSync(path.join(cwd, 'node_modules'));

  if (!packageFilesChanged && !nodeModulesMissing) {
    return undefined;
  }

  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm install --frozen-lockfile';
  }

  if (existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn install --frozen-lockfile';
  }

  if (existsSync(path.join(cwd, 'package-lock.json')) || existsSync(path.join(cwd, 'npm-shrinkwrap.json'))) {
    return 'npm ci';
  }

  return 'npm install';
}

async function getChangedFiles(cwd: string, mergeCommit?: string): Promise<string[]> {
  if (!mergeCommit) {
    return [];
  }

  try {
    const { stdout } = await gitExec(['show', '--pretty=format:', '--name-only', mergeCommit], cwd);
    return [...new Set(
      stdout
        .split(/\r?\n/)
        .map(line => line.trim().replace(/\\/g, '/'))
        .filter(Boolean),
    )];
  } catch {
    return [];
  }
}
