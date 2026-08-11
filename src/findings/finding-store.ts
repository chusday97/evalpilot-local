import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CandidateFinding } from '../../types.js';
import { storageIdSchema } from '../eval-set/schemas.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { candidateFindingSchema } from './schemas.js';

export function findingPath(outputDir: string, findingId: string): string {
  return resolve(outputDir, 'findings', `${storageIdSchema.parse(findingId)}.json`);
}

function legacyFindingPath(outputDir: string, findingId: string): string {
  return resolve(outputDir, 'findings', 'v1', `${storageIdSchema.parse(findingId)}.json`);
}

export async function saveFinding(outputDir: string, finding: CandidateFinding): Promise<CandidateFinding> {
  return writeSchemaJsonAtomic(findingPath(outputDir, finding.findingId), finding, candidateFindingSchema);
}

export async function loadFinding(outputDir: string, findingId: string): Promise<CandidateFinding> {
  const canonical = findingPath(outputDir, findingId);
  return readSchemaJson(await pathExists(canonical) ? canonical : legacyFindingPath(outputDir, findingId), candidateFindingSchema);
}

export async function listFindings(outputDir: string): Promise<CandidateFinding[]> {
  const canonicalDirectory = resolve(outputDir, 'findings');
  const legacyDirectory = resolve(canonicalDirectory, 'v1');
  const canonicalNames = await pathExists(canonicalDirectory) ? (await readdir(canonicalDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name) : [];
  const legacyNames = await pathExists(legacyDirectory) ? (await readdir(legacyDirectory)).filter((name) => name.endsWith('.json')) : [];
  const findings = await Promise.all([
    ...canonicalNames.map((name) => readSchemaJson(resolve(canonicalDirectory, name), candidateFindingSchema)),
    ...legacyNames.map((name) => readSchemaJson(resolve(legacyDirectory, name), candidateFindingSchema)),
  ]);
  const byId = new Map(findings.reverse().map((finding) => [finding.findingId, finding]));
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
