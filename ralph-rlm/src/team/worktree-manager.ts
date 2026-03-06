import path from 'node:path';
import * as logger from '../ui/logger.js';
import { gitExec } from '../core/safe-exec.js';

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

    await gitExec(['worktree', 'add', worktreePath, '-b', branch], cwd);

    return { name, path: worktreePath, branch, featureId };
  }

  async merge(worktree: Worktree, cwd: string): Promise<MergeResult> {
    // Ensure a clean working tree before merge. Previous merge conflicts,
    // verification runs (vitest cache), or rebase failures can leave dirty state.
    await this.ensureCleanWorkingTree(cwd);

    // Try rebase first to reduce merge conflicts.
    // Rebase replays the branch's commits on top of current HEAD,
    // so the subsequent merge is a fast-forward or trivial.
    try {
      await gitExec(['rebase', 'HEAD', worktree.branch], cwd);
    } catch {
      // Rebase failed — abort and ensure clean state
      try { await gitExec(['rebase', '--abort'], cwd); } catch { /* ignore */ }
      await this.ensureCleanWorkingTree(cwd);
    }

    try {
      await gitExec(
        ['merge', worktree.branch, '--no-ff', '--no-edit', '-m', `feat: merge ${worktree.featureId}`],
        cwd,
      );
      return { success: true, conflicted: false };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stdout = (err as { stdout?: string }).stdout ?? '';
      const combined = `${errorMsg}\n${stdout}`;

      // Abort merge and reset to clean state
      try { await gitExec(['merge', '--abort'], cwd); } catch { /* ignore */ }
      await this.ensureCleanWorkingTree(cwd);

      const conflicted = combined.includes('CONFLICT')
        || combined.includes('Automatic merge failed')
        || combined.includes('unmerged files');

      return { success: false, conflicted, error: combined };
    }
  }

  /**
   * Ensures the working tree is completely clean — no dirty files, no
   * unmerged state. Uses git reset + clean as a nuclear option when needed.
   */
  private async ensureCleanWorkingTree(cwd: string): Promise<void> {
    try {
      const { stdout } = await gitExec(['status', '--porcelain'], cwd);
      if (!stdout.trim()) return;

      // Try stash first (preserves changes for potential recovery)
      try {
        await gitExec(['stash', 'push', '-m', 'ralph-auto-cleanup', '--include-untracked'], cwd);
        return;
      } catch { /* stash can fail on unmerged files */ }

      // Nuclear option: reset + clean
      await gitExec(['reset', '--hard', 'HEAD'], cwd);
      await gitExec(['clean', '-fd'], cwd);
    } catch { /* ignore — best effort */ }
  }

  async cleanup(worktree: Worktree, cwd: string): Promise<void> {
    try {
      await gitExec(['worktree', 'remove', worktree.path, '--force'], cwd);
    } catch {
      logger.warning(`Failed to remove worktree: ${worktree.name}`);
    }

    try {
      await gitExec(['branch', '-D', worktree.branch], cwd);
    } catch {
      // Branch may not exist or already deleted
    }
  }

  async cleanupAll(cwd: string): Promise<void> {
    try {
      // Prune stale worktrees
      await gitExec(['worktree', 'prune'], cwd);

      // List remaining worktrees and remove ralph- ones
      const { stdout } = await gitExec(['worktree', 'list', '--porcelain'], cwd);
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
          await gitExec(['worktree', 'remove', wtPath, '--force'], cwd);
        } catch { /* continue cleanup */ }
      }

      // Clean up ralph/ branches
      const { stdout: branches } = await gitExec(['branch'], cwd);
      const ralphBranches = branches
        .split('\n')
        .map(b => b.trim().replace(/^\* /, ''))
        .filter(b => b.startsWith('ralph/'));

      for (const branch of ralphBranches) {
        try {
          await gitExec(['branch', '-D', branch], cwd);
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
    await gitExec(['reset', '--hard', 'HEAD~1'], cwd);
  }
}
