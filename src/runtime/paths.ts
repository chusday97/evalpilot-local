import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

export function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = resolve(current, 'package.json');
    if (existsSync(manifest)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('无法定位 EvalPilot 安装目录。');
}

export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(packageRoot(), 'package.json'), 'utf8')) as { version?: string };
  return manifest.version ?? '0.0.0';
}

export function dashboardAssetsRoot(): string {
  return resolve(packageRoot(), 'dist-dashboard');
}

export function defaultDataRoot(): string {
  return resolve(homedir(), '.evalpilot-local');
}

export function resolveDataRoot(cwd: string, explicit?: string | null): string {
  void cwd;
  if (explicit?.trim()) return resolve(explicit);
  if (process.env.EVALPILOT_DATA_DIR?.trim()) return resolve(process.env.EVALPILOT_DATA_DIR);
  return defaultDataRoot();
}

export function isLegacyDataRoot(cwd: string, dataRoot = resolveDataRoot(cwd)): boolean {
  void cwd;
  return basename(resolve(dataRoot)) === '.evalpilot';
}

function migratedPath(value: unknown, source: string, destination: string): unknown {
  if (typeof value !== 'string') return value;
  const absolute = resolve(value);
  if (absolute === source) return destination;
  return absolute.startsWith(`${source}/`) ? resolve(destination, absolute.slice(source.length + 1)) : value;
}

async function rewriteMigratedMetadata(directory: string, source: string, destination: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteMigratedMetadata(path, source, destination);
    } else if (entry.name === 'config.yaml') {
      const config = parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      if ('outputDir' in config) config.outputDir = migratedPath(config.outputDir, source, destination);
      await writeFile(path, stringify(config), 'utf8');
    } else if (entry.name === 'projects.json') {
      const registry = JSON.parse(await readFile(path, 'utf8')) as { projects?: Array<Record<string, unknown>> };
      for (const project of registry.projects ?? []) project.outputDir = migratedPath(project.outputDir, source, destination);
      await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    }
  }
}

export async function migrateLegacyData(cwd: string, destination = defaultDataRoot()): Promise<string> {
  const source = resolve(cwd, '.evalpilot');
  if (!existsSync(resolve(source, 'config.yaml')) && !existsSync(resolve(source, 'projects.json'))) {
    throw new Error(`没有找到可迁移的旧数据目录：${source}`);
  }
  if (existsSync(destination)) throw new Error(`目标数据目录已存在，本次不会覆盖：${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    await rewriteMigratedMetadata(destination, source, destination);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return destination;
}
