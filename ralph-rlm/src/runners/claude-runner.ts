import { spawn } from 'node:child_process';
import type { Runner, RunnerConfig, RunnerType } from '../config/types.js';
import { spawnWithShell } from './shell-spawn.js';

export class ClaudeRunner implements Runner {
  readonly type: RunnerType = 'claude';

  buildArgs(prompt: string, config: RunnerConfig): string[] {
    const args: string[] = [];
    if (config.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
    if (config.debug) args.push('--debug');
    else if (config.verbose) args.push('--verbose');
    if (config.stream) {
      if (!config.verbose && !config.debug) args.push('--verbose');
      args.push('--output-format', 'stream-json');
    }
    if (config.maxTurns) args.push('--max-turns', String(config.maxTurns));
    args.push('-p', prompt);
    return args;
  }

  async invoke(prompt: string, config: RunnerConfig): Promise<number> {
    const args = this.buildArgs(prompt, config);
    return spawnWithShell('claude', args, config.cwd, config.timeout);
  }

  async checkInstalled(): Promise<boolean> {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      const proc = spawn(cmd, ['claude'], { stdio: 'ignore', shell: true });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
