import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { ApiEvidence, ApiItem, EvidenceClaim, RepositoryEvidence } from '../../types.js';

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);
const methodCallPattern = /\b(?:app|router|server|axios)\.(get|post|put|patch|delete|use)\(\s*["']([^"']+)["']/gi;
const fetchPattern = /\bfetch\(\s*["']([^"']+)["']/gi;
const apiLiteralPattern = /["'](\/api\/[^"']*)["']/g;

function addApi(target: Map<string, ApiItem>, path: string, method: string | null, source: string): void {
  if (!path.startsWith('/') && !/^https?:\/\//.test(path)) return;
  const normalizedMethod = method?.toUpperCase() ?? null;
  const key = `${normalizedMethod ?? 'UNKNOWN'}|${path}|${source}`;
  target.set(key, { path, method: normalizedMethod, source, status: 'verified' });
}

export async function scanApis(repository: RepositoryEvidence): Promise<ApiEvidence> {
  const sourceFiles = repository.files
    .filter((file) => sourceExtensions.has(extname(file.path)) && file.size <= 1_000_000)
    .slice(0, 2_000);
  const apis = new Map<string, ApiItem>();

  for (const file of sourceFiles) {
    const content = await readFile(resolve(repository.projectRoot, file.path), 'utf8');
    for (const match of content.matchAll(methodCallPattern)) {
      if (match[1] && match[2]) addApi(apis, match[2], match[1], file.path);
    }
    for (const match of content.matchAll(fetchPattern)) {
      if (match[1]) addApi(apis, match[1], null, file.path);
    }
    for (const match of content.matchAll(apiLiteralPattern)) {
      if (match[1]) addApi(apis, match[1], null, file.path);
    }
  }

  const items = [...apis.values()].sort((a, b) => `${a.path}|${a.method ?? ''}`.localeCompare(`${b.path}|${b.method ?? ''}`));
  const claims: EvidenceClaim[] = items.map((item) => ({
    claim: `源码明确引用 API ${item.method ? `${item.method} ` : ''}${item.path}`,
    sourceType: 'repository',
    source: item.source,
    status: 'verified',
  }));
  return {
    apis: items,
    sourceFiles: [...new Set(items.map((item) => item.source))],
    claims,
    scannedAt: new Date().toISOString(),
  };
}
