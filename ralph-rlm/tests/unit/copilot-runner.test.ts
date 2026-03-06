import { CopilotRunner } from '../../src/runners/copilot-runner.js';
import type { RunnerConfig } from '../../src/config/types.js';

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    verbose: false,
    debug: false,
    dangerouslySkipPermissions: false,
    stream: false,
    ...overrides,
  };
}

describe('CopilotRunner', () => {
  let runner: CopilotRunner;

  beforeEach(() => {
    runner = new CopilotRunner();
  });

  it('has type "copilot"', () => {
    expect(runner.type).toBe('copilot');
  });

  describe('buildArgs', () => {
    it('returns base args with prompt', () => {
      const args = runner.buildArgs('hello', makeConfig());
      expect(args).toEqual(['-p', 'hello']);
    });

    it('adds --allow-all-tools when dangerouslySkipPermissions', () => {
      const args = runner.buildArgs('hello', makeConfig({ dangerouslySkipPermissions: true }));
      expect(args).toContain('--allow-all-tools');
    });

    it('does NOT add --verbose', () => {
      const args = runner.buildArgs('hello', makeConfig({ verbose: true }));
      expect(args).not.toContain('--verbose');
    });

    it('does NOT add --debug', () => {
      const args = runner.buildArgs('hello', makeConfig({ debug: true }));
      expect(args).not.toContain('--debug');
    });

    it('does NOT add --output-format for stream', () => {
      const args = runner.buildArgs('hello', makeConfig({ stream: true }));
      expect(args).not.toContain('--output-format');
      expect(args).not.toContain('stream-json');
    });
  });
});
