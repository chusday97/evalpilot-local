import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import type { AgentConnection, AgentProviderName, WorkspaceCandidate } from '../../types.js';
import { pathExists } from '../utils/file-system.js';

const exec = promisify(execFile);
export const PUBLIC_ALPHA_DIRECT_FIX_ENABLED = false;

const labels: Record<AgentProviderName, string> = { codex: 'Codex', claude_code: 'Claude Code', antigravity: 'Antigravity' };

async function firstExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate.includes('/') && await pathExists(candidate)) return candidate;
    if (!candidate.includes('/')) {
      try { return (await exec('which', [candidate], { encoding: 'utf8', timeout: 2_000 })).stdout.trim() || null; } catch { /* try next known path */ }
    }
  }
  return null;
}

async function commandVersion(command: string): Promise<string | null> {
  try { return `${(await exec(command, ['--version'], { encoding: 'utf8', timeout: 4_000 })).stdout}`.trim().split('\n')[0] ?? null; } catch { return null; }
}

async function authStatus(provider: AgentProviderName, command: string | null): Promise<AgentConnection['authStatus']> {
  if (!command) return 'login_required';
  if (provider === 'antigravity') return 'unknown';
  const args = provider === 'codex' ? ['login', 'status'] : ['auth', 'status'];
  try { await exec(command, args, { encoding: 'utf8', timeout: 5_000 }); return 'ready'; } catch { return 'login_required'; }
}

export async function detectAgentConnections(checkAuth = false, home = homedir()): Promise<AgentConnection[]> {
  const definitions: Array<{ provider: AgentProviderName; commands: string[]; desktop: string }> = [
    { provider: 'codex', commands: [process.env.CODEX_BIN ?? '', 'codex', '/Applications/ChatGPT.app/Contents/Resources/codex'].filter(Boolean), desktop: '/Applications/ChatGPT.app' },
    { provider: 'claude_code', commands: [process.env.CLAUDE_BIN ?? '', 'claude', '/opt/homebrew/bin/claude'].filter(Boolean), desktop: '/Applications/Claude.app' },
    { provider: 'antigravity', commands: [process.env.ANTIGRAVITY_BIN ?? '', 'agy', resolve(home, '.local', 'bin', 'agy')].filter(Boolean), desktop: '/Applications/Antigravity.app' },
  ];
  const checkedAt = new Date().toISOString();
  return Promise.all(definitions.map(async ({ provider, commands, desktop }) => {
    const command = await firstExecutable(commands); const desktopInstalled = await pathExists(desktop); const installed = Boolean(command);
    const checkedAuth = checkAuth ? await authStatus(provider, command) : 'unknown';
    const workspaceDiscovery = provider !== 'claude_code';
    const directFix = PUBLIC_ALPHA_DIRECT_FIX_ENABLED && provider === 'codex' && installed && checkedAuth === 'ready';
    const executionMode = directFix ? 'direct' : installed || desktopInstalled ? 'handoff' : 'unavailable';
    const blockers: string[] = [];
    if (provider === 'claude_code') blockers.push('Public Alpha 不读取 Claude 会话文件；请手动选择项目，修复使用任务包交接。');
    if (provider === 'antigravity') blockers.push('Public Alpha 尚未提供可证明安全范围的 Antigravity 直接修复；使用任务包交接。');
    if (provider === 'codex') blockers.push('Public Alpha 尚未完成真实修复前后对比验收；当前只提供任务包交接。');
    if (!installed && !desktopInstalled) blockers.push(`没有检测到 ${labels[provider]}。`);
    return { provider, displayName: labels[provider], installed, desktopInstalled, version: command ? await commandVersion(command) : null, authStatus: checkedAuth, executionMode, capabilities: { workspaceDiscovery, directFix, taskPackageHandoff: true }, blockers, checkedAt };
  }));
}

