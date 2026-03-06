import { spawn } from 'node:child_process';

/**
 * Escapes a string for safe inclusion in a shell command.
 * Uses single-quoting with interior single quotes escaped.
 */
function shellEscape(arg: string): string {
  if (process.platform === 'win32') {
    // Windows cmd.exe: wrap in double quotes, escape interior doubles and special chars
    const escaped = arg
      .replace(/"/g, '\\"')
      .replace(/%/g, '%%');
    return `"${escaped}"`;
  }
  // Unix: single-quote the arg, escaping any interior single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawns a command with proper argument escaping on all platforms.
 *
 * Uses shell: true (necessary to resolve CLI tools on PATH), but
 * all arguments are shell-escaped to prevent injection.
 */
export function spawnWithShell(
  command: string,
  args: string[],
  cwd?: string,
  timeout?: number,
): Promise<number> {
  return new Promise((resolve) => {
    // Shell-escape every argument to prevent injection
    const escapedArgs = args.map(shellEscape);
    const cmdLine = `${command} ${escapedArgs.join(' ')}`;

    const proc = spawn(cmdLine, [], { stdio: 'inherit', shell: true, cwd });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeout && timeout > 0) {
      timer = setTimeout(() => {
        proc.kill('SIGTERM');
        // Give it 5s to exit gracefully, then force kill
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      }, timeout);
    }

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 1);
    });
    proc.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve(1);
    });
  });
}
