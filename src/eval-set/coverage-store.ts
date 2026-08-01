import { resolve } from 'node:path';
import type { CoverageMatrix } from '../../types.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { coverageMatrixSchema } from './schemas.js';

export function latestCoveragePath(outputDir: string): string {
  return resolve(outputDir, 'coverage', 'latest.json');
}

export function coverageHistoryPath(outputDir: string, generatedAt: string): string {
  return resolve(outputDir, 'coverage', 'history', `${generatedAt.replace(/[:.]/g, '-')}.json`);
}

export async function saveCoverageMatrix(outputDir: string, matrix: CoverageMatrix): Promise<CoverageMatrix> {
  const history = coverageHistoryPath(outputDir, matrix.generatedAt);
  const validated = await writeSchemaJsonAtomic(history, matrix, coverageMatrixSchema);
  await writeSchemaJsonAtomic(latestCoveragePath(outputDir), validated, coverageMatrixSchema);
  return validated;
}

export async function loadLatestCoverageMatrix(outputDir: string): Promise<CoverageMatrix> {
  return readSchemaJson(latestCoveragePath(outputDir), coverageMatrixSchema);
}
