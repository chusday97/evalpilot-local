import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CoverageMatrix, EvalCaseResult, EvidencePacket } from '../../types.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { pathExists } from '../utils/file-system.js';
import { evalCaseResultSchema } from '../judge/schemas.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { coverageMatrixSchema, legacyCoverageMatrixSchema } from './schemas.js';

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
  try {
    return await readSchemaJson(latestCoveragePath(outputDir), coverageMatrixSchema);
  } catch (currentError) {
    try {
      const legacy = await readSchemaJson(latestCoveragePath(outputDir), legacyCoverageMatrixSchema);
      return coverageMatrixSchema.parse({
        ...legacy,
        dimensions: legacy.dimensions.map((dimension) => ({ ...dimension, coveredValues: [], missingValues: dimension.targetValues, coverageRatio: 0 })),
        gaps: legacy.gaps.map((gap) => ({ ...gap, kind: 'missing_asset' as const })),
        assetCoveredCells: legacy.coveredCells,
        executedCells: 0,
        verifiedCells: 0,
        coveredCells: 0,
        assetCoverageRatio: legacy.coverageRatio,
        executionCoverageRatio: 0,
        verifiedCoverageRatio: 0,
        cells: [],
        coverageRatio: 0,
      });
    } catch {
      throw currentError;
    }
  }
}

export async function loadCoverageRunEvidence(outputDir: string): Promise<{ results: EvalCaseResult[]; evidencePackets: EvidencePacket[] }> {
  const runsDirectory = resolve(outputDir, 'runs');
  if (!await pathExists(runsDirectory)) return { results: [], evidencePackets: [] };
  const results: EvalCaseResult[] = [];
  const evidencePackets: EvidencePacket[] = [];
  for (const runId of await readdir(runsDirectory)) {
    const resultPath = resolve(runsDirectory, runId, 'result.json');
    const packetPath = resolve(runsDirectory, runId, 'evidence-packet.json');
    if (await pathExists(resultPath)) results.push(await readSchemaJson(resultPath, evalCaseResultSchema));
    if (await pathExists(packetPath)) evidencePackets.push(await readSchemaJson(packetPath, evidencePacketSchema));
  }
  return { results, evidencePackets };
}
