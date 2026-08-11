import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, resolve } from 'node:path';
import type { ProjectProfile, ProjectReadiness } from '../../types.js';
import { initializeProject } from '../config/initializer.js';
import { resolveProjectDirectory } from '../config/project-config.js';
import { scanGit } from '../scanner/git-scanner.js';
import { getStartCommandSuggestions, scanRepository } from '../scanner/repository-scanner.js';
import { createProjectInputSchema } from '../schemas/workspace.js';
import { EvalPilotError } from '../utils/errors.js';
import { writeYamlAtomic } from '../utils/file-system.js';
import { loadProjectRegistry, saveProjectRegistry } from './project-registry.js';
import { resolveDataRoot } from '../runtime/paths.js';

const processes = new Map<string, ChildProcess>();
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project'; }
function portOf(url: string | null): number | null { if (!url) return null; const parsed = new URL(url); return parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80; }

async function probe(projectRoot: string, url: string | null): Promise<{ reachable: boolean; verified: boolean }> {
  if (!url) return { reachable: false, verified: false };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (response.status >= 500) return { reachable: false, verified: false };
    const html = (await response.text()).toLowerCase();
    let packageName = '';
    try { packageName = String((JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as { name?: string }).name ?? ''); } catch { /* 无 package 名称时使用目录名。 */ }
    const ignored = new Set(['app', 'web', 'frontend', 'client', 'project', 'local']);
    const tokens = `${packageName} ${basename(projectRoot)}`.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((item) => item.length >= 4 && !ignored.has(item));
    return { reachable: true, verified: tokens.length === 0 || tokens.some((token) => html.includes(token)) };
  } catch { return { reachable: false, verified: false }; }
}

async function freePort(): Promise<number> { return new Promise((resolvePort, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close((error) => error ? reject(error) : resolvePort(port)); }); }); }

async function isViteScript(projectRoot: string, script: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const command = manifest.scripts?.[script];
    return typeof command === 'string' && /(^|[\s/])vite(?:\s|$)/.test(command);
  } catch {
    return false;
  }
}

export async function discoverProject(projectRootInput: string, targetUrl: string | null = null, projectId: string | null = null): Promise<ProjectReadiness> {
  let root = resolve(projectRootInput);
  let pathValid = true;
  try { root = await resolveProjectDirectory(projectRootInput); } catch { pathValid = false; }
  const repository = pathValid ? await scanRepository(root, 2_000) : null;
  const git = pathValid ? await scanGit(root) : { available: false, changedFiles: [] as string[] };
  const suggestions = repository ? getStartCommandSuggestions(repository) : [];
  const target = await probe(root, targetUrl);
  const blockers = [!pathValid ? '项目文件夹不存在或不可读取。' : null, !targetUrl ? '需要填写本地测试网址。' : null, targetUrl && !target.reachable ? '测试网址尚未启动。' : null, target.reachable && !target.verified ? '该端口有服务，但页面特征与所选项目不匹配。' : null].filter((item): item is string => Boolean(item));
  return { projectId, projectRoot: root, targetUrl, pathValid, urlReachable: target.reachable, targetVerified: target.verified, gitAvailable: git.available, gitDirty: git.changedFiles.length > 0, suggestedStartCommands: suggestions, activeStartCommand: projectId && processes.get(projectId)?.exitCode === null ? '运行中' : null, port: portOf(targetUrl), canEvaluate: pathValid && target.reachable && target.verified, blockers };
}

export async function registerProject(cwd: string, input: unknown): Promise<ProjectProfile> {
  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) throw new EvalPilotError(parsed.error.issues.map((item) => item.message).join('；'), 'PROJECT_INVALID');
  const root = await resolveProjectDirectory(parsed.data.projectRoot);
  const registry = await loadProjectRegistry(cwd);
  const existing = registry.projects.find((item) => item.projectRoot === root);
  if (existing) return activateProject(cwd, existing.projectId);
  const base = slug(parsed.data.name ?? basename(root));
  let projectId = base;
  let suffix = 2;
  while (registry.projects.some((item) => item.projectId === projectId)) projectId = `${base}-${suffix++}`;
  const outputDir = resolve(resolveDataRoot(cwd), 'projects', projectId);
  const config = await initializeProject({ cwd, project: root, url: parsed.data.targetUrl, outputDir, skipReachability: true });
  const now = new Date().toISOString();
  const ready = await discoverProject(root, config.targetUrl, projectId);
  const profile: ProjectProfile = { projectId, name: parsed.data.name ?? basename(root), projectRoot: root, targetUrl: config.targetUrl, outputDir, browser: 'chromium', startCommand: parsed.data.startCommand ?? ready.suggestedStartCommands[0] ?? null, status: ready.canEvaluate ? 'ready' : 'stopped', importSource: parsed.data.importSource, preferredAgent: parsed.data.preferredAgent, createdAt: now, updatedAt: now, lastOpenedAt: now };
  registry.projects.push(profile); registry.activeProjectId = projectId; await saveProjectRegistry(cwd, registry); return profile;
}

