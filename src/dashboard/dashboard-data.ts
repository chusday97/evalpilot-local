import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvalPilotConfig } from '../../types.js';
import { getProjectStatus } from '../config/status.js';
import { pathExists, readJsonLinesFile, readYamlFile } from '../utils/file-system.js';

export interface DashboardOverview {
  projectName: string;
  targetUrl: string;
  localOnly: true;
  personaCount: number;
  caseCount: number;
  journeyCount: number;
  issueCount: number;
  latestRunId: string | null;
  stages: Record<string, boolean>;
}

async function countJsonLines(path: string): Promise<number> {
  if (!(await pathExists(path))) return 0;
  return (await readJsonLinesFile<unknown>(path)).length;
}

async function latestRunId(outputDir: string): Promise<string | null> {
  const directory = resolve(outputDir, 'runs');
  if (!(await pathExists(directory))) return null;
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1) ?? null;
}

export function validateDashboardHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/^\[/, '').replace(/\](?=:|$)/, '').split(':')[0]?.toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

export async function loadDashboardOverview(config: EvalPilotConfig): Promise<DashboardOverview> {
  const backgroundPath = resolve(config.outputDir, 'project-background.yaml');
  const background: { projectName?: string } = await readYamlFile<{ projectName?: string }>(backgroundPath).catch(() => ({}));
  const journeysDirectory = resolve(config.outputDir, 'journeys');
  const journeyCount = await pathExists(journeysDirectory)
    ? (await readdir(journeysDirectory)).filter((name) => name.endsWith('.yaml')).length
    : 0;
  const [personaCount, fixedCases, exploratoryCases, issueCount, status, runId] = await Promise.all([
    countJsonLines(resolve(config.outputDir, 'personas.jsonl')),
    countJsonLines(resolve(config.outputDir, 'scenarios.jsonl')),
    countJsonLines(resolve(config.outputDir, 'exploratory-scenarios.jsonl')),
    countJsonLines(resolve(config.outputDir, 'reports', 'ux-issues.jsonl')),
    getProjectStatus(config),
    latestRunId(config.outputDir),
  ]);
  return {
    projectName: background.projectName ?? config.projectRoot.split('/').at(-1) ?? '未命名项目',
    targetUrl: config.targetUrl,
    localOnly: true,
    personaCount,
    caseCount: fixedCases + exploratoryCases,
    journeyCount,
    issueCount,
    latestRunId: runId,
    stages: status.stages,
  };
}

export async function readOptionalText(path: string): Promise<string | null> {
  if (!(await pathExists(path))) return null;
  return readFile(path, 'utf8');
}
