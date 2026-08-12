import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ExecutableScenario, ScenarioBlocker } from './scenario-compiler.js';

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

interface StorageOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

export interface SanitizedAuthStorageState {
  cookies: StorageCookie[];
  origins: StorageOrigin[];
}

export interface AuthSessionFixture {
  caseId: string;
  targetOrigin: string;
  storageState: SanitizedAuthStorageState;
  cookieCount: number;
  originCount: number;
  source: 'runtime_local_storage_state';
}

export interface AuthSessionResolution {
  caseId: string;
  status: 'not_required' | 'ready' | 'blocked';
  fixture: AuthSessionFixture | null;
  blockers: ScenarioBlocker[];
  reason: string;
}

const maxStorageStateBytes = 2 * 1024 * 1024;

function within(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function cookieMatchesHost(domainValue: string, hostValue: string): boolean {
  const domain = domainValue.trim().replace(/^\./, '').toLowerCase();
  const host = hostValue.toLowerCase();
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

function parseCookie(value: unknown): StorageCookie | null {
  if (!value || typeof value !== 'object') return null;
  const cookie = value as Record<string, unknown>;
  if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string' || typeof cookie.path !== 'string') return null;
  const sameSite = cookie.sameSite === 'Strict' || cookie.sameSite === 'None' ? cookie.sameSite : 'Lax';
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    sameSite,
  };
}

function parseOrigin(value: unknown): StorageOrigin | null {
  if (!value || typeof value !== 'object') return null;
  const origin = value as Record<string, unknown>;
  if (typeof origin.origin !== 'string' || !Array.isArray(origin.localStorage)) return null;
  const localStorage = origin.localStorage.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    return typeof item.name === 'string' && typeof item.value === 'string' ? [{ name: item.name, value: item.value }] : [];
  });
  return { origin: origin.origin, localStorage };
}

export async function resolveAuthSessionFixture(input: {
  scenario: ExecutableScenario;
  targetUrl: string;
  projectRoot: string;
  storageStatePath?: string | null;
}): Promise<AuthSessionResolution> {
  if (input.scenario.readiness === 'ready') return { caseId: input.scenario.caseId, status: 'not_required', fixture: null, blockers: [], reason: 'Scenario 不需要认证 Fixture。' };
  if (!input.scenario.blockers.length || input.scenario.blockers.some((blocker) => blocker.type !== 'needs_auth')) {
    return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Scenario 同时包含非认证 blocker，第一版不会组合猜测认证之外的前置状态。' };
  }
  const sourcePath = input.storageStatePath?.trim() ?? '';
  if (!sourcePath) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: '缺少显式本地 Auth Fixture。EvalPilot 不会自动填写账号密码；可通过 EVALPILOT_AUTH_STATE 提供 Playwright storageState 的绝对路径。' };
  if (!isAbsolute(sourcePath)) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 必须使用显式绝对路径，避免从项目目录猜测敏感文件。' };

  let metadata;
  try { metadata = await lstat(sourcePath); }
  catch { return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: '指定的 Auth Fixture 不存在或不可读取。' }; }
  if (!metadata.isFile() || metadata.isSymbolicLink()) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 必须是普通文件，不能使用符号链接。' };
  if (metadata.size <= 0 || metadata.size > maxStorageStateBytes) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 文件大小异常，未加载。' };
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 不属于当前用户，未加载。' };
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 权限过宽；请限制为仅当前用户可读写（例如 chmod 600）。' };
  try {
    const [realProjectRoot, realSourcePath] = await Promise.all([realpath(input.projectRoot), realpath(sourcePath)]);
    if (within(realProjectRoot, realSourcePath)) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 不能存放在被测项目仓库内，避免 Cookie/Token 被误提交。' };
  } catch {
    return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: '无法确认 Auth Fixture 与项目仓库的真实路径关系，已停止加载。' };
  }

  let raw: unknown;
  try { raw = JSON.parse(await readFile(sourcePath, 'utf8')); }
  catch { return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 不是有效的 Playwright storageState JSON。' }; }
  if (!raw || typeof raw !== 'object') return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 结构无效。' };
  const record = raw as Record<string, unknown>;
  const target = new URL(input.targetUrl);
  const cookies = (Array.isArray(record.cookies) ? record.cookies : []).flatMap((item) => {
    const cookie = parseCookie(item);
    return cookie && cookieMatchesHost(cookie.domain, target.hostname) ? [cookie] : [];
  });
  const origins = (Array.isArray(record.origins) ? record.origins : []).flatMap((item) => {
    const origin = parseOrigin(item);
    if (!origin) return [];
    try { return new URL(origin.origin).origin === target.origin ? [origin] : []; }
    catch { return []; }
  });
  if (!cookies.length && !origins.some((origin) => origin.localStorage.length > 0)) return { caseId: input.scenario.caseId, status: 'blocked', fixture: null, blockers: input.scenario.blockers, reason: 'Auth Fixture 中没有与目标域匹配的 Cookie 或 localStorage，会话不能用于该产品。' };

  return {
    caseId: input.scenario.caseId,
    status: 'ready',
    blockers: [],
    reason: '已加载并内存过滤目标域的本地 Auth Fixture；敏感值不会进入模型或评测报告。',
    fixture: {
      caseId: input.scenario.caseId,
      targetOrigin: target.origin,
      storageState: { cookies, origins },
      cookieCount: cookies.length,
      originCount: origins.length,
      source: 'runtime_local_storage_state',
    },
  };
}
