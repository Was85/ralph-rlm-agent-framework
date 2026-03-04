import { spawn } from 'node:child_process';
import type { Runner, RunnerConfig, RunnerType } from '../config/types.js';
import { spawnWithShell } from './shell-spawn.js';

export class CopilotRunner implements Runner {
  readonly type: RunnerType = 'copilot';

  buildArgs(prompt: string, config: RunnerConfig): string[] {
    const args: string[] = [];
    if (config.dangerouslySkipPermissions) args.push('--allow-all-tools');
    args.push('-p', prompt);
    return args;
  }

  async invoke(prompt: string, config: RunnerConfig): Promise<number> {
    const args = this.buildArgs(prompt, config);
    return spawnWithShell('copilot', args, config.cwd);
  }

  async checkInstalled(): Promise<boolean> {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      const proc = spawn(cmd, ['copilot'], { stdio: 'ignore', shell: true });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
