import type { Page, Route } from 'playwright';

export type FaultType = 'empty' | 'timeout' | 'malformed';

export interface FaultController {
  type: FaultType;
  pattern: string;
  getTriggeredCount: () => number;
  dispose: () => Promise<void>;
}

export async function installFault(page: Page, pattern: string, type: FaultType): Promise<FaultController> {
  let triggeredCount = 0;
  const handler = async (route: Route): Promise<void> => {
    triggeredCount += 1;
    if (type === 'empty') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (type === 'malformed') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"unexpected":{"shape":true}}' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.abort('timedout');
  };
  await page.route(pattern, handler);
  return {
    type,
    pattern,
    getTriggeredCount: () => triggeredCount,
    dispose: async () => page.unroute(pattern, handler),
  };
}

export function parseFaultType(value: string | undefined): FaultType {
  if (value === 'empty' || value === 'timeout' || value === 'malformed') return value;
  throw new Error(`不支持的异常类型：${value ?? '未提供'}`);
}
