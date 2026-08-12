import { createServer } from 'node:http';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { ExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { resolveAuthSessionFixture } from '../src/scenario/auth-session-fixture.js';
import { verifyAuthSession } from '../src/scenario/auth-session-verifier.js';

const browserIt = process.env.EVALPILOT_BROWSER_TEST === '1' ? it : it.skip;
let browser: Browser | null = null;

afterEach(async () => { await browser?.close(); browser = null; });

function authScenario(url: string): ExecutableScenario {
  return {
    scenarioId: 'scenario-auth', projectId: 'project-auth', caseId: 'case-auth', capabilityId: 'cap-auth', taskId: 'task-auth', goal: '查看登录后页面', startingUrl: url, readiness: 'needs_auth',
    blockers: [{ blockerId: 'auth', type: 'needs_auth', summary: '需要已登录测试账号。', source: 'precondition', sourceValue: '用户已登录测试账号' }],
    preconditions: [{ text: '用户已登录测试账号', status: 'unresolved', reason: '需要认证会话。' }], knownInformationKeys: [], generatedAt: '2026-08-12T09:00:00.000Z',
  };
}

async function authFile(state: unknown): Promise<{ path: string; projectRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'evalpilot-auth-project-'));
  const secureDir = await mkdtemp(join(tmpdir(), 'evalpilot-auth-state-'));
  const path = join(secureDir, 'storage-state.json');
  await writeFile(path, JSON.stringify(state), 'utf8');
  if (process.platform !== 'win32') await chmod(path, 0o600);
  return { path, projectRoot };
}

async function fixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body><main id="root"></main><script>const root=document.querySelector('#root');if(localStorage.getItem('session')==='valid-session'){root.innerHTML='<h1>Dashboard</h1><p>Authenticated</p>'}else{root.innerHTML='<h1>Sign in</h1><input type="password" placeholder="Password">'}</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

describe('Auth Session Fixture', () => {
  it('keeps only target-origin state and never requires account credentials', async () => {
    const targetUrl = 'http://127.0.0.1:41001/';
    const { path, projectRoot } = await authFile({
      cookies: [{ name: 'session', value: 'target-cookie', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }, { name: 'other', value: 'third-party-secret', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }],
      origins: [{ origin: 'http://127.0.0.1:41001', localStorage: [{ name: 'session', value: 'valid-session' }] }, { origin: 'https://example.com', localStorage: [{ name: 'token', value: 'third-party-token' }] }],
    });
    const result = await resolveAuthSessionFixture({ scenario: authScenario(targetUrl), targetUrl, projectRoot, storageStatePath: path });
    expect(result.status).toBe('ready');
    expect(result.fixture?.cookieCount).toBe(1);
    expect(result.fixture?.originCount).toBe(1);
    expect(result.fixture?.storageState.cookies.map((item) => item.domain)).toEqual(['127.0.0.1']);
    expect(result.fixture?.storageState.origins.map((item) => item.origin)).toEqual(['http://127.0.0.1:41001']);
    expect(JSON.stringify({ source: result.fixture?.source, targetOrigin: result.fixture?.targetOrigin, cookieCount: result.fixture?.cookieCount, originCount: result.fixture?.originCount })).not.toContain('target-cookie');
    expect(JSON.stringify({ source: result.fixture?.source, targetOrigin: result.fixture?.targetOrigin, cookieCount: result.fixture?.cookieCount, originCount: result.fixture?.originCount })).not.toContain('valid-session');
  });

  it('blocks auth state stored inside the tested repository', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'evalpilot-auth-repo-'));
    const path = join(projectRoot, 'storage-state.json');
    await writeFile(path, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
    if (process.platform !== 'win32') await chmod(path, 0o600);
    const result = await resolveAuthSessionFixture({ scenario: authScenario('http://127.0.0.1:3000/'), targetUrl: 'http://127.0.0.1:3000/', projectRoot, storageStatePath: path });
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('项目仓库');
  });

  it('blocks a session file with no target-domain state', async () => {
    const { path, projectRoot } = await authFile({ cookies: [], origins: [{ origin: 'https://example.com', localStorage: [{ name: 'session', value: 'other' }] }] });
    const result = await resolveAuthSessionFixture({ scenario: authScenario('http://127.0.0.1:3000/'), targetUrl: 'http://127.0.0.1:3000/', projectRoot, storageStatePath: path });
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('目标域');
  });

  browserIt('enters the authenticated page with sanitized state and blocks an expired session before Agent execution', async () => {
    const server = await fixtureServer();
    try {
      const validState = await authFile({ cookies: [], origins: [{ origin: server.url, localStorage: [{ name: 'session', value: 'valid-session' }] }] });
      const valid = await resolveAuthSessionFixture({ scenario: authScenario(server.url), targetUrl: server.url, projectRoot: validState.projectRoot, storageStatePath: validState.path });
      expect(valid.status).toBe('ready');
      browser = await chromium.launch({ headless: true });
      const validContext = await browser.newContext({ storageState: valid.fixture!.storageState });
      const validPage = await validContext.newPage();
      const validCheck = await verifyAuthSession(validPage, server.url);
      expect(validCheck.status).toBe('ready');
      expect(await validPage.locator('#root').innerText()).toContain('Authenticated');
      await validContext.close();

      const expiredState = await authFile({ cookies: [], origins: [{ origin: server.url, localStorage: [{ name: 'session', value: 'expired-session' }] }] });
      const expired = await resolveAuthSessionFixture({ scenario: authScenario(server.url), targetUrl: server.url, projectRoot: expiredState.projectRoot, storageStatePath: expiredState.path });
      expect(expired.status).toBe('ready');
      const expiredContext = await browser.newContext({ storageState: expired.fixture!.storageState });
      const expiredPage = await expiredContext.newPage();
      const expiredCheck = await verifyAuthSession(expiredPage, server.url);
      expect(expiredCheck.status).toBe('blocked');
      expect(expiredCheck.passwordFieldVisible).toBe(true);
      expect(expiredCheck.reason).toContain('密码输入');
      await expiredContext.close();
    } finally {
      await server.close();
    }
  });
});
