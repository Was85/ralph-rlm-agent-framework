import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendRuntimeEvent,
  beginRuntimeSession,
  readRuntimeSessionState,
  setRuntimeSessionState,
  updateRuntimeFeatureState,
} from '../../src/core/runtime-state.js';
import {
  resolveRuntimeEventsPath,
  resolveRuntimeFeatureStatePath,
} from '../../src/core/ralph-paths.js';

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('runtime-state', () => {
  it('creates a session snapshot and supports session updates', async () => {
    const cwd = await createTempDir();

    const started = await beginRuntimeSession(cwd, 'sequential');
    expect(started.status).toBe('running');
    expect(started.phase).toBe('startup');
    expect(started.process_id).toBeGreaterThan(0);

    const updated = await setRuntimeSessionState(cwd, {
      phase: 'feature_harness',
      summary: 'Working on feature F001',
      activeFeatureIds: ['F001'],
      lessons: ['Planner contract was accepted.'],
    });

    expect(updated.phase).toBe('feature_harness');
    expect(updated.active_feature_ids).toEqual(['F001']);
    expect(updated.recent_lessons).toContain('Planner contract was accepted.');

    const persisted = await readRuntimeSessionState(cwd);
    expect(persisted?.last_summary).toBe('Working on feature F001');
  });

  it('records runtime events and per-feature state history', async () => {
    const cwd = await createTempDir();
    const session = await beginRuntimeSession(cwd, 'team');

    await appendRuntimeEvent(cwd, {
      run_id: session.run_id,
      mode: 'team',
      type: 'feature_selected',
      phase: 'select_feature',
      feature_id: 'F001',
      summary: 'Selected F001 for execution.',
    });

    const artifactPaths = ['C:/repo/.ralph/features/F001/assignment.json'];
    const active = await updateRuntimeFeatureState(cwd, 'F001', {}, {
      runId: session.run_id,
      attempt: 1,
      phase: 'prepare_worktree',
      status: 'active',
      summary: 'Preparing worktree for F001.',
      artifactPaths,
      worktreePath: 'C:/repo/.claude/worktrees/ralph-F001',
      branch: 'ralph/F001',
    });

    expect(active.status).toBe('active');
    expect(active.history).toHaveLength(1);

    const completed = await updateRuntimeFeatureState(cwd, 'F001', {
      phase: 'complete',
      status: 'completed',
      summary: 'F001 completed successfully.',
      mergeCommit: 'abc123',
      historyEntry: {
        phase: 'complete',
        outcome: 'completed',
        summary: 'F001 completed successfully.',
      },
    });

    expect(completed.status).toBe('completed');
    expect(completed.merge_commit).toBe('abc123');
    expect(completed.history).toHaveLength(2);
    expect(completed.artifact_paths).toEqual(artifactPaths);

    const eventsPath = resolveRuntimeEventsPath(cwd);
    const featureStatePath = resolveRuntimeFeatureStatePath(cwd, 'F001');
    expect(eventsPath).toContain(path.join('.ralph', 'runtime'));
    expect(featureStatePath).toContain(path.join('.ralph', 'runtime', 'features'));
  });
});

async function createTempDir(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ralph-runtime-'));
  createdDirs.push(cwd);
  return cwd;
}
