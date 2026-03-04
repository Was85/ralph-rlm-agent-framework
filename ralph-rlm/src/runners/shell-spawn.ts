import { spawn } from 'node:child_process';

/**
 * Spawns a command with proper argument quoting on all platforms.
 *
 * On Windows, Node.js `spawn` with `shell: true` joins args with spaces
 * WITHOUT quoting them individually. This breaks any arg that contains spaces
 * (e.g. a prompt string). We fix this by building the full command string
 * ourselves and passing it as a single token.
 */
export function spawnWithShell(command: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    let proc;

    if (process.platform === 'win32') {
      // Quote each arg that contains spaces or special characters
      const quoted = args.map((a) => (needsQuoting(a) ? `"${a}"` : a));
      const cmdLine = `${command} ${quoted.join(' ')}`;
      proc = spawn(cmdLine, [], { stdio: 'inherit', shell: true, cwd });
    } else {
      proc = spawn(command, args, { stdio: 'inherit', shell: true, cwd });
    }

    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', () => resolve(1));
  });
}

function needsQuoting(arg: string): boolean {
  return arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('>') || arg.includes('<');
}
