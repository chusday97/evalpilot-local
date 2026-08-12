import type { Page } from 'playwright';

export interface AuthSessionCheck {
  status: 'ready' | 'blocked';
  targetOrigin: string;
  observedOrigin: string;
  observedPath: string;
  originChanged: boolean;
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
    const currentUrl = page.url();
    return {
      status: 'blocked', targetOrigin: target.origin, observedOrigin: currentUrl.startsWith('http') ? new URL(currentUrl).origin : '', observedPath: currentUrl,
      originChanged: currentUrl.startsWith('http') ? new URL(currentUrl).origin !== target.origin : false,
      passwordFieldVisible: false, redirectedToAuthRoute: false,
      reason: `认证会话检查无法打开目标页面：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const observed = new URL(page.url());
  const originChanged = observed.origin !== target.origin;
  const passwordFieldVisible = await page.locator('input[type="password"]').filter({ visible: true }).count() > 0;
  const redirectedToAuthRoute = authRoutePattern.test(observed.pathname) && !authRoutePattern.test(target.pathname);
  const status = originChanged || passwordFieldVisible || redirectedToAuthRoute ? 'blocked' : 'ready';
  return {
    status,
    targetOrigin: target.origin,
    observedOrigin: observed.origin,
    observedPath: observed.pathname,
    originChanged,
    passwordFieldVisible,
    redirectedToAuthRoute,
    reason: status === 'ready'
      ? '本地会话没有出现明显登录阻塞，可进入目标 Case。'
      : originChanged
        ? '目标页面离开了被测 Origin，当前 Auth Fixture 未建立可复用的目标会话。'
        : passwordFieldVisible
          ? '页面仍显示密码输入，当前 Auth Fixture 未建立有效登录态。'
          : '目标页面被重定向到明显认证路径，当前 Auth Fixture 可能已失效。',
  };
}
