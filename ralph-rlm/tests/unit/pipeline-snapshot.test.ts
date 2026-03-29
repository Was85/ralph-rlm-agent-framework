import { buildConfig } from '../../src/config/build-config.js';
import { ClaudeRunner } from '../../src/runners/claude-runner.js';
import { CopilotRunner } from '../../src/runners/copilot-runner.js';
import type { RalphConfig } from '../../src/config/types.js';

function configToRunnerConfig(config: RalphConfig) {
  return {
    verbose: config.verbose,
    debug: config.debug,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
    stream: config.stream,
    bare: false,
    settingSources: undefined,
  };
}

const prompt = 'test prompt';

describe('pipeline snapshot', () => {
  describe('ClaudeRunner', () => {
    const runner = new ClaudeRunner();

    it('no flags', () => {
      const config = buildConfig({});
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('verbose', () => {
      const config = buildConfig({ verbose: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--verbose', '-p', 'test prompt']);
    });

    it('debug', () => {
      const config = buildConfig({ debug: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--debug', '-p', 'test prompt']);
    });

    it('debug + verbose', () => {
      const config = buildConfig({ debug: true, verbose: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--debug', '-p', 'test prompt']);
    });

    it('stream', () => {
      const config = buildConfig({ stream: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--verbose', '--output-format', 'stream-json', '-p', 'test prompt']);
    });

    it('stream + verbose', () => {
      const config = buildConfig({ stream: true, verbose: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--verbose', '--output-format', 'stream-json', '-p', 'test prompt']);
    });

    it('stream + debug', () => {
      const config = buildConfig({ stream: true, debug: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--debug', '--output-format', 'stream-json', '-p', 'test prompt']);
    });

    it('dangerouslySkipPermissions', () => {
      const config = buildConfig({ dangerouslySkipPermissions: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--dangerously-skip-permissions', '-p', 'test prompt']);
    });

    it('bare', () => {
      const args = runner.buildArgs(prompt, { ...configToRunnerConfig(buildConfig({})), bare: true });
      expect(args).toEqual(['--bare', '-p', 'test prompt']);
    });

    it('setting sources', () => {
      const args = runner.buildArgs(prompt, { ...configToRunnerConfig(buildConfig({})), settingSources: 'project,local' });
      expect(args).toEqual(['--setting-sources', 'project,local', '-p', 'test prompt']);
    });

    it('allowAllTools alias', () => {
      const config = buildConfig({ allowAllTools: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--dangerously-skip-permissions', '-p', 'test prompt']);
    });

    it('all flags', () => {
      const config = buildConfig({ dangerouslySkipPermissions: true, debug: true, stream: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--dangerously-skip-permissions', '--debug', '--output-format', 'stream-json', '-p', 'test prompt']);
    });
  });

  describe('CopilotRunner', () => {
    const runner = new CopilotRunner();

    it('no flags', () => {
      const config = buildConfig({});
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('verbose', () => {
      const config = buildConfig({ verbose: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('debug', () => {
      const config = buildConfig({ debug: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('debug + verbose', () => {
      const config = buildConfig({ debug: true, verbose: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('stream', () => {
      const config = buildConfig({ stream: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('stream + verbose', () => {
      const config = buildConfig({ stream: true, verbose: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('stream + debug', () => {
      const config = buildConfig({ stream: true, debug: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['-p', 'test prompt']);
    });

    it('dangerouslySkipPermissions', () => {
      const config = buildConfig({ dangerouslySkipPermissions: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--allow-all-tools', '-p', 'test prompt']);
    });

    it('allowAllTools alias', () => {
      const config = buildConfig({ allowAllTools: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--allow-all-tools', '-p', 'test prompt']);
    });

    it('all flags', () => {
      const config = buildConfig({ allowAllTools: true, debug: true, stream: true });
      const args = runner.buildArgs(prompt, configToRunnerConfig(config));
      expect(args).toEqual(['--allow-all-tools', '-p', 'test prompt']);
    });
  });
});
