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
  mergeCommit?: string;
}

export interface WorktreeManager {
  create(featureId: string, cwd: string): Promise<Worktree>;
  merge(worktree: Worktree, cwd: string): Promise<MergeResult>;
  cleanup(worktree: Worktree, cwd: string): Promise<void>;
  cleanupAll(cwd: string): Promise<void>;
  revertLastMerge(cwd: string, mergeCommit: string): Promise<void>;
}

const WORKTREE_DIR = '.claude/worktrees';

export class WorktreeManagerImpl implements WorktreeManager {
  async create(featureId: string, cwd: string): Promise<Worktree> {
    const suffix = createAttemptSuffix();
    const name = `ralph-${featureId}-${suffix}`;
    const branch = `ralph/${featureId}--${suffix}`;
    const worktreePath = path.join(cwd, WORKTREE_DIR, name);

    await gitExec(['worktree', 'add', worktreePath, '-b', branch], cwd);

    return { name, path: worktreePath, branch, featureId };
  }

  async merge(worktree: Worktree, cwd: string): Promise<MergeResult> {
    const mainBranch = await this.getCurrentBranch(cwd);
    await this.abortPendingGitOperations(cwd);
    await this.abortPendingGitOperations(worktree.path);

    // Rebase in the feature worktree so the main checkout stays on the main branch.
    try {
      await gitExec(['rebase', mainBranch], worktree.path);
    } catch {
      try { await gitExec(['rebase', '--abort'], worktree.path); } catch { /* ignore */ }
    }

    try {
      await gitExec(
        ['merge', worktree.branch, '--no-ff', '--no-edit', '-m', `feat: merge ${worktree.featureId}`],
        cwd,
      );
      const { stdout: mergeCommit } = await gitExec(['rev-parse', 'HEAD'], cwd);
      return { success: true, conflicted: false, mergeCommit: mergeCommit.trim() };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stdout = (err as { stdout?: string }).stdout ?? '';
      const combined = `${errorMsg}\n${stdout}`;

      try { await gitExec(['merge', '--abort'], cwd); } catch { /* ignore */ }

      const conflicted = combined.includes('CONFLICT')
        || combined.includes('Automatic merge failed')
        || combined.includes('unmerged files');

      return { success: false, conflicted, error: combined };
    }
  }

  /**
   * Best-effort cleanup of interrupted merge/rebase state without touching
   * regular user changes in the working tree.
   */
  private async abortPendingGitOperations(cwd: string): Promise<void> {
    try { await gitExec(['merge', '--abort'], cwd); } catch { /* ignore */ }
    try { await gitExec(['rebase', '--abort'], cwd); } catch { /* ignore */ }
  }

  private async getCurrentBranch(cwd: string): Promise<string> {
    const { stdout } = await gitExec(['branch', '--show-current'], cwd);
    return stdout.trim() || 'HEAD';
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
  async revertLastMerge(cwd: string, mergeCommit: string): Promise<void> {
    await gitExec(['revert', '-m', '1', '--no-edit', mergeCommit], cwd);
  }
}

function createAttemptSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
