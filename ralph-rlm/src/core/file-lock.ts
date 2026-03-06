import { writeFile, readFile, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { LOCK_STALE_MS, LOCK_RETRY_MS, LOCK_RETRIES } from '../config/defaults.js';

const lockFiles = new Map<string, string>();

function lockPath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Acquires a file lock using a .lock file pattern.
 * Retries up to LOCK_RETRIES times with LOCK_RETRY_MS delay.
 * Stale locks (older than LOCK_STALE_MS) are automatically broken.
 */
async function acquire(filePath: string): Promise<void> {
  const lock = lockPath(filePath);

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      // O_EXCL-like behavior: writeFile with flag 'wx' fails if file exists
      await writeFile(lock, JSON.stringify({ pid: process.pid, time: Date.now() }), { flag: 'wx' });
      lockFiles.set(filePath, lock);
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // Check if lock is stale
      try {
        const raw = await readFile(lock, 'utf-8');
        const { time } = JSON.parse(raw) as { time: number };
        if (Date.now() - time > LOCK_STALE_MS) {
          await unlink(lock).catch(() => {});
          continue; // Retry immediately after breaking stale lock
        }
      } catch {
        // Corrupted lock file — remove and retry
        await unlink(lock).catch(() => {});
        continue;
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  throw new Error(`Failed to acquire lock on ${filePath} after ${LOCK_RETRIES} attempts`);
}

/**
 * Releases a file lock.
 */
async function release(filePath: string): Promise<void> {
  const lock = lockFiles.get(filePath);
  if (lock) {
    await unlink(lock).catch(() => {});
    lockFiles.delete(filePath);
  }
}

/**
 * Executes a function while holding a file lock.
 * Ensures the lock is released even if the function throws.
 */
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await acquire(filePath);
  try {
    return await fn();
  } finally {
    await release(filePath);
  }
}

/**
 * Writes content to a file atomically by writing to a temp file first,
 * then renaming. This prevents corruption if the process crashes mid-write.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, filePath);
}

/**
 * Cleans up any lingering lock files on process exit.
 */
function cleanupLocks(): void {
  for (const lock of lockFiles.values()) {
    try {
      if (existsSync(lock)) {
        const fs = require('node:fs');
        fs.unlinkSync(lock);
      }
    } catch { /* best effort */ }
  }
}

process.on('exit', cleanupLocks);
