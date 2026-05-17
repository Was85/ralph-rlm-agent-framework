import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitExec, forceAddAndCommit } from '../../src/core/safe-exec.js';

describe('forceAddAndCommit', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'fac-'));
    await gitExec(['init'], repo);
    await gitExec(['config', 'user.email', 'test@example.com'], repo);
    await gitExec(['config', 'user.name', 'Test'], repo);
    await gitExec(['config', 'commit.gpgsign', 'false'], repo);
    await writeFile(path.join(repo, 'README.md'), 'seed', 'utf-8');
    await gitExec(['add', 'README.md'], repo);
    await gitExec(['commit', '-m', 'seed'], repo);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('commits Ralph-owned paths even when they are gitignored', async () => {
    // The recommended/real setup (e.g. Nodinite.Agent.Frends) gitignores
    // .ralph and feature_list.json — Ralph still must commit them.
    await writeFile(path.join(repo, '.gitignore'), '.ralph/\nfeature_list.json\n', 'utf-8');
    await writeFile(path.join(repo, 'feature_list.json'), '{"features":[]}', 'utf-8');
    await mkdir(path.join(repo, '.ralph', 'features', 'F001'), { recursive: true });
    await writeFile(path.join(repo, '.ralph', 'features', 'F001', 'contract.json'), '{}', 'utf-8');

    const committed = await forceAddAndCommit(
      repo,
      ['feature_list.json', path.join('.ralph', 'features', 'F001')],
      'record harness state for F001',
    );

    expect(committed).toBe(true);
    const { stdout: tracked } = await gitExec(['ls-files'], repo);
    expect(tracked).toContain('feature_list.json');
    expect(tracked).toContain('.ralph/features/F001/contract.json');
  });

  it('returns false when there is nothing to commit', async () => {
    const committed = await forceAddAndCommit(repo, ['does-not-exist.json'], 'noop');

    expect(committed).toBe(false);
  });
});
