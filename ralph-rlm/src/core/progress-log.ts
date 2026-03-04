import { appendFile, writeFile, access } from 'node:fs/promises';

export async function append(path: string, entry: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  await appendFile(path, line, 'utf-8');
}

export async function ensureExists(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await writeFile(path, '', 'utf-8');
  }
}
