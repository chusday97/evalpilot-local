import type { BrowserErrorEvidence } from '../../types.js';
import type { ConsoleMessage, Page, Request, Response } from 'playwright';

export interface NetworkRecording {
  consoleErrors: BrowserErrorEvidence[];
  networkErrors: BrowserErrorEvidence[];
  dispose: () => void;
}

export function recordBrowserErrors(page: Page): NetworkRecording {
  const consoleErrors: BrowserErrorEvidence[] = [];
  const networkErrors: BrowserErrorEvidence[] = [];

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push({ message: message.text() });
  };
  const onRequestFailed = (request: Request) => {
    networkErrors.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      message: request.failure()?.errorText ?? 'request failed',
    });
  };
  const onResponse = (response: Response) => {
    if (response.status() >= 400) {
      networkErrors.push({
        url: response.url(),
        method: response.request().method(),
        resourceType: response.request().resourceType(),
        status: response.status(),
        message: `HTTP ${response.status()}`,
      });
    }
  };

  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return {
    consoleErrors,
    networkErrors,
    dispose: () => {
      page.off('console', onConsole);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}
