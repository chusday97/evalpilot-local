import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli/index.js';
import { dispatchDashboardApi } from '../src/dashboard/server.js';

describe('Phase 10 legacy quarantine', () => {
  it('exposes the six-step novice navigation with Evaluation as the only start path', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8'));
    const navigation = source.slice(source.indexOf('export const dashboardNavigation'), source.indexOf('const pageLabels'));
    expect(navigation).toContain("key: 'evaluate', label: '评测'");
    expect(navigation).not.toContain("key: 'eval-set'");
    expect([...navigation.matchAll(/key: '/g)]).toHaveLength(6);
  });

  it('removes the legacy exploratory option from the public CLI', () => {
    const run = createProgram().commands.find((command) => command.name() === 'run');
    expect(run).toBeDefined();
    expect(run?.options.map((option) => option.long)).not.toContain('--exploratory');
  });

  it('rejects legacy Dashboard run creation and controls with a recovery action', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-quarantine-'));
    const dataDir = resolve(cwd, 'data');
    const outputDir = resolve(dataDir, 'projects', 'project-demo');
    const now = new Date().toISOString();
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(dataDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'project-demo', projects: [{ projectId: 'project-demo', name: 'Demo', projectRoot: cwd, targetUrl: 'http://127.0.0.1:3000', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] }));
    process.env.EVALPILOT_DATA_DIR = dataDir;
    try {
      const create = await dispatchDashboardApi(cwd, 'POST', '/api/runs', '', { mode: 'exploratory' });
      const control = await dispatchDashboardApi(cwd, 'POST', '/api/runs/old-run/stop', '', { confirmed: true });
      for (const result of [create, control]) {
        expect(result.status).toBe(410);
        expect(result.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'LEGACY_RUNTIME_QUARANTINED', message: expect.stringContaining('评测') }) }));
      }
    } finally {
      delete process.env.EVALPILOT_DATA_DIR;
    }
  });

  it('marks the retained runner as deprecated and keeps it out of normal entry points', async () => {
    const { readFile } = await import('node:fs/promises');
    const runner = await readFile(new URL('../src/ux-evaluation/exploratory-runner.ts', import.meta.url), 'utf8');
    const manager = await readFile(new URL('../src/dashboard/evaluation-manager.ts', import.meta.url), 'utf8');
    const cli = await readFile(new URL('../src/cli/index.ts', import.meta.url), 'utf8');
    const server = await readFile(new URL('../src/dashboard/server.ts', import.meta.url), 'utf8');
    expect(runner).toContain('@deprecated legacy evaluation runtime');
    expect(manager).not.toContain('runExploratoryScenario');
    expect(cli).not.toContain('runExploratoryScenario');
    expect(server).not.toContain("from './run-manager.js'");
    expect(server).toContain("pathname.match(/^\\/api\\/runs\\/([^/]+)\\/events$/)");
    expect(server).toContain('旧版运行事件入口已经停用');
  });
});
