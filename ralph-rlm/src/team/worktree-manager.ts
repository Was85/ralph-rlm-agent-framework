import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import * as logger from '../ui/logger.js';

const execAsync = promisify(exec);

export interface Worktree {
  name: string;
  path: string;
  branch: string;
  featureId: string;
}

export interface MergeResult {
  success: boolean;
  conflicted: boolean;
  error?: string;
}

export interface WorktreeManager {
  create(featureId: string, cwd: string): Promise<Worktree>;
  merge(worktree: Worktree, cwd: string): Promise<MergeResult>;
  cleanup(worktree: Worktree, cwd: string): Promise<void>;
  cleanupAll(cwd: string): Promise<void>;
}

const WORKTREE_DIR = '.claude/worktrees';

export class WorktreeManagerImpl implements WorktreeManager {
  async create(featureId: string, cwd: string): Promise<Worktree> {
    const name = `ralph-${featureId}`;
    const branch = `ralph/${featureId}`;
    const worktreePath = path.join(cwd, WORKTREE_DIR, name);

    await execAsync(
      `git worktree add "${worktreePath}" -b "${branch}"`,
      { cwd },
    );

    return { name, path: worktreePath, branch, featureId };
  }

  async merge(worktree: Worktree, cwd: string): Promise<MergeResult> {
    try {
      await execAsync(
        `git merge "${worktree.branch}" --no-ff --no-edit -m "feat: merge ${worktree.featureId}"`,
        { cwd },
      );
      return { success: true, conflicted: false };
    } catch (err: unknown) {
      // Node exec errors include stdout/stderr as properties
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stdout = (err as { stdout?: string }).stdout ?? '';
      const combined = `${errorMsg}\n${stdout}`;

      // Check if it's a merge conflict
      if (combined.includes('CONFLICT') || combined.includes('Automatic merge failed')) {
        try {
          await execAsync('git merge --abort', { cwd });
        } catch { /* abort may fail if already clean */ }
        return { success: false, conflicted: true, error: combined };
      }

      return { success: false, conflicted: false, error: errorMsg };
    }
  }

  async cleanup(worktree: Worktree, cwd: string): Promise<void> {
    try {
      await execAsync(`git worktree remove "${worktree.path}" --force`, { cwd });
    } catch {
      logger.warning(`Failed to remove worktree: ${worktree.name}`);
    }

    try {
      await execAsync(`git branch -D "${worktree.branch}"`, { cwd });
    } catch {
      // Branch may not exist or already deleted
    }
  }

  async cleanupAll(cwd: string): Promise<void> {
    try {
      // Prune stale worktrees
      await execAsync('git worktree prune', { cwd });

      // List remaining worktrees and remove ralph- ones
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd });
      const lines = stdout.split('\n');
      const worktreePaths: string[] = [];

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const wtPath = line.substring('worktree '.length).trim();
          if (wtPath.includes(`${WORKTREE_DIR}/ralph-`) || wtPath.includes(`${WORKTREE_DIR}\\ralph-`)) {
            worktreePaths.push(wtPath);
          }
        }
      }

      for (const wtPath of worktreePaths) {
        try {
          await execAsync(`git worktree remove "${wtPath}" --force`, { cwd });
        } catch { /* continue cleanup */ }
      }

      // Clean up ralph/ branches
      const { stdout: branches } = await execAsync('git branch', { cwd });
      const ralphBranches = branches
        .split('\n')
        .map(b => b.trim().replace(/^\* /, ''))
        .filter(b => b.startsWith('ralph/'));

      for (const branch of ralphBranches) {
        try {
          await execAsync(`git branch -D "${branch}"`, { cwd });
        } catch { /* continue */ }
      }
    } catch {
      logger.warning('Failed to clean up orphaned worktrees');
    }
  }

  /**
   * Reverts the last merge commit (used when verification fails after merge).
   */
  async revertLastMerge(cwd: string): Promise<void> {
    await execAsync('git reset --hard HEAD~1', { cwd });
  }
}
