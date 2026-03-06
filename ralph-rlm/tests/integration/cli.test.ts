import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFeatureList } from '../fixtures/feature-list-factory.js';

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

describe('CLI --help', () => {
  it('shows help text with all commands', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toMatch(/init/);
    expect(stdout).toMatch(/validate/);
    expect(stdout).toMatch(/run/);
    expect(stdout).toMatch(/auto/);
    expect(stdout).toMatch(/status/);
    expect(stdout).toMatch(/author/);
    expect(stdout).toMatch(/skill/);
  });

  it('shows global options', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toMatch(/--runner/);
    expect(stdout).toMatch(/--verbose/);
    expect(stdout).toMatch(/--debug/);
    expect(stdout).toMatch(/--stream/);
  });

  it('shows skill subcommands in skill help', async () => {
    const { stdout } = await runCli(['skill', '--help']);

    expect(stdout).toMatch(/get-next-feature/);
    expect(stdout).toMatch(/get-feature-stats/);
    expect(stdout).toMatch(/update-feature-status/);
    expect(stdout).toMatch(/increment-feature-attempts/);
    expect(stdout).toMatch(/claim-feature/);
  });
});

describe('CLI skill subcommands', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-skill-'));
    filePath = path.join(tmpDir, 'feature_list.json').replace(/\\/g, '/');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skill get-next-feature returns pending feature', async () => {
    const data = createFeatureList({ pending: 3 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const { stdout, exitCode } = await runCli(['skill', 'get-next-feature', '--path', filePath]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.status).toBe('pending');
    expect(result.id).toBe('F001');
  });

  it('skill get-feature-stats returns stats without features', async () => {
    const data = createFeatureList({ pending: 2, complete: 1 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const { stdout, exitCode } = await runCli(['skill', 'get-feature-stats', '--path', filePath]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.stats).toBeDefined();
    expect(result.project).toBeDefined();
    expect(result.features).toBeUndefined();
  });

  it('skill update-feature-status updates a feature', async () => {
    const data = createFeatureList({ pending: 3 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const { exitCode } = await runCli([
      'skill', 'update-feature-status',
      '--id', 'F001',
      '--status', 'in_progress',
      '--path', filePath,
    ]);

    expect(exitCode).toBe(0);
    const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const feature = after.features.find((f: { id: string }) => f.id === 'F001');
    expect(feature.status).toBe('in_progress');
  });

  it('skill increment-feature-attempts increments count', async () => {
    const data = createFeatureList({ pending: 3 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const { exitCode } = await runCli([
      'skill', 'increment-feature-attempts',
      '--id', 'F001',
      '--path', filePath,
    ]);

    expect(exitCode).toBe(0);
    const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const feature = after.features.find((f: { id: string }) => f.id === 'F001');
    expect(feature.attempts).toBe(1);
  });

  it('skill claim-feature claims a feature', async () => {
    const data = createFeatureList({ pending: 3 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const { stdout, exitCode } = await runCli([
      'skill', 'claim-feature',
      '--teammate', 'implementer-1',
      '--path', filePath,
    ]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.id).toBe('F001');
    expect(result.status).toBe('in_progress');
    expect(result.claimed_by).toBe('implementer-1');
  });

  it('skill get-next-feature exits 1 when file missing', async () => {
    const { exitCode } = await runCli(['skill', 'get-next-feature', '--path', '/nonexistent/file.json']);

    expect(exitCode).toBe(1);
  });
});
