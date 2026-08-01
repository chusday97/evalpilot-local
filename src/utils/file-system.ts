import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeJsonLinesAtomic(path: string, values: unknown[]): Promise<void> {
  const content = values.map((value) => JSON.stringify(value)).join('\n');
  await writeTextAtomic(path, content.length ? `${content}\n` : '');
}

export async function writeYamlAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, stringify(value));
}

export async function readYamlFile<T>(path: string): Promise<T> {
  return parse(await readFile(path, 'utf8')) as T;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf8');
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(`${path} 不是合法 JSON：${String(error)}`);
  }
}

export async function readJsonLinesFile<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8');
  if (!content.trim()) return [];
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`${path} 第 ${index + 1} 行不是合法 JSON：${String(error)}`);
      }
    });
}

export async function ensureGitignoreEntry(path: string, entry: string): Promise<void> {
  let current = '';
  if (await pathExists(path)) {
    current = await readFile(path, 'utf8');
  }

  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry)) {
    return;
  }

  const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
  await writeTextAtomic(path, `${prefix}${entry}\n`);
}