export async function activateProject(cwd: string, projectId: string): Promise<ProjectProfile> {
  const registry = await loadProjectRegistry(cwd); const index = registry.projects.findIndex((item) => item.projectId === projectId);
  if (index < 0) throw new EvalPilotError(`没有找到项目：${projectId}`, 'PROJECT_NOT_FOUND');
  const updated = { ...registry.projects[index]!, lastOpenedAt: new Date().toISOString() }; registry.projects[index] = updated; registry.activeProjectId = projectId; await saveProjectRegistry(cwd, registry); return updated;
}

export async function startProject(cwd: string, projectId: string, command?: string): Promise<ProjectReadiness> {
  const registry = await loadProjectRegistry(cwd); const project = registry.projects.find((item) => item.projectId === projectId);
  if (!project) throw new EvalPilotError(`没有找到项目：${projectId}`, 'PROJECT_NOT_FOUND');
  const readiness = await discoverProject(project.projectRoot, project.targetUrl, projectId);
  if (readiness.canEvaluate) {
    const index = registry.projects.findIndex((item) => item.projectId === projectId);
    registry.projects[index] = { ...project, status: 'ready', updatedAt: new Date().toISOString() };
    await saveProjectRegistry(cwd, registry);
    return readiness;
  }
  const selected = command ?? project.startCommand ?? readiness.suggestedStartCommands[0];
  if (!selected || !readiness.suggestedStartCommands.includes(selected)) throw new EvalPilotError('启动命令必须来自项目 package.json 的 dev/start/preview 脚本。', 'START_COMMAND_NOT_ALLOWED');
  const script = selected.replace(/^npm run /, '');
  let targetUrl = project.targetUrl;
  let port = readiness.port;
  if (readiness.urlReachable && !readiness.targetVerified) {
    if (script === 'start') throw new EvalPilotError('原端口被其他服务占用，且 start 脚本不支持安全改端口。请修改项目启动配置后重试。', 'TARGET_PORT_CONFLICT');
    port = await freePort(); const parsedUrl = new URL(project.targetUrl); parsedUrl.port = String(port); targetUrl = parsedUrl.toString().replace(/\/$/, '');
    const index = registry.projects.findIndex((item) => item.projectId === projectId); registry.projects[index] = { ...project, targetUrl, updatedAt: new Date().toISOString() }; await saveProjectRegistry(cwd, registry);
    await writeYamlAtomic(resolve(project.outputDir, 'config.yaml'), { version: 1, projectRoot: project.projectRoot, targetUrl, outputDir: project.outputDir, browser: project.browser, createdAt: project.createdAt });
  }
  const parsedTarget = new URL(targetUrl);
  const shouldForwardTarget = Boolean(port) && (targetUrl !== project.targetUrl || await isViteScript(project.projectRoot, script));
  const args = ['run', script, ...(shouldForwardTarget ? ['--', '--host', parsedTarget.hostname, '--port', String(port)] : [])];
  const child = spawn('npm', args, { cwd: project.projectRoot, stdio: 'ignore' });
  processes.set(projectId, child); child.once('exit', () => processes.delete(projectId));
  for (let attempt = 0; attempt < 20; attempt += 1) { await new Promise((resolveWait) => setTimeout(resolveWait, 250)); const next = await discoverProject(project.projectRoot, targetUrl, projectId); if (next.canEvaluate) { const index = registry.projects.findIndex((item) => item.projectId === projectId); registry.projects[index] = { ...project, targetUrl, startCommand: selected, status: 'ready', updatedAt: new Date().toISOString() }; await saveProjectRegistry(cwd, registry); return next; } if (child.exitCode !== null) break; }
  const index = registry.projects.findIndex((item) => item.projectId === projectId);
  registry.projects[index] = { ...project, targetUrl, startCommand: selected, status: 'needs_attention', updatedAt: new Date().toISOString() };
  await saveProjectRegistry(cwd, registry);
  throw new EvalPilotError(`项目已尝试启动，但 ${targetUrl} 仍不可访问或无法确认属于该项目。`, 'TARGET_START_FAILED');
}
