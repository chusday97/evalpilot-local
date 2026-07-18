import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { RepositoryEvidence, RouteEvidence, RouteItem } from '../../types.js';

const routeSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte']);
const routePatterns = [
  /<Route[^>]*\bpath\s*=\s*["']([^"']+)["']/g,
  /\bpath\s*:\s*["']([^"']+)["']/g,
  /\b(?:route|router)\.(?:get|post|put|patch|delete|use)\(\s*["']([^"']+)["']/g,
];

export async function scanRoutes(repository: RepositoryEvidence): Promise<RouteEvidence> {
  const sourceFiles = repository.files
    .filter((file) => routeSourceExtensions.has(extname(file.path)) && (file.category === 'route' || /router|routes|app\./i.test(file.path)))
    .filter((file) => file.size <= 1_000_000)
    .slice(0, 500);
  const routes = new Map<string, RouteItem>();

  for (const file of sourceFiles) {
    const content = await readFile(resolve(repository.projectRoot, file.path), 'utf8');
    for (const pattern of routePatterns) {
      for (const match of content.matchAll(pattern)) {
        const path = match[1];
        if (!path || path.startsWith('http')) continue;
        const key = `${path}|${file.path}`;
        routes.set(key, { path, source: file.path, status: 'verified' });
      }
    }
  }

  return {
    routes: [...routes.values()].sort((a, b) => a.path.localeCompare(b.path)),
    sourceFiles: sourceFiles.map((file) => file.path),
    scannedAt: new Date().toISOString(),
  };
}

