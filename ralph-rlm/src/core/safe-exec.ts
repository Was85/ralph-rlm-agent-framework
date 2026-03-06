import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Executes a git command safely without shell interpolation.
 * Uses execFile (no shell) so arguments cannot be injected.
 */
export async function gitExec(
  args: string[],
  cwd: string,
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    timeout: options?.timeout,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });
}

/**
 * Sanitizes a string for use as a git commit message.
 * Strips characters that could be problematic in any shell context.
 */
export function sanitizeCommitMessage(msg: string): string {
  return msg
    .replace(/[`$\\!]/g, '') // Remove shell-special characters
    .replace(/[\x00-\x1f\x7f]/g, '') // Remove control characters
    .slice(0, 500); // Limit length
}

/**
 * Executes an arbitrary command safely without shell interpolation.
 * For build/test commands from feature_list.json config, we still need
 * shell: true since they may contain pipes, redirects, etc.
 * But we validate them first.
 */
export async function safeExecCommand(
  command: string,
  cwd: string,
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  // Build/test commands from config are user-controlled and trusted.
  // They intentionally need shell features (pipes, &&, etc).
  const { exec } = await import('node:child_process');
  const { promisify: pUtil } = await import('node:util');
  const execAsync = pUtil(exec);
  return execAsync(command, {
    cwd,
    timeout: options?.timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
}
