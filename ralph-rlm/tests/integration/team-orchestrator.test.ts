import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TeamOrchestrator } from '../../src/team/team-orchestrator.js';
import type { RalphConfig, Runner, RunnerConfig, RunnerType } from '../../src/config/types.js';
import { createFeatureList } from '../fixtures/feature-list-factory.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

/** Fake runner that just records invocations and returns a configurable exit code */
class FakeRunner implements Runner {
  readonly type: RunnerType = 'claude';
  invocations: Array<{ prompt: string; config: RunnerConfig }> = [];
  exitCode = 0;
  onInvoke?: (prompt: string) => Promise<void>;

  async invoke(prompt: string, config: RunnerConfig): Promise<number> {
    this.invocations.push({ prompt, config });
    if (this.onInvoke) await this.onInvoke(prompt);
    return this.exitCode;
  }

  async checkInstalled(): Promise<boolean> {
    return true;
  }
}

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return { ...DEFAULT_CONFIG, maxIterations: 3, ...overrides };
}

describe('TeamOrchestrator', () => {
  let tmpDir: string;
  let runner: FakeRunner;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ralph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    // Create .git dir so preflight can pass (if checked)
    await mkdir(path.join(tmpDir, '.git'), { recursive: true });
    runner = new FakeRunner();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when all features are already complete', async () => {
    const data = createFeatureList({ complete: 3, pending: 0 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    const orch = new TeamOrchestrator(runner, makeConfig(), tmpDir);
    const result = await orch.run();

    expect(result).toBe(0);
    expect(runner.invocations).toHaveLength(0);
  });

  it('returns 2 when only blocked features remain', async () => {
    const data = createFeatureList({ complete: 2, blocked: 1, pending: 0 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    const orch = new TeamOrchestrator(runner, makeConfig(), tmpDir);
    const result = await orch.run();

    expect(result).toBe(2);
    expect(runner.invocations).toHaveLength(0);
  });

  it('invokes runner with pending features', async () => {
    const data = createFeatureList({ pending: 2 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    // After first invoke, mark all features complete so the loop exits
    runner.onInvoke = async () => {
      const completeData = createFeatureList({ complete: 2, pending: 0 });
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(completeData, null, 2));
    };

    const orch = new TeamOrchestrator(runner, makeConfig(), tmpDir);
    const result = await orch.run();

    expect(result).toBe(0);
    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]!.config.maxTurns).toBeGreaterThan(0);
  });

  it('repairs stats after each iteration', async () => {
    const data = createFeatureList({ pending: 1 });
    // Corrupt the stats
    data.stats.pending = 999;
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    runner.onInvoke = async () => {
      const completeData = createFeatureList({ complete: 1, pending: 0 });
      // Also corrupt stats
      completeData.stats.complete = 0;
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(completeData, null, 2));
    };

    const orch = new TeamOrchestrator(runner, makeConfig(), tmpDir);
    await orch.run();

    // Stats should be repaired
    const raw = await readFile(path.join(tmpDir, 'feature_list.json'), 'utf-8');
    const result = JSON.parse(raw);
    expect(result.stats.complete).toBe(1);
    expect(result.stats.pending).toBe(0);
  });

  it('stops after maxIterations', async () => {
    const data = createFeatureList({ pending: 5 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    // Runner never completes features
    const orch = new TeamOrchestrator(runner, makeConfig({ maxIterations: 2 }), tmpDir);
    const result = await orch.run();

    expect(result).toBe(1);
    expect(runner.invocations).toHaveLength(2);
  });

  it('calculates maxTurns from remaining features', async () => {
    const data = createFeatureList({ pending: 4 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    runner.onInvoke = async () => {
      const completeData = createFeatureList({ complete: 4, pending: 0 });
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(completeData, null, 2));
    };

    const orch = new TeamOrchestrator(runner, makeConfig(), tmpDir);
    await orch.run();

    // maxTurns = 50 base + 5 per feature = 50 + 20 = 70
    expect(runner.invocations[0]!.config.maxTurns).toBe(70);
  });

  it('passes runner config flags through', async () => {
    const data = createFeatureList({ pending: 1 });
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(data, null, 2));

    runner.onInvoke = async () => {
      const completeData = createFeatureList({ complete: 1, pending: 0 });
      await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(completeData, null, 2));
    };

    const config = makeConfig({ verbose: true, dangerouslySkipPermissions: true, stream: true });
    const orch = new TeamOrchestrator(runner, config, tmpDir);
    await orch.run();

    const invocation = runner.invocations[0]!;
    expect(invocation.config.verbose).toBe(true);
    expect(invocation.config.dangerouslySkipPermissions).toBe(true);
    expect(invocation.config.stream).toBe(true);
  });
});
