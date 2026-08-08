import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configForProject, loadProjectRegistry, saveProjectRegistry } from '../src/projects/project-registry.js';
import { dispatchDashboardApi } from '../src/dashboard/server.js';
import { defaultDataRoot, migrateLegacyData, packageVersion, resolveDataRoot } from '../src/runtime/paths.js';

async function directoryDigest(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(current, entry.name);
      hash.update(path.slice(directory.length));
      if (entry.isDirectory()) await visit(path); else hash.update(await readFile(path));
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

describe('portable runtime paths', () => {
  it('uses an explicit data directory without depending on the launch directory', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-runtime-'));
    const data = resolve(cwd, 'external-data');
    expect(resolveDataRoot(cwd, data)).toBe(data);
    expect(packageVersion()).toBe('0.6.0-alpha.0');
  });

  it('does not select or write a legacy workspace unless the user explicitly requests it', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-'));
    await mkdir(resolve(cwd, '.evalpilot'), { recursive: true });
    await writeFile(resolve(cwd, '.evalpilot', 'config.yaml'), 'version: 1\n');
    expect(resolveDataRoot(cwd)).toBe(defaultDataRoot());
    expect(resolveDataRoot(cwd, resolve(cwd, '.evalpilot'))).toBe(resolve(cwd, '.evalpilot'));
  });

  it('keeps an explicitly opened legacy registry read-only', async () => {
    const project = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-readonly-project-'));
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-readonly-launcher-'));
    const source = resolve(project, '.evalpilot');
    await mkdir(source, { recursive: true });
    await writeFile(resolve(source, 'config.yaml'), `version: 1\nprojectRoot: ${project}\ntargetUrl: http://127.0.0.1:3000\noutputDir: ${source}\nbrowser: chromium\ncreatedAt: "2026-07-18T00:00:00.000Z"\n`);
    process.env.EVALPILOT_DATA_DIR = source;
    try {
      const registry = await loadProjectRegistry(cwd);
      expect(registry.projects).toHaveLength(1);
      await expect(readFile(resolve(source, 'projects.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(saveProjectRegistry(cwd, registry)).rejects.toMatchObject({ code: 'LEGACY_DATA_READ_ONLY' });
      const before = await directoryDigest(source);
      const mutation = await dispatchDashboardApi(cwd, 'POST', '/api/evaluations', '', { projectId: 'legacy-current', depth: 'core', capabilityIds: [] });
      expect(mutation).toMatchObject({ status: 409, body: { success: false, error: { code: 'LEGACY_DATA_READ_ONLY' } } });
      expect(await directoryDigest(source)).toBe(before);
    } finally {
      delete process.env.EVALPILOT_DATA_DIR;
    }
  });

  it('copies legacy data only after explicit migration and never overwrites the destination', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-migrate-'));
    const source = resolve(cwd, '.evalpilot');
    const destination = resolve(cwd, 'new-data');
    await mkdir(resolve(source, 'projects', 'sample'), { recursive: true });
    await writeFile(resolve(source, 'config.yaml'), `version: 1\noutputDir: ${source}\n`);
    await writeFile(resolve(source, 'projects', 'sample', 'config.yaml'), `version: 1\noutputDir: ${resolve(source, 'projects', 'sample')}\n`);
    const now = '2026-07-18T00:00:00.000Z';
    await writeFile(resolve(source, 'projects.json'), `${JSON.stringify({ version: 1, activeProjectId: 'sample', projects: [{ projectId: 'sample', name: 'Sample', projectRoot: cwd, targetUrl: 'http://127.0.0.1:3000', outputDir: resolve(source, 'projects', 'sample'), browser: 'chromium', startCommand: null, status: 'stopped', importSource: 'legacy', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] })}\n`);
    const before = await directoryDigest(source);
    await expect(migrateLegacyData(cwd, destination)).resolves.toBe(destination);
    expect(await directoryDigest(source)).toBe(before);
    await expect(readFile(resolve(destination, 'config.yaml'), 'utf8')).resolves.toContain(`outputDir: ${destination}`);
    await expect(readFile(resolve(destination, 'projects', 'sample', 'config.yaml'), 'utf8')).resolves.toContain(`outputDir: ${resolve(destination, 'projects', 'sample')}`);
    const registry = JSON.parse(await readFile(resolve(destination, 'projects.json'), 'utf8')) as { projects: Array<{ outputDir: string }> };
    expect(registry.projects[0]?.outputDir).toBe(resolve(destination, 'projects', 'sample'));
    process.env.EVALPILOT_DATA_DIR = destination;
    try {
      await expect(configForProject(cwd, 'sample')).resolves.toMatchObject({ outputDir: resolve(destination, 'projects', 'sample') });
    } finally {
      delete process.env.EVALPILOT_DATA_DIR;
    }
    await expect(migrateLegacyData(cwd, destination)).rejects.toThrow('不会覆盖');
  });
});
