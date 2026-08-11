import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvaluatorBadcase } from '../../types.js';
import { storageIdSchema } from '../eval-set/schemas.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { evaluatorBadcaseSchema } from './schemas.js';

const STORAGE_VERSION = 'v1';

export function evaluatorBadcasePath(outputDir: string, evaluatorBadcaseId: string): string {
  return resolve(outputDir, 'evaluator-badcases', STORAGE_VERSION, `${storageIdSchema.parse(evaluatorBadcaseId)}.json`);
}

export async function saveEvaluatorBadcase(outputDir: string, badcase: EvaluatorBadcase): Promise<EvaluatorBadcase> {
  return writeSchemaJsonAtomic(evaluatorBadcasePath(outputDir, badcase.evaluatorBadcaseId), badcase, evaluatorBadcaseSchema);
}

export async function loadEvaluatorBadcase(outputDir: string, evaluatorBadcaseId: string): Promise<EvaluatorBadcase> {
  return readSchemaJson(evaluatorBadcasePath(outputDir, evaluatorBadcaseId), evaluatorBadcaseSchema);
}

export async function listEvaluatorBadcases(outputDir: string): Promise<EvaluatorBadcase[]> {
  const directory = resolve(outputDir, 'evaluator-badcases', STORAGE_VERSION);
  if (!await pathExists(directory)) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map((name) => readSchemaJson(resolve(directory, name), evaluatorBadcaseSchema)));
}
