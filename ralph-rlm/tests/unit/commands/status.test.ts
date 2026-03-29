import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStatus } from '../../../src/commands/status.js';
import type { FeatureList, RuntimeSessionState, ValidationState } from '../../../src/config/types.js';

describe('status command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'status-cmd-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns status info when all files exist', async () => {
    const featureList: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 4, complete: 2, in_progress: 1, pending: 0, blocked: 1 },
      features: [
        { id: 'F001', description: 'A', status: 'complete', attempts: 1, last_error: null },
        { id: 'F002', description: 'B', status: 'complete', attempts: 1, last_error: null },
        { id: 'F003', description: 'C', status: 'in_progress', attempts: 1, last_error: null },
        { id: 'F004', description: 'D', status: 'blocked', attempts: 5, last_error: 'Build failed' },
      ],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2), 'utf-8');
    await writeFile(path.join(tmpDir, 'prd.md'), '# Requirements\n', 'utf-8');
    const valState: ValidationState = {
      coverage_percent: 85,
      iteration: 2,
      status: 'in_progress',
      gaps: ['missing auth'],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(valState, null, 2), 'utf-8');
    await writeFile(path.join(tmpDir, 'claude-progress.txt'), 'line 1\nline 2\n', 'utf-8');

    const status = await runStatus(tmpDir);

    expect(status.prdExists).toBe(true);
    expect(status.featureListExists).toBe(true);
    expect(status.features!.total).toBe(4);
    expect(status.features!.complete).toBe(2);
    expect(status.features!.blocked).toBe(1);
    expect(status.features!.progressPercent).toBe(50);
    expect(status.validation!.coverage).toBe(85);
    expect(status.validation!.status).toBe('in_progress');
    expect(status.progressLogExists).toBe(true);
    expect(status.progressLogLines).toBe(2);
  });

  it('reports missing files correctly', async () => {
    const status = await runStatus(tmpDir);

    expect(status.prdExists).toBe(false);
    expect(status.featureListExists).toBe(false);
    expect(status.validationExists).toBe(false);
    expect(status.progressLogExists).toBe(false);
  });

  it('suggests next action: create prd.md', async () => {
    const status = await runStatus(tmpDir);

    expect(status.nextAction).toContain('prd.md');
  });

  it('suggests next action: run init', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');

    const status = await runStatus(tmpDir);

    expect(status.nextAction).toContain('init');
  });

  it('suggests next action: run validate', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    const fl: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
      features: [{ id: 'F001', description: 'A', status: 'pending', attempts: 0, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');

    const status = await runStatus(tmpDir);

    expect(status.nextAction).toContain('validate');
  });

  it('suggests next action: run', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    const fl: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 0, in_progress: 0, pending: 1, blocked: 0 },
      features: [{ id: 'F001', description: 'A', status: 'pending', attempts: 0, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    const vs: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(vs, null, 2), 'utf-8');

    const status = await runStatus(tmpDir);

    expect(status.nextAction).toContain('run');
  });

  it('suggests all done when everything is complete', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    const fl: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 1, in_progress: 0, pending: 0, blocked: 0 },
      features: [{ id: 'F001', description: 'A', status: 'complete', attempts: 1, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    const vs: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(vs, null, 2), 'utf-8');

    const status = await runStatus(tmpDir);

    expect(status.nextAction).toContain('done');
  });

  it('includes runtime session details when runtime state exists', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    const fl: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 2, complete: 1, in_progress: 1, pending: 0, blocked: 0 },
      features: [
        { id: 'F001', description: 'A', status: 'complete', attempts: 1, last_error: null },
        { id: 'F002', description: 'B', status: 'in_progress', attempts: 1, last_error: null },
      ],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    const vs: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(vs, null, 2), 'utf-8');
    await mkdir(path.join(tmpDir, '.ralph', 'runtime'), { recursive: true });
    const runtime: RuntimeSessionState = {
      version: 1,
      run_id: 'run-123',
      process_id: 999999,
      mode: 'sequential',
      status: 'interrupted',
      phase: 'feature_harness',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resumed_from_run_id: 'run-122',
      active_feature_ids: ['F002'],
      last_completed_feature_id: 'F001',
      last_summary: 'Interrupted while executing F002.',
      recent_lessons: ['Persist runtime state before cleanup.'],
    };
    await writeFile(
      path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'),
      JSON.stringify(runtime, null, 2),
      'utf-8',
    );

    const status = await runStatus(tmpDir);

    expect(status.runtimeExists).toBe(true);
    expect(status.runtime?.status).toBe('interrupted');
    expect(status.runtime?.activeFeatureIds).toEqual(['F002']);
    expect(status.runtime?.resumedFromRunId).toBe('run-122');
    expect(status.nextAction).toContain('Resume work');
    expect(status.nextAction).toContain('F002');
  });

  it('suggests inspecting runtime artifacts when runtime session is blocked', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    const fl: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 0, in_progress: 0, pending: 0, blocked: 1 },
      features: [{ id: 'F001', description: 'A', status: 'blocked', attempts: 5, last_error: 'failed' }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    const vs: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(vs, null, 2), 'utf-8');
    await mkdir(path.join(tmpDir, '.ralph', 'runtime'), { recursive: true });
    const runtime: RuntimeSessionState = {
      version: 1,
      run_id: 'run-200',
      process_id: 999999,
      mode: 'team',
      status: 'blocked',
      phase: 'post_merge_verification',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resumed_from_run_id: null,
      active_feature_ids: [],
      last_completed_feature_id: null,
      last_summary: 'Post-merge verification failed for F001.',
      recent_lessons: [],
    };
    await writeFile(
      path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'),
      JSON.stringify(runtime, null, 2),
      'utf-8',
    );

    const status = await runStatus(tmpDir);

    expect(status.runtime?.status).toBe('blocked');
    expect(status.nextAction).toContain('blocked runtime summary');
    expect(status.nextAction).toContain('ralph run');
  });

  it('treats a running runtime session with a dead process as resumable interruption state', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\n', 'utf-8');
    const fl: FeatureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 1, complete: 0, in_progress: 1, pending: 0, blocked: 0 },
      features: [{ id: 'F001', description: 'A', status: 'in_progress', attempts: 1, last_error: null }],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(fl, null, 2), 'utf-8');
    const vs: ValidationState = {
      coverage_percent: 100,
      iteration: 1,
      status: 'complete',
      gaps: [],
      last_updated: new Date().toISOString(),
    };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(vs, null, 2), 'utf-8');
    await mkdir(path.join(tmpDir, '.ralph', 'runtime'), { recursive: true });
    const runtime: RuntimeSessionState = {
      version: 1,
      run_id: 'run-300',
      process_id: 999999,
      mode: 'sequential',
      status: 'running',
      phase: 'feature_harness',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resumed_from_run_id: null,
      active_feature_ids: ['F001'],
      last_completed_feature_id: null,
      last_summary: 'Implementing F001.',
      recent_lessons: [],
    };
    await writeFile(
      path.join(tmpDir, '.ralph', 'runtime', 'session-state.json'),
      JSON.stringify(runtime, null, 2),
      'utf-8',
    );

    const status = await runStatus(tmpDir);

    expect(status.runtime?.status).toBe('interrupted');
    expect(status.runtime?.isStale).toBe(true);
    expect(status.runtime?.summary).toContain('no longer running');
    expect(status.nextAction).toContain('Resume work');
  });
});
