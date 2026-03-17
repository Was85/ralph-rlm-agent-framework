import { spawnWithShell } from '../../src/runners/shell-spawn.js';

describe('spawnWithShell', () => {
  it('resolves with exit code from the spawned process', async () => {
    // shell: true means the shell resolves 'echo' on all platforms
    const code = await spawnWithShell('echo', ['ok']);
    expect(code).toBe(0);
  });

  it('passes args with spaces as a single token', async () => {
    // "echo" with a multi-word argument — if quoting is broken, only first word prints
    const code = await spawnWithShell('echo', ['hello world test']);
    expect(code).toBe(0);
  });

  it('resolves non-zero when command does not exist', async () => {
    const code = await spawnWithShell('nonexistent_command_xyz', []);
    expect(code).not.toBe(0);
  });
});
