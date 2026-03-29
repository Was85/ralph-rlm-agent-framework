import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureProjectPrompts } from '../../src/core/project-prompts.js';

const tempDirs: string[] = [];

describe('ensureProjectPrompts', () => {
  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('copies packaged prompts into .ralph/prompts when local prompts are missing', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'ralph-project-prompts-'));
    const packaged = await mkdtemp(path.join(tmpdir(), 'ralph-packaged-prompts-'));
    tempDirs.push(cwd, packaged);

    await writeFile(path.join(packaged, 'initializer.md'), 'packaged init prompt', 'utf-8');
    await writeFile(path.join(packaged, 'validator.md'), 'packaged validator prompt', 'utf-8');

    const resolved = ensureProjectPrompts(cwd, packaged);
    const copiedPath = path.join(cwd, '.ralph', 'prompts', 'initializer.md');

    expect(resolved).toBe(path.join(cwd, '.ralph', 'prompts'));
    expect(existsSync(copiedPath)).toBe(true);
    expect(await readFile(copiedPath, 'utf-8')).toBe('packaged init prompt');
  });

  it('prefers existing local prompts without overwriting them', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'ralph-project-prompts-'));
    const packaged = await mkdtemp(path.join(tmpdir(), 'ralph-packaged-prompts-'));
    tempDirs.push(cwd, packaged);

    const localPrompts = path.join(cwd, '.ralph', 'prompts');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(localPrompts, { recursive: true });
    await writeFile(path.join(localPrompts, 'initializer.md'), 'local init prompt', 'utf-8');
    await writeFile(path.join(packaged, 'initializer.md'), 'packaged init prompt', 'utf-8');

    const resolved = ensureProjectPrompts(cwd, packaged);

    expect(resolved).toBe(localPrompts);
    expect(await readFile(path.join(localPrompts, 'initializer.md'), 'utf-8')).toBe('local init prompt');
  });
});
