import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Ensure prompt files exist inside the project so runners with repo-only
 * sandboxes can read them. Falls back to the packaged prompt directory if
 * local materialization fails for any reason.
 */
export function ensureProjectPrompts(cwd: string, packagedPromptsDir: string): string {
  const localPromptsDir = path.join(cwd, '.ralph', 'prompts');

  if (existsSync(localPromptsDir)) {
    return localPromptsDir;
  }

  if (!existsSync(packagedPromptsDir)) {
    return packagedPromptsDir;
  }

  try {
    mkdirSync(path.dirname(localPromptsDir), { recursive: true });
    cpSync(packagedPromptsDir, localPromptsDir, { recursive: true });
    return localPromptsDir;
  } catch {
    return packagedPromptsDir;
  }
}
