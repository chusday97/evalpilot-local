export interface ApiFailure { code: string; message: string; fields?: Record<string, string> }

export class ApiRequestError extends Error {
  constructor(message: string, public code: string, public status: number | null) { super(message); this.name = 'ApiRequestError'; }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiRequestError('连接不到 EvalPilot 本地服务。请重新启动工作台后再连接。', 'SERVICE_UNAVAILABLE', null);
  }
  let payload: { success: boolean; data?: T; error?: ApiFailure };
  try { payload = await response.json() as typeof payload; }
  catch { throw new ApiRequestError('当前页面与本地服务版本不一致。请重启 EvalPilot 工作台。', 'SERVICE_VERSION_MISMATCH', response.status); }
  if (!response.ok || !payload.success) {
    const code = payload.error?.code ?? 'REQUEST_FAILED';
    const message = code === 'API_NOT_FOUND'
      ? '当前本地服务版本缺少这项能力。请重启或更新 EvalPilot 后再试。'
      : payload.error?.message ?? `请求失败（${response.status}）`;
    throw new ApiRequestError(message, code, response.status);
  }
  return payload.data as T;
}
