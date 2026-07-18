import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvalPilotConfig } from '../../types.js';
import { pathExists } from '../utils/file-system.js';

export interface ProjectStatus {
  config: EvalPilotConfig;
  stages: Record<string, boolean>;
}

export async function getProjectStatus(config: EvalPilotConfig): Promise<ProjectStatus> {
  const exists = (path: string) => pathExists(resolve(config.outputDir, path));
  const jsonHasTimestamp = async (path: string): Promise<boolean> => {
    if (!(await exists(path))) {
      return false;
    }
    try {
      const value = JSON.parse(await readFile(resolve(config.outputDir, path), 'utf8')) as { scannedAt?: unknown };
      return typeof value.scannedAt === 'string' && value.scannedAt.length > 0;
    } catch {
      return false;
    }
  };
  const jsonlHasRows = async (path: string): Promise<boolean> => {
    if (!(await exists(path))) {
      return false;
    }
    return (await readFile(resolve(config.outputDir, path), 'utf8')).trim().length > 0;
  };
  return {
    config,
    stages: {
      initialized: true,
      scanned: await jsonHasTimestamp('evidence/repository.json'),
      backgroundGenerated: await exists('project-background.yaml'),
      blueprintGenerated: await exists('eval-blueprint.yaml'),
      casesGenerated: await jsonlHasRows('scenarios.jsonl'),
      journeysGenerated: await jsonlHasRows('exploratory-scenarios.jsonl'),
      reportGenerated: await exists('reports/report-metadata.json'),
    },
  };
}