async function codexRoots(home: string): Promise<Array<{ path: string; mtime: number }>> {
  const file = resolve(home, '.codex', '.codex-global-state.json');
  if (!(await pathExists(file))) return [];
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    const roots = new Set<string>();
    for (const key of ['electron-saved-workspace-roots', 'project-order', 'active-workspace-roots']) {
      const value = data[key]; if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') roots.add(item);
    }
    const hints = data['thread-workspace-root-hints']; if (hints && typeof hints === 'object') for (const item of Object.values(hints)) if (typeof item === 'string') roots.add(item);
    const modified = (await stat(file)).mtimeMs; return [...roots].map((path) => ({ path, mtime: modified }));
  } catch { return []; }
}

async function claudeRoots(home: string): Promise<Array<{ path: string; mtime: number }>> {
  void home;
  return [];
}

async function antigravityRoots(home: string): Promise<Array<{ path: string; mtime: number }>> {
  const file = resolve(home, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'storage.json');
  if (!(await pathExists(file))) return [];
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as { backupWorkspaces?: { folders?: Array<{ folderUri?: string }> } };
    const modified = (await stat(file)).mtimeMs;
    return (data.backupWorkspaces?.folders ?? []).flatMap((item) => {
      if (!item.folderUri?.startsWith('file://')) return [];
      try { return [{ path: decodeURIComponent(new URL(item.folderUri).pathname), mtime: modified }]; } catch { return []; }
    });
  } catch { return []; }
}

async function stackFor(root: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    return [['react', 'React'], ['next', 'Next.js'], ['vue', 'Vue'], ['vite', 'Vite'], ['express', 'Express'], ['playwright', 'Playwright']].filter(([name]) => names.has(name!)).map(([, label]) => label!);
  } catch { return []; }
}

async function hasApplicationMarker(root: string): Promise<boolean> {
  return (await Promise.all([
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'index.html',
  ].map((marker) => pathExists(resolve(root, marker))))).some(Boolean);
}

async function projectRootsForWorkspace(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [root];
  if (await hasApplicationMarker(root)) return [root];
  try {
    const rootHasGit = await pathExists(resolve(root, '.git'));
    const children = await readdir(root, { withFileTypes: true });
    const projectChildren: string[] = [];
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.') || child.name === 'node_modules') continue;
      const childRoot = resolve(root, child.name);
      if (await hasApplicationMarker(childRoot) || await pathExists(resolve(childRoot, '.git'))) projectChildren.push(childRoot);
    }
    if (projectChildren.length) return projectChildren;
    return rootHasGit ? [root] : [];
  } catch {
    return [];
  }
}

export async function discoverWorkspaceCandidates(providers: AgentProviderName[], home = homedir()): Promise<WorkspaceCandidate[]> {
  const loaders: Record<AgentProviderName, (homePath: string) => Promise<Array<{ path: string; mtime: number }>>> = { codex: codexRoots, claude_code: claudeRoots, antigravity: antigravityRoots };
  const byPath = new Map<string, { sourceAgents: Set<AgentProviderName>; mtime: number }>();
  for (const provider of providers) for (const item of await loaders[provider](home)) {
    for (const root of await projectRootsForWorkspace(resolve(item.path))) {
      const current = byPath.get(root) ?? { sourceAgents: new Set<AgentProviderName>(), mtime: 0 };
      current.sourceAgents.add(provider); current.mtime = Math.max(current.mtime, item.mtime); byPath.set(root, current);
    }
  }
  const candidates: WorkspaceCandidate[] = [];
  for (const [projectRoot, metadata] of byPath) {
    const pathValid = await pathExists(projectRoot); const stack = pathValid ? await stackFor(projectRoot) : [];
    const hasPackage = pathValid && await pathExists(resolve(projectRoot, 'package.json'));
    candidates.push({ candidateId: `workspace-${createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)}`, projectRoot, name: basename(projectRoot), sourceAgents: [...metadata.sourceAgents], lastOpenedAt: metadata.mtime ? new Date(metadata.mtime).toISOString() : null, stack, confidence: hasPackage ? 'high' : pathValid ? 'medium' : 'low', pathValid });
  }
  return candidates.sort((a, b) => Number(b.pathValid) - Number(a.pathValid) || (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
}
