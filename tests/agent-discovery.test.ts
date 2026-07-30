import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverWorkspaceCandidates } from '../src/agents/agent-discovery.js';
import { dispatchDashboardApi } from '../src/dashboard/server.js';

describe('agent workspace discovery', () => {
  it('reads only confirmed workspace metadata and merges duplicate projects', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evalpilot-agent-home-'));
    const project = resolve(home, 'Projects', 'sample-app'); await mkdir(project, { recursive: true });
    await writeFile(resolve(project, 'package.json'), JSON.stringify({ dependencies: { react: '1.0.0' }, devDependencies: { vite: '1.0.0' } }));
    await mkdir(resolve(home, '.codex'), { recursive: true });
    await writeFile(resolve(home, '.codex', '.codex-global-state.json'), JSON.stringify({ 'electron-saved-workspace-roots': [project] }));
    const claudeProject = resolve(home, '.claude', 'projects', 'fixture'); await mkdir(claudeProject, { recursive: true });
    await writeFile(resolve(claudeProject, 'session.jsonl'), `${JSON.stringify({ cwd: project, type: 'metadata' })}\n${JSON.stringify({ prompt: '不得作为候选名称' })}\n`);
    const antigravity = resolve(home, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage'); await mkdir(antigravity, { recursive: true });
    await writeFile(resolve(antigravity, 'storage.json'), JSON.stringify({ backupWorkspaces: { folders: [{ folderUri: `file://${project}` }] } }));

    const candidates = await discoverWorkspaceCandidates(['codex', 'claude_code', 'antigravity'], home);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({ projectRoot: project, name: 'sample-app', sourceAgents: ['codex', 'antigravity'], stack: ['React', 'Vite'], confidence: 'high', pathValid: true }));
    expect(JSON.stringify(candidates)).not.toContain('不得作为候选名称');
  });

  it('turns a recent parent workspace into direct child project cards instead of asking users to select the parent folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evalpilot-agent-parent-home-'));
    const projects = resolve(home, 'Projects'); await mkdir(projects, { recursive: true });
    await mkdir(resolve(projects, '.git'));
    const webApp = resolve(projects, 'customer-portal'); await mkdir(webApp);
    await writeFile(resolve(webApp, 'package.json'), JSON.stringify({ dependencies: { react: '1.0.0' } }));
    const gitApp = resolve(projects, 'content-service'); await mkdir(resolve(gitApp, '.git'), { recursive: true });
    await mkdir(resolve(projects, 'random-notes'));
    await mkdir(resolve(home, '.codex'), { recursive: true });
    await writeFile(resolve(home, '.codex', '.codex-global-state.json'), JSON.stringify({ 'electron-saved-workspace-roots': [projects] }));

    const candidates = await discoverWorkspaceCandidates(['codex'], home);

    expect(candidates.map((candidate) => candidate.name)).toEqual(['content-service', 'customer-portal']);
    expect(candidates.every((candidate) => candidate.projectRoot !== projects)).toBe(true);
    expect(candidates.every((candidate) => candidate.sourceAgents.includes('codex'))).toBe(true);
  });

  it('requires confirmation before reading recent workspaces', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-agent-api-'));
    const result = await dispatchDashboardApi(cwd, 'POST', '/api/workspace-candidates', '', { confirmed: false, providers: ['codex'] });
    expect(result.status).toBe(422);
    expect(result.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'WORKSPACE_DISCOVERY_INVALID' }) }));
  });
});
