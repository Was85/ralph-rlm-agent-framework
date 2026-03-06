import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execAsync = promisify(exec);

const cliPath = path.resolve('src/cli.ts').replace(/\\/g, '/');

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const escaped = args.map(a => `"${a}"`).join(' ');
  const cmd = `npx tsx "${cliPath}" ${escaped}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: process.cwd(),
      timeout: 30_000,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
    };
  }
}

describe('CLI parameter parsing', () => {
  // Global flags accepted by status command

  it('accepts --runner claude', async () => {
    const result = await runCli(['status', '--runner', 'claude']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --runner copilot', async () => {
    const result = await runCli(['status', '--runner', 'copilot']);
    expect(result.exitCode).toBe(0);
  });

  it('rejects invalid --runner', async () => {
    const result = await runCli(['status', '--runner', 'invalid']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeTruthy();
  });

  it('accepts --max-iterations', async () => {
    const result = await runCli(['status', '--max-iterations', '10']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts -m alias', async () => {
    const result = await runCli(['status', '-m', '10']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --max-validate-iterations', async () => {
    const result = await runCli(['status', '--max-validate-iterations', '5']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --coverage-threshold', async () => {
    const result = await runCli(['status', '--coverage-threshold', '80']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts -c alias', async () => {
    const result = await runCli(['status', '-c', '80']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --sleep-between', async () => {
    const result = await runCli(['status', '--sleep-between', '5']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts -s alias', async () => {
    const result = await runCli(['status', '-s', '5']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --verbose', async () => {
    const result = await runCli(['status', '--verbose']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts -v alias', async () => {
    const result = await runCli(['status', '-v']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --debug', async () => {
    const result = await runCli(['status', '--debug']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --stream', async () => {
    const result = await runCli(['status', '--stream']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --dangerously-skip-permissions', async () => {
    const result = await runCli(['status', '--dangerously-skip-permissions']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts --allow-all-tools', async () => {
    const result = await runCli(['status', '--allow-all-tools']);
    expect(result.exitCode).toBe(0);
  });

  it('accepts all global flags combined', async () => {
    const result = await runCli([
      'status',
      '--runner', 'claude',
      '-m', '10',
      '--max-validate-iterations', '5',
      '-c', '80',
      '-s', '1',
      '-v',
      '--debug',
      '--stream',
      '--dangerously-skip-permissions',
      '--allow-all-tools',
    ]);
    expect(result.exitCode).toBe(0);
  });

  // Run-specific flags in help

  it('run --help shows --team', async () => {
    const result = await runCli(['run', '--help']);
    expect(result.stdout).toContain('--team');
  });

  it('run --help shows --teammates', async () => {
    const result = await runCli(['run', '--help']);
    expect(result.stdout).toContain('--teammates');
  });

  it('run --help shows --skip-review', async () => {
    const result = await runCli(['run', '--help']);
    expect(result.stdout).toContain('--skip-review');
  });
});
