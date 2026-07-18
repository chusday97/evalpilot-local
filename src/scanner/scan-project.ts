import { resolve } from 'node:path';
import type { EvalPilotConfig, PageEvidence } from '../../types.js';
import { exploreBrowser } from '../browser/browser-explorer.js';
import { EvalPilotError } from '../utils/errors.js';
import { writeJsonAtomic } from '../utils/file-system.js';
import { scanDocuments } from './document-scanner.js';
import { scanGit } from './git-scanner.js';
import { getStartCommandSuggestions, scanRepository } from './repository-scanner.js';
import { scanRoutes } from './route-scanner.js';
import { scanApis } from './api-scanner.js';
import { scanTests } from './test-scanner.js';

export interface ScanResult {
  fileCount: number;
  documentCount: number;
  routeCount: number;
  apiCount: number;
  testFileCount: number;
  pageCount: number;
}

export async function scanProject(
  config: EvalPilotConfig,
  browserExplorer: typeof exploreBrowser = exploreBrowser,
): Promise<ScanResult> {
  const repository = await scanRepository(config.projectRoot);
  const documents = await scanDocuments(repository);
  const routes = await scanRoutes(repository);
  const apis = await scanApis(repository);
  const tests = await scanTests(repository);
  const git = await scanGit(config.projectRoot);
  const evidenceDir = resolve(config.outputDir, 'evidence');

  await Promise.all([
    writeJsonAtomic(resolve(evidenceDir, 'repository.json'), repository),
    writeJsonAtomic(resolve(evidenceDir, 'documents.json'), documents),
    writeJsonAtomic(resolve(evidenceDir, 'routes.json'), routes),
    writeJsonAtomic(resolve(evidenceDir, 'apis.json'), apis),
    writeJsonAtomic(resolve(evidenceDir, 'tests.json'), tests),
    writeJsonAtomic(resolve(evidenceDir, 'git.json'), git),
  ]);

  let pages: PageEvidence[];
  try {
    pages = await browserExplorer({
      targetUrl: config.targetUrl,
      screenshotsDir: resolve(evidenceDir, 'screenshots'),
    });
  } catch (error) {
    await Promise.all([
      writeJsonAtomic(resolve(evidenceDir, 'pages.json'), []),
      writeJsonAtomic(resolve(evidenceDir, 'ui-elements.json'), []),
      writeJsonAtomic(resolve(evidenceDir, 'console-errors.json'), []),
      writeJsonAtomic(resolve(evidenceDir, 'network-errors.json'), []),
      writeJsonAtomic(resolve(evidenceDir, 'browser-blocker.json'), {
        error: error instanceof Error ? error.message : String(error),
        targetUrl: config.targetUrl,
        startCommandSuggestions: getStartCommandSuggestions(repository),
        recordedAt: new Date().toISOString(),
      }),
    ]);
    throw new EvalPilotError(
      `代码和文档证据已保存，但页面探索被阻塞。${error instanceof Error ? error.message : String(error)}。` +
        `可尝试：${getStartCommandSuggestions(repository).join(' / ') || '先启动目标项目'}。`,
      'SCAN_BROWSER_BLOCKED',
    );
  }

  await Promise.all([
    writeJsonAtomic(resolve(evidenceDir, 'pages.json'), pages),
    writeJsonAtomic(
      resolve(evidenceDir, 'ui-elements.json'),
      pages.map(({ url, links, buttons, inputs, forms, dialogs }) => ({ url, links, buttons, inputs, forms, dialogs })),
    ),
    writeJsonAtomic(resolve(evidenceDir, 'console-errors.json'), pages.flatMap((page) => page.consoleErrors)),
    writeJsonAtomic(resolve(evidenceDir, 'network-errors.json'), pages.flatMap((page) => page.networkErrors)),
  ]);

  return {
    fileCount: repository.files.length,
    documentCount: documents.documents.length,
    routeCount: routes.routes.length,
    apiCount: apis.apis.length,
    testFileCount: tests.files.length,
    pageCount: pages.length,
  };
}
