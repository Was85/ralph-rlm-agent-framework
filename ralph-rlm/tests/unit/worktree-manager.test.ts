import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeManagerImpl } from '../../src/team/worktree-manager.js';

const execAsync = promisify(exec);

describe('WorktreeManager', () => {
  let tmpDir: string;
  let manager: WorktreeManagerImpl;
  let mainBranch: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'wt-test-'));
    manager = new WorktreeManagerImpl();

    // Initialize a real git repo with an initial commit
    await execAsync('git init', { cwd: tmpDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
    await execAsync('git config user.name "Test"', { cwd: tmpDir });
    await writeFile(path.join(tmpDir, 'README.md'), '# Test', 'utf-8');
    await execAsync('git add .', { cwd: tmpDir });
    await execAsync('git commit -m "initial"', { cwd: tmpDir });
    const { stdout } = await execAsync('git branch --show-current', { cwd: tmpDir });
    mainBranch = stdout.trim();
  });

  afterEach(async () => {
    // Clean up worktrees before deleting tmpDir
    try {
      await execAsync('git worktree prune', { cwd: tmpDir });
    } catch { /* ignore */ }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a worktree with correct branch name', async () => {
    const wt = await manager.create('F001', tmpDir);

    expect(wt.name).toMatch(/^ralph-F001-/);
    expect(wt.branch).toMatch(/^ralph\/F001--/);
    expect(wt.featureId).toBe('F001');
    expect(existsSync(wt.path)).toBe(true);

    // Verify git branch exists
    const { stdout } = await execAsync('git branch', { cwd: tmpDir });
    expect(stdout).toContain(wt.branch);
  });

  it('worktree has its own working copy', async () => {
    const wt = await manager.create('F001', tmpDir);

    // Write a file in the worktree
    await writeFile(path.join(wt.path, 'feature.txt'), 'hello', 'utf-8');

    // Should not exist in main repo
    expect(existsSync(path.join(tmpDir, 'feature.txt'))).toBe(false);
    // Should exist in worktree
    expect(existsSync(path.join(wt.path, 'feature.txt'))).toBe(true);
  });

  it('merges worktree changes back to main', async () => {
    const wt = await manager.create('F001', tmpDir);
    const { stdout: mainHeadBefore } = await execAsync('git rev-parse HEAD', { cwd: tmpDir });

    // Make a commit in the worktree
    await writeFile(path.join(wt.path, 'feature.txt'), 'hello', 'utf-8');
    await execAsync('git add .', { cwd: wt.path });
    await execAsync('git commit -m "feat: F001"', { cwd: wt.path });

    // Merge back
    const result = await manager.merge(wt, tmpDir);

    expect(result.success).toBe(true);
    expect(result.conflicted).toBe(false);
    expect(result.mergeCommit).toBeTruthy();

    // File should now exist in main repo
    expect(existsSync(path.join(tmpDir, 'feature.txt'))).toBe(true);
    const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: tmpDir });
    expect(currentBranch.trim()).toBe(mainBranch);
    const { stdout: mainHeadAfter } = await execAsync('git rev-parse HEAD', { cwd: tmpDir });
    expect(mainHeadAfter.trim()).not.toBe(mainHeadBefore.trim());
    expect(mainHeadAfter.trim()).toBe(result.mergeCommit);
  });

  it('detects merge conflicts', async () => {
    const wt = await manager.create('F001', tmpDir);

    // Modify README in both main and worktree
    await writeFile(path.join(tmpDir, 'README.md'), '# Main changes', 'utf-8');
    await execAsync('git add .', { cwd: tmpDir });
    await execAsync('git commit -m "main change"', { cwd: tmpDir });

    await writeFile(path.join(wt.path, 'README.md'), '# Worktree changes', 'utf-8');
    await execAsync('git add .', { cwd: wt.path });
    await execAsync('git commit -m "wt change"', { cwd: wt.path });

    // Merge should detect conflict
    const result = await manager.merge(wt, tmpDir);

    expect(result.success).toBe(false);
    expect(result.conflicted).toBe(true);
    expect(result.error).toContain('CONFLICT');
    const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: tmpDir });
    expect(currentBranch.trim()).toBe(mainBranch);
  });

  it('cleans up worktree and branch', async () => {
    const wt = await manager.create('F001', tmpDir);
    expect(existsSync(wt.path)).toBe(true);

    await manager.cleanup(wt, tmpDir);

    // Worktree directory should be gone
    expect(existsSync(wt.path)).toBe(false);

    // Branch should be deleted
    const { stdout } = await execAsync('git branch', { cwd: tmpDir });
    expect(stdout).not.toContain('ralph/F001');
  });

  it('cleanupAll removes all ralph worktrees and branches', async () => {
    const wt1 = await manager.create('F001', tmpDir);
    const wt2 = await manager.create('F002', tmpDir);

    const { stdout: before } = await execAsync('git branch', { cwd: tmpDir });
    expect(before).toContain(wt1.branch);
    expect(before).toContain(wt2.branch);

    await manager.cleanupAll(tmpDir);

    const { stdout: after } = await execAsync('git branch', { cwd: tmpDir });
    expect(after).not.toContain(wt1.branch);
    expect(after).not.toContain(wt2.branch);
  });

  it('creates a fresh worktree even when a legacy feature branch already exists', async () => {
    await execAsync('git branch ralph/F001', { cwd: tmpDir });

    const wt = await manager.create('F001', tmpDir);

    expect(wt.branch).toMatch(/^ralph\/F001--/);
    expect(wt.branch).not.toBe('ralph/F001');
    expect(existsSync(wt.path)).toBe(true);
  });

  it('revertLastMerge undoes a merge commit', async () => {
    const wt = await manager.create('F001', tmpDir);

    await writeFile(path.join(wt.path, 'feature.txt'), 'hello', 'utf-8');
    await execAsync('git add .', { cwd: wt.path });
    await execAsync('git commit -m "feat: F001"', { cwd: wt.path });

    const mergeResult = await manager.merge(wt, tmpDir);
    expect(existsSync(path.join(tmpDir, 'feature.txt'))).toBe(true);

    expect(mergeResult.mergeCommit).toBeTruthy();
    await manager.revertLastMerge(tmpDir, mergeResult.mergeCommit!);
    expect(existsSync(path.join(tmpDir, 'feature.txt'))).toBe(false);
    const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: tmpDir });
    expect(currentBranch.trim()).toBe(mainBranch);
  });
});
