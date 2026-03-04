import type { Runner, RunnerType } from '../config/types.js';
import { ClaudeRunner } from './claude-runner.js';
import { CopilotRunner } from './copilot-runner.js';

export function createRunner(type: RunnerType): Runner {
  switch (type) {
    case 'claude': return new ClaudeRunner();
    case 'copilot': return new CopilotRunner();
    default: throw new Error(`Unknown runner type: ${type}`);
  }
}
