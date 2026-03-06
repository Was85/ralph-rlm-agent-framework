import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const execAsync = promisify(exec);

const cliPath = path.resolve('src/cli.ts').replace(/\\/g, '/');

async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const escaped = args.map(a => `"${a}"`).join(' ');
  const cmd = `npx tsx "${cliPath}" ${escaped}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 30_000 });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

describe('status E2E', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'status-e2e-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns exit code 0 with empty project', async () => {
    const result = await runCli(['status'], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it('reports prd.md not found', async () => {
    const result = await runCli(['status'], tmpDir);
    expect(result.stdout.toLowerCase()).toContain('prd.md');
    expect(result.stdout.toLowerCase()).toContain('not found');
  });

  it('reports prd.md exists when present', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# Product Requirements\n\nSome content here.');
    const result = await runCli(['status'], tmpDir);
    expect(result.stdout.toLowerCase()).toContain('prd.md');
    expect(result.stdout.toLowerCase()).toContain('exists');
  });

  it('reports feature_list.json not found', async () => {
    const result = await runCli(['status'], tmpDir);
    expect(result.stdout.toLowerCase()).toContain('feature_list.json');
    expect(result.stdout.toLowerCase()).toContain('not found');
  });

  it('reports feature stats when feature_list.json exists', async () => {
    const featureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 3, complete: 1, in_progress: 1, pending: 1, blocked: 0 },
      features: [
        { id: 'F001', description: 'Feature 1', status: 'complete', attempts: 1, last_error: null },
        { id: 'F002', description: 'Feature 2', status: 'in_progress', attempts: 0, last_error: null },
        { id: 'F003', description: 'Feature 3', status: 'pending', attempts: 0, last_error: null },
      ],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2));

    const result = await runCli(['status'], tmpDir);
    expect(result.stdout).toContain('Complete: 1');
    expect(result.stdout).toContain('Pending: 1');
    expect(result.stdout).toContain('33%');
  });

  it('suggests next action -- create prd.md', async () => {
    const result = await runCli(['status'], tmpDir);
    expect(result.stdout.toLowerCase()).toMatch(/create prd\.md|prd\.md/);
  });

  it('suggests next action -- run ralph init', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# Product Requirements\n\nSome content here.');
    const result = await runCli(['status'], tmpDir);
    expect(result.stdout.toLowerCase()).toContain('ralph init');
  });

  it('suggests next action -- all done', async () => {
    await writeFile(path.join(tmpDir, 'prd.md'), '# Product Requirements\n\nSome content here.');

    const featureList = {
      project: 'test',
      config: { max_attempts_per_feature: 5 },
      stats: { total: 2, complete: 2, in_progress: 0, pending: 0, blocked: 0 },
      features: [
        { id: 'F001', description: 'Feature 1', status: 'complete', attempts: 1, last_error: null },
        { id: 'F002', description: 'Feature 2', status: 'complete', attempts: 2, last_error: null },
      ],
    };
    await writeFile(path.join(tmpDir, 'feature_list.json'), JSON.stringify(featureList, null, 2));

    const validationState = { status: 'complete' };
    await writeFile(path.join(tmpDir, 'validation-state.json'), JSON.stringify(validationState, null, 2));

    const result = await runCli(['status'], tmpDir);
    expect(result.stdout.toLowerCase()).toMatch(/all done|done/);
  });
});
