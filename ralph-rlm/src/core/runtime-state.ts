import { mkdir, readFile } from 'node:fs/promises';
import {
  resolveRuntimeDir,
  resolveRuntimeEventsPath,
  resolveRuntimeFeatureStatePath,
  resolveRuntimeFeaturesDir,
  resolveRuntimeSessionPath,
} from './ralph-paths.js';
import { atomicWriteFile, withLock } from './file-lock.js';
import type {
  RuntimeEvent,
  RuntimeFeatureHistoryEntry,
  RuntimeFeatureState,
  RuntimeMode,
  RuntimePhase,
  RuntimeSessionState,
  RuntimeSessionStatus,
  VerificationCommandResult,
} from '../config/types.js';

interface SessionUpdate {
  status?: RuntimeSessionStatus;
  phase?: RuntimePhase;
  summary?: string | null;
  activeFeatureIds?: string[];
  lastCompletedFeatureId?: string | null;
  lessons?: string[];
}

interface FeatureSeed {
  runId: string;
  attempt: number;
  phase: RuntimePhase;
  status: RuntimeFeatureState['status'];
  summary: string;
  artifactPaths: string[];
  worktreePath?: string | null;
  branch?: string | null;
}

interface FeatureUpdate {
  attempt?: number;
  phase?: RuntimePhase;
  status?: RuntimeFeatureState['status'];
  summary?: string | null;
  lastError?: string | null;
  worktreePath?: string | null;
  branch?: string | null;
  mergeCommit?: string | null;
  artifactPaths?: string[];
  commandResults?: VerificationCommandResult[];
  historyEntry?: Omit<RuntimeFeatureHistoryEntry, 'timestamp'>;
}

export async function beginRuntimeSession(cwd: string, mode: RuntimeMode): Promise<RuntimeSessionState> {
  await ensureRuntimeDirs(cwd);
  const previous = await readRuntimeSessionState(cwd);
  const now = timestamp();
  const resumedFromRunId = previous && (previous.status === 'running' || previous.status === 'interrupted')
    ? previous.run_id
    : null;

  const state: RuntimeSessionState = {
    version: 1,
    run_id: `run-${Date.now()}-${process.pid}`,
    process_id: process.pid,
    mode,
    status: 'running',
    phase: 'startup',
    started_at: now,
    updated_at: now,
    resumed_from_run_id: resumedFromRunId,
    active_feature_ids: [],
    last_completed_feature_id: null,
    last_summary: resumedFromRunId
      ? `Runtime session resumed from ${resumedFromRunId}.`
      : 'Runtime session started.',
    recent_lessons: previous?.recent_lessons ?? [],
  };

  await writeRuntimeSessionState(cwd, state);
  await appendRuntimeEvent(cwd, {
    run_id: state.run_id,
    mode,
    type: 'session_started',
    phase: state.phase,
    summary: state.last_summary ?? 'Runtime session started.',
  });
  return state;
}

export async function readRuntimeSessionState(cwd: string): Promise<RuntimeSessionState | null> {
  return readJsonOrNull<RuntimeSessionState>(resolveRuntimeSessionPath(cwd));
}

export async function setRuntimeSessionState(cwd: string, update: SessionUpdate): Promise<RuntimeSessionState> {
  const sessionPath = resolveRuntimeSessionPath(cwd);
  await ensureRuntimeDirs(cwd);
  return withLock(sessionPath, async () => {
    const current = await readJsonOrNull<RuntimeSessionState>(sessionPath);
    if (!current) {
      throw new Error('Runtime session state does not exist. Call beginRuntimeSession first.');
    }

    const next: RuntimeSessionState = {
      ...current,
      process_id: current.process_id ?? process.pid,
      status: update.status ?? current.status,
      phase: update.phase ?? current.phase,
      updated_at: timestamp(),
      active_feature_ids: update.activeFeatureIds ?? current.active_feature_ids,
      last_completed_feature_id: update.lastCompletedFeatureId === undefined
        ? current.last_completed_feature_id
        : update.lastCompletedFeatureId,
      last_summary: update.summary === undefined ? current.last_summary : update.summary,
      recent_lessons: mergeLessons(current.recent_lessons, update.lessons ?? []),
    };

    await atomicWriteFile(sessionPath, JSON.stringify(next, null, 2));
    return next;
  });
}

