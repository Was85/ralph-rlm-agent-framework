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

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'fail-e2e-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('graceful failures E2E', () => {
  // --- init command failures ---

  it('init fails with exit 1 when no .git directory', async () => {
    const result = await runCli(['init'], tmpDir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toLowerCase()).toContain('git');
  });

  it('init fails with exit 1 when no prd.md', async () => {
    await mkdir(path.join(tmpDir, '.git'), { recursive: true });
    const result = await runCli(['init'], tmpDir);
    expect(result.exitCode).toBe(1);
  });

  // --- validate command failures ---

  it('validate fails with exit 1 when no .git directory', async () => {
    const result = await runCli(['validate'], tmpDir);
    expect(result.exitCode).toBe(1);
  });

  it('validate fails with exit 1 when no feature_list.json', async () => {
    await mkdir(path.join(tmpDir, '.git'), { recursive: true });
    await writeFile(path.join(tmpDir, 'prd.md'), '# PRD\nSample product requirements.');
    const result = await runCli(['validate'], tmpDir);
    expect(result.exitCode).toBe(1);
  });

  // --- run command failures ---

  it('run fails with exit 1 when no .git directory', async () => {
    const result = await runCli(['run'], tmpDir);
    expect(result.exitCode).toBe(1);
  });

  it('run fails with exit 1 when no feature_list.json', async () => {
    await mkdir(path.join(tmpDir, '.git'), { recursive: true });
    const result = await runCli(['run'], tmpDir);
    expect(result.exitCode).toBe(1);
    // May fail on feature_list.json missing or CLI not found (CI has no claude binary)
    const output = result.stdout.toLowerCase();
    expect(output.includes('feature_list.json') || output.includes('not found')).toBe(true);
  });

  // --- auto command failures ---

  it('auto fails with exit 1 when no .git directory', async () => {
    const result = await runCli(['auto'], tmpDir);
    expect(result.exitCode).toBe(1);
  });

  // --- General ---

  it('unknown command fails', async () => {
    const result = await runCli(['nonexistent-command'], tmpDir);
    expect(result.exitCode).not.toBe(0);
  });

  it('no command fails', async () => {
    const result = await runCli([], tmpDir);
    expect(result.exitCode).not.toBe(0);
  });

  it('all commands print to stdout, not crash with unhandled exception', async () => {
    const commands: string[][] = [['init'], ['validate'], ['run'], ['auto']];

    for (const args of commands) {
      const result = await runCli(args, tmpDir);
      const combined = result.stdout + result.stderr;
      expect(combined).not.toContain('UnhandledPromiseRejection');
      expect(combined).not.toContain('unhandledRejection');
    }
  }, 120_000);
});
