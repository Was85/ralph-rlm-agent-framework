import { buildConfig } from '../../../src/config/build-config.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

describe('buildConfig', () => {
  it('uses defaults when no argv provided', () => {
    const config = buildConfig({});
    expect(config.optimize).toBe(false);
    expect(config.generations).toBe(5);
    expect(config.staleLimit).toBe(3);
  });

  it('maps optimize flag from argv', () => {
    const config = buildConfig({ optimize: true });
    expect(config.optimize).toBe(true);
  });

  it('maps generations from argv', () => {
    const config = buildConfig({ generations: 10 });
    expect(config.generations).toBe(10);
  });

  it('maps staleLimit from argv', () => {
    const config = buildConfig({ staleLimit: 5 });
    expect(config.staleLimit).toBe(5);
  });

  it('preserves existing fields', () => {
    const config = buildConfig({ runner: 'copilot', maxIterations: 20 });
    expect(config.runner).toBe('copilot');
    expect(config.maxIterations).toBe(20);
  });
});
