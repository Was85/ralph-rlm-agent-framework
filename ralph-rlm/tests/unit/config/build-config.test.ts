import { buildConfig } from '../../../src/config/build-config.js';

describe('buildConfig', () => {
  it('uses defaults when no argv provided', () => {
    const config = buildConfig({});
    expect(config.optimize).toBe(false);
  });

  it('maps optimize flag from argv', () => {
    const config = buildConfig({ optimize: true });
    expect(config.optimize).toBe(true);
  });

  it('preserves existing fields', () => {
    const config = buildConfig({ runner: 'copilot', maxIterations: 20 });
    expect(config.runner).toBe('copilot');
    expect(config.maxIterations).toBe(20);
  });
});
