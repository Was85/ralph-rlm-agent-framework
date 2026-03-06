import { fileURLToPath } from 'node:url';
import path from 'node:path';

describe('Windows path resolution', () => {
  it('fileURLToPath does not produce double drive letter', () => {
    // Simulate the pattern used by our ESM modules
    // On Windows, import.meta.url looks like: file:///C:/Users/.../dist/cli.js
    const fakeUrl = process.platform === 'win32'
      ? 'file:///C:/Users/test/node_modules/@alcinanet/ralph-rlm/dist/cli.js'
      : 'file:///home/user/node_modules/@alcinanet/ralph-rlm/dist/cli.js';

    const resolved = fileURLToPath(fakeUrl);

    // Must NOT contain double drive letter like C:\C:\ or /C:/
    expect(resolved).not.toMatch(/[A-Z]:\\[A-Z]:\\/);
    expect(resolved).not.toMatch(/\/[A-Z]:\//);

    // path.dirname + path.resolve should produce a valid directory
    const dir = path.dirname(resolved);
    const assetsDir = path.resolve(dir, '..', 'scaffold-assets');

    // Must be a proper absolute path
    expect(path.isAbsolute(assetsDir)).toBe(true);
    // Must NOT contain double drive letter
    expect(assetsDir).not.toMatch(/[A-Z]:\\[A-Z]:\\/);
  });

  it('new URL().pathname produces broken paths on Windows', () => {
    // This is the BROKEN pattern we replaced
    // On Windows, new URL('file:///C:/...').pathname returns /C:/...
    const fakeUrl = 'file:///C:/Users/test/node_modules/dist/cli.js';
    const broken = new URL(fakeUrl).pathname;

    if (process.platform === 'win32') {
      // On Windows this produces /C:/... which when joined creates C:\C:\
      expect(broken).toMatch(/^\/[A-Z]:/);
    }
    // On Linux this test is informational only
  });
});
