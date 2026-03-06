import lockfile from 'proper-lockfile';
import { LOCK_STALE_MS, LOCK_RETRY_MS, LOCK_RETRIES } from '../config/defaults.js';

export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const release = await lockfile.lock(filePath, {
    stale: LOCK_STALE_MS,
    retries: {
      retries: LOCK_RETRIES,
      minTimeout: LOCK_RETRY_MS,
      maxTimeout: LOCK_RETRY_MS,
    },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
