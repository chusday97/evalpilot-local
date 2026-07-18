import { relative, resolve } from 'node:path';
import type { EvalPilotConfig } from '../../types.js';
import { EvalPilotError } from '../utils/errors.js';
import {
  ensureDirectory,
  ensureGitignoreEntry,
  pathExists,
  writeJsonAtomic,
  writeTextAtomic,
  writeYamlAtomic,
} from '../utils/file-system.js';
import {
  assertTargetReachable,
  CONFIG_FILE,
  parseTargetUrl,
  resolveProjectDirectory,
} from './project-config.js';
import { resolveDataRoot } from '../runtime/paths.js';

export interface InitializeOptions {
  cwd: string;
  project: string;
  url: string;
  outputDir?: string;
  skipReachability?: boolean;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}

const directories = [
  'evidence/screenshots',
  'generated-tests/playwright',
  'regression',
  'runs',
  'reports',
  'journeys',
  'comparisons',
  'secrets',
];

const jsonFiles: Record<string, unknown> = {
  'evidence/repository.json': {},
  'evidence/routes.json': { routes: [], sourceFiles: [], scannedAt: null },
  'evidence/apis.json': { apis: [], sourceFiles: [], claims: [], scannedAt: null },
  'evidence/tests.json': { files: [], scripts: {}, frameworks: [], claims: [], scannedAt: null },
  'evidence/documents.json': { documents: [], claims: [], scannedAt: null },
  'evidence/git.json': { available: false, branch: null, commits: [], changedFiles: [], scannedAt: null },
  'evidence/pages.json': [],
  'evidence/ui-elements.json': [],
  'evidence/console-errors.json': [],
  'evidence/network-errors.json': [],
  'reports/coverage.json': {},
};

const textFiles: Record<string, string> = {
  'personas.jsonl': '',
  'scenarios.jsonl': '',
  'exploratory-scenarios.jsonl': '',
  'regression/regression-cases.jsonl': '',
  'reports/issues.jsonl': '',
  'reports/ux-issues.jsonl': '',
  'reports/LATEST_REPORT.md': '# EvalPilot Local 最新评测报告\n\n尚未生成报告。\n',
  'taxonomy.yaml': '{}\n',
  'rubrics.yaml': '{}\n',
  'release-gates.yaml': 'releaseGates: []\n',
};

export async function initializeProject(options: InitializeOptions): Promise<EvalPilotConfig> {
  const projectRoot = await resolveProjectDirectory(options.project);
  const targetUrl = parseTargetUrl(options.url);
  const outputDir = options.outputDir ? resolve(options.outputDir) : resolveDataRoot(options.cwd);

  if (await pathExists(outputDir)) {
    throw new EvalPilotError(`检测到已有 ${outputDir}，为保护现有结果，本次不会覆盖。`, 'ALREADY_INITIALIZED');
  }

  if (!options.skipReachability) await assertTargetReachable(targetUrl, options.fetchImplementation);

  const config: EvalPilotConfig = {
    version: 1,
    projectRoot,
    targetUrl,
    outputDir,
    browser: 'chromium',
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  try {
    await Promise.all(directories.map((directory) => ensureDirectory(resolve(outputDir, directory))));
    await writeYamlAtomic(resolve(outputDir, CONFIG_FILE), config);
    await Promise.all(
      Object.entries(jsonFiles).map(([path, value]) => writeJsonAtomic(resolve(outputDir, path), value)),
    );
    await Promise.all(
      Object.entries(textFiles).map(([path, value]) => writeTextAtomic(resolve(outputDir, path), value)),
    );
    const outputRelative = relative(options.cwd, outputDir);
    if (outputRelative === '.evalpilot' || outputRelative.startsWith('.evalpilot/')) {
      await ensureGitignoreEntry(resolve(options.cwd, '.gitignore'), '.evalpilot/secrets/');
    }
  } catch (error) {
    throw new EvalPilotError(`初始化文件写入失败：${String(error)}`, 'INITIALIZATION_WRITE_FAILED');
  }

  return config;
}
