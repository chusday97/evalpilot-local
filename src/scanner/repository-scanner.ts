import { opendir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import type { EvidenceClaim, FileEvidence, RepositoryEvidence } from '../../types.js';
import { EvalPilotError } from '../utils/errors.js';

const ignoredDirectoryNames = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const ignoredFileNames = new Set(['.env', '.env.local', '.env.production', '.env.development', '.env.test']);
const documentExtensions = new Set(['.md', '.mdx', '.txt', '.rst']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);

function classifyFile(relativePath: string): FileEvidence['category'] {
  const normalized = relativePath.split(sep).join('/');
  const name = normalized.toLowerCase();
  const extension = extname(name);
  if (documentExtensions.has(extension) || name === 'readme') return 'document';
  if (/(^|\/)(test|tests|__tests__|e2e)(\/|$)|\.(test|spec)\./.test(name)) return 'test';
  if (/(^|\/)(routes?|pages?|app)(\/|$)|router/.test(name)) return 'route';
  if (/(^|\/)(api|server)(\/|$)/.test(name)) return 'api';
  if (/(schema|model|types|database)/.test(name)) return 'model';
  if (sourceExtensions.has(extension)) return 'source';
  return 'config';
}

async function walk(root: string, current: string, files: FileEvidence[], maxFiles: number): Promise<void> {
  if (files.length >= maxFiles) return;
  const directory = await opendir(current);
  for await (const entry of directory) {
    if (files.length >= maxFiles) break;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        await walk(root, resolve(current, entry.name), files, maxFiles);
      }
      continue;
    }
    if (!entry.isFile() || ignoredFileNames.has(entry.name)) continue;
    const path = resolve(current, entry.name);
    const relativePath = relative(root, path);
    const metadata = await stat(path);
    files.push({ path: relativePath.split(sep).join('/'), category: classifyFile(relativePath), size: metadata.size });
  }
}

function parseEnvVariableNames(content: string): string[] {
  return [...new Set(content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    return match?.[1] ? [match[1]] : [];
  }))].sort();
}

export async function scanRepository(projectRoot: string, maxFiles = 10_000): Promise<RepositoryEvidence> {
  const files: FileEvidence[] = [];
  try {
    await walk(projectRoot, projectRoot, files, maxFiles);
  } catch (error) {
    throw new EvalPilotError(`仓库扫描失败：${String(error)}`, 'REPOSITORY_SCAN_FAILED');
  }

  const packagePath = resolve(projectRoot, 'package.json');
  let packageJson: Record<string, unknown> | null = null;
  if (files.some((file) => file.path === 'package.json')) {
    try {
      packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      throw new EvalPilotError(`package.json 无法解析：${String(error)}`, 'PACKAGE_JSON_INVALID');
    }
  }

  const envVariableNames: string[] = [];
  for (const file of files.filter((candidate) => /(^|\/)\.env\.example$/.test(candidate.path))) {
    envVariableNames.push(...parseEnvVariableNames(await readFile(resolve(projectRoot, file.path), 'utf8')));
  }

  const claims: EvidenceClaim[] = [
    {
      claim: `扫描到 ${files.length} 个非依赖、非构建文件`,
      sourceType: 'repository',
      source: projectRoot,
      status: 'verified',
    },
  ];
  if (packageJson && typeof packageJson.name === 'string') {
    claims.push({
      claim: `项目 package 名称为 ${packageJson.name}`,
      sourceType: 'repository',
      source: 'package.json',
      status: 'verified',
    });
  }

  return {
    projectRoot,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    packageJson,
    envVariableNames: [...new Set(envVariableNames)].sort(),
    claims,
    scannedAt: new Date().toISOString(),
  };
}

export function getStartCommandSuggestions(evidence: RepositoryEvidence): string[] {
  const scripts = evidence.packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  const candidates = ['dev', 'start', 'preview'];
  return candidates.flatMap((name) =>
    typeof (scripts as Record<string, unknown>)[name] === 'string' ? [`npm run ${name}`] : [],
  );
}

