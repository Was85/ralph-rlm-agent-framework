import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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

describe('scaffold E2E', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'scaffold-e2e-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates prd.md', async () => {
    await runCli(['scaffold'], tmpDir);
    expect(existsSync(path.join(tmpDir, 'prd.md'))).toBe(true);
  });

  it('creates templates directory', async () => {
    await runCli(['scaffold'], tmpDir);
    expect(existsSync(path.join(tmpDir, 'templates'))).toBe(true);
  });

  it('creates .claude directory for claude runner', async () => {
    await runCli(['scaffold', '--runner', 'claude'], tmpDir);
    expect(existsSync(path.join(tmpDir, '.claude', 'skills', 'ralph'))).toBe(true);
  });

  it('creates .claude/settings.json for claude runner', async () => {
    await runCli(['scaffold', '--runner', 'claude'], tmpDir);
    expect(existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
  });

  it('creates .claude/rules for claude runner', async () => {
    await runCli(['scaffold', '--runner', 'claude'], tmpDir);
    expect(existsSync(path.join(tmpDir, '.claude', 'rules'))).toBe(true);
  });

  it('creates .github/instructions for copilot runner', async () => {
    await runCli(['scaffold', '--runner', 'copilot'], tmpDir);
    expect(existsSync(path.join(tmpDir, '.github', 'instructions'))).toBe(true);
  });

  it('returns exit code 0', async () => {
    const result = await runCli(['scaffold'], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it('stdout shows success messages', async () => {
    const result = await runCli(['scaffold'], tmpDir);
    const output = result.stdout + result.stderr;
    const hasSuccessMessage =
      output.includes('Scaffold') ||
      output.includes('Copied') ||
      output.includes('Created');
    expect(hasSuccessMessage).toBe(true);
  });

  it('is idempotent — running twice skips existing files', async () => {
    const first = await runCli(['scaffold'], tmpDir);
    expect(first.exitCode).toBe(0);

    const second = await runCli(['scaffold'], tmpDir);
    expect(second.exitCode).toBe(0);

    const secondOutput = second.stdout + second.stderr;
    const hasSkipMessage =
      secondOutput.includes('already exists') ||
      secondOutput.includes('skipping') ||
      secondOutput.includes('Skipping');
    expect(hasSkipMessage).toBe(true);
  });

  it('prd.md contains template content', async () => {
    await runCli(['scaffold'], tmpDir);
    const content = await readFile(path.join(tmpDir, 'prd.md'), 'utf-8');
    const hasTemplateContent =
      content.includes('Product Requirements') ||
      content.includes('Requirements') ||
      content.includes('Project Overview');
    expect(hasTemplateContent).toBe(true);
  });
});
