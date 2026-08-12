import type { Page } from 'playwright';

export interface AuthSessionCheck {
  status: 'ready' | 'blocked';
  targetOrigin: string;
  observedOrigin: string;
  observedPath: string;
  passwordFieldVisible: boolean;
  redirectedToAuthRoute: boolean;
  reason: string;
}

const authRoutePattern = /(?:^|\/)(?:login|log-in|signin|sign-in|auth|authenticate|sso)(?:\/|$)/i;

export async function verifyAuthSession(page: Page, targetUrl: string): Promise<AuthSessionCheck> {
  const target = new URL(targetUrl);
  try {
    if (page.url() !== targetUrl) await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    return {
      status: 'blocked', targetOrigin: target.origin, observedOrigin: page.url().startsWith('http') ? new URL(page.url()).origin : '', observedPath: page.url(),
      passwordFieldVisible: false, redirectedToAuthRoute: false,
      reason: `认证会话检查无法打开目标页面：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const observed = new URL(page.url());
  const passwordFieldVisible = await page.locator('input[type="password"]').filter({ visible: true }).count() > 0;
  const redirectedToAuthRoute = authRoutePattern.test(observed.pathname) && !authRoutePattern.test(target.pathname);
  const status = passwordFieldVisible || redirectedToAuthRoute ? 'blocked' : 'ready';
  return {
    status,
    targetOrigin: target.origin,
    observedOrigin: observed.origin,
    observedPath: observed.pathname,
    passwordFieldVisible,
    redirectedToAuthRoute,
    reason: status === 'ready'
      ? '本地会话没有出现明显登录阻塞，可进入目标 Case。'
      : passwordFieldVisible
        ? '页面仍显示密码输入，当前 Auth Fixture 未建立有效登录态。'
        : '目标页面被重定向到明显认证路径，当前 Auth Fixture 可能已失效。',
  };
}
