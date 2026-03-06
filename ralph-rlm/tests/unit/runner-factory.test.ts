import { createRunner } from '../../src/runners/runner-factory.js';
import { ClaudeRunner } from '../../src/runners/claude-runner.js';
import { CopilotRunner } from '../../src/runners/copilot-runner.js';
import type { RunnerType } from '../../src/config/types.js';

describe('createRunner', () => {
  it('creates ClaudeRunner for "claude"', () => {
    const runner = createRunner('claude');
    expect(runner).toBeInstanceOf(ClaudeRunner);
    expect(runner.type).toBe('claude');
  });

  it('creates CopilotRunner for "copilot"', () => {
    const runner = createRunner('copilot');
    expect(runner).toBeInstanceOf(CopilotRunner);
    expect(runner.type).toBe('copilot');
  });

  it('throws for unknown type', () => {
    expect(() => createRunner('unknown' as RunnerType)).toThrow('Unknown runner type: unknown');
  });
});
