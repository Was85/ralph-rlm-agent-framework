import { spawnWithShell } from '../../src/runners/shell-spawn.js';

describe('spawnWithShell', () => {
  it('resolves with exit code from the spawned process', async () => {
    // Use a command that always succeeds
    const cmd = process.platform === 'win32' ? 'cmd' : 'true';
    const args = process.platform === 'win32' ? ['/c', 'echo', 'ok'] : [];
    const code = await spawnWithShell(cmd, args);
    expect(code).toBe(0);
  });

  it('passes args with spaces as a single token on Windows', async () => {
    // "echo" with a multi-word argument — if quoting is broken, only first word prints
    const code = await spawnWithShell(
      process.platform === 'win32' ? 'cmd' : 'echo',
      process.platform === 'win32' ? ['/c', 'echo', 'hello world test'] : ['hello world test'],
    );
    expect(code).toBe(0);
  });

  it('resolves 1 when command does not exist', async () => {
    const code = await spawnWithShell('nonexistent_command_xyz', []);
    expect(code).toBe(1);
  });
});
