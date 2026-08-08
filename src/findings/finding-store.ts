import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CandidateFinding } from '../../types.js';
import { storageIdSchema } from '../eval-set/schemas.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { candidateFindingSchema } from './schemas.js';

const STORAGE_VERSION = 'v1';

export function findingPath(outputDir: string, findingId: string): string {
  return resolve(outputDir, 'findings', STORAGE_VERSION, `${storageIdSchema.parse(findingId)}.json`);
}

export async function saveFinding(outputDir: string, finding: CandidateFinding): Promise<CandidateFinding> {
  return writeSchemaJsonAtomic(findingPath(outputDir, finding.findingId), finding, candidateFindingSchema);
}

export async function loadFinding(outputDir: string, findingId: string): Promise<CandidateFinding> {
  return readSchemaJson(findingPath(outputDir, findingId), candidateFindingSchema);
}

export async function listFindings(outputDir: string): Promise<CandidateFinding[]> {
  const directory = resolve(outputDir, 'findings', STORAGE_VERSION);
  if (!await pathExists(directory)) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const findings = await Promise.all(names.map((name) => readSchemaJson(resolve(directory, name), candidateFindingSchema)));
  return findings.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