export async function appendRuntimeEvent(
  cwd: string,
  event: Omit<RuntimeEvent, 'timestamp'>,
): Promise<void> {
  await ensureRuntimeDirs(cwd);
  const eventsPath = resolveRuntimeEventsPath(cwd);
  await withLock(eventsPath, async () => {
    const current = await readJsonOrNull<RuntimeEvent[]>(eventsPath) ?? [];
    current.push({
      ...event,
      timestamp: timestamp(),
    });
    await atomicWriteFile(eventsPath, JSON.stringify(current, null, 2));
  });
}

export async function updateRuntimeFeatureState(
  cwd: string,
  featureId: string,
  update: FeatureUpdate,
  seed?: FeatureSeed,
): Promise<RuntimeFeatureState> {
  await ensureRuntimeDirs(cwd);
  const filePath = resolveRuntimeFeatureStatePath(cwd, featureId);
  return withLock(filePath, async () => {
    const current = await readJsonOrNull<RuntimeFeatureState>(filePath)
      ?? (seed ? createFeatureRuntimeState(featureId, seed) : null);
    if (!current) {
      throw new Error(`Runtime feature state for ${featureId} does not exist.`);
    }

    const history = update.historyEntry
      ? [...current.history, { ...update.historyEntry, timestamp: timestamp() }]
      : current.history;

    const next: RuntimeFeatureState = {
      ...current,
      updated_at: timestamp(),
      attempt: update.attempt ?? current.attempt,
      phase: update.phase ?? current.phase,
      status: update.status ?? current.status,
      summary: update.summary === undefined ? current.summary : update.summary,
      last_error: update.lastError === undefined ? current.last_error : update.lastError,
      worktree_path: update.worktreePath === undefined ? current.worktree_path : update.worktreePath,
      branch: update.branch === undefined ? current.branch : update.branch,
      merge_commit: update.mergeCommit === undefined ? current.merge_commit : update.mergeCommit,
      artifact_paths: update.artifactPaths ?? current.artifact_paths,
      command_results: update.commandResults ?? current.command_results,
      history,
    };

    await atomicWriteFile(filePath, JSON.stringify(next, null, 2));
    return next;
  });
}

async function writeRuntimeSessionState(cwd: string, state: RuntimeSessionState): Promise<void> {
  await ensureRuntimeDirs(cwd);
  await atomicWriteFile(resolveRuntimeSessionPath(cwd), JSON.stringify(state, null, 2));
}

async function ensureRuntimeDirs(cwd: string): Promise<void> {
  await mkdir(resolveRuntimeDir(cwd), { recursive: true });
  await mkdir(resolveRuntimeFeaturesDir(cwd), { recursive: true });
}

function createFeatureRuntimeState(featureId: string, seed: FeatureSeed): RuntimeFeatureState {
  return {
    feature_id: featureId,
    run_id: seed.runId,
    updated_at: timestamp(),
    attempt: seed.attempt,
    phase: seed.phase,
    status: seed.status,
    summary: seed.summary,
    last_error: null,
    worktree_path: seed.worktreePath ?? null,
    branch: seed.branch ?? null,
    merge_commit: null,
    artifact_paths: seed.artifactPaths,
    command_results: [],
    history: [{
      timestamp: timestamp(),
      phase: seed.phase,
      outcome: seed.status,
      summary: seed.summary,
    }],
  };
}

function mergeLessons(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  const next = [...existing];
  for (const lesson of incoming) {
    const trimmed = lesson.trim();
    if (!trimmed) continue;
    if (!next.includes(trimmed)) {
      next.push(trimmed);
    }
  }
  return next.slice(-10);
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function timestamp(): string {
  return new Date().toISOString();
}
