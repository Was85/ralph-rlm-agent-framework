import { ClaudeRunner } from '../../src/runners/claude-runner.js';
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

describe('ClaudeRunner', () => {
  let runner: ClaudeRunner;

  beforeEach(() => {
    runner = new ClaudeRunner();
  });

  it('has type "claude"', () => {
    expect(runner.type).toBe('claude');
  });

  describe('buildArgs', () => {
    it('returns ["-p", prompt] with no flags', () => {
      const args = runner.buildArgs('hello', makeConfig());
      expect(args).toEqual(['-p', 'hello']);
    });

    it('adds --dangerously-skip-permissions when set', () => {
      const args = runner.buildArgs('hello', makeConfig({ dangerouslySkipPermissions: true }));
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args[0]).toBe('--dangerously-skip-permissions');
      expect(args).toContain('-p');
    });

    it('adds --verbose when verbose', () => {
      const args = runner.buildArgs('hello', makeConfig({ verbose: true }));
      expect(args).toContain('--verbose');
      expect(args).not.toContain('--debug');
    });

    it('adds --debug when debug (not --verbose)', () => {
      const args = runner.buildArgs('hello', makeConfig({ debug: true }));
      expect(args).toContain('--debug');
      expect(args).not.toContain('--verbose');
    });

    it('debug takes priority over verbose', () => {
      const args = runner.buildArgs('hello', makeConfig({ debug: true, verbose: true }));
      expect(args).toContain('--debug');
      expect(args).not.toContain('--verbose');
    });

    it('stream adds --output-format stream-json', () => {
      const args = runner.buildArgs('hello', makeConfig({ stream: true }));
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
    });

    it('stream auto-adds --verbose if not already set', () => {
      const args = runner.buildArgs('hello', makeConfig({ stream: true }));
      expect(args).toContain('--verbose');
      expect(args).toContain('--output-format');
    });

    it('stream does not double-add --verbose when already verbose', () => {
      const args = runner.buildArgs('hello', makeConfig({ stream: true, verbose: true }));
      const verboseCount = args.filter((a) => a === '--verbose').length;
      expect(verboseCount).toBe(1);
    });

    it('adds --max-turns when maxTurns set', () => {
      const args = runner.buildArgs('hello', makeConfig({ maxTurns: 10 }));
      expect(args).toContain('--max-turns');
      expect(args).toContain('10');
    });
  });
});
