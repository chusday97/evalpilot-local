import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Badcase } from '../../types.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { badcaseSchema } from './schemas.js';
import { storageIdSchema } from '../eval-set/schemas.js';

export function badcasePath(outputDir: string, badcaseId: string): string {
  return resolve(outputDir, 'badcases', `${storageIdSchema.parse(badcaseId)}.json`);
}

export async function saveBadcase(outputDir: string, badcase: Badcase): Promise<Badcase> {
  return writeSchemaJsonAtomic(badcasePath(outputDir, badcase.badcaseId), badcase, badcaseSchema);
}

export async function loadBadcase(outputDir: string, badcaseId: string): Promise<Badcase> {
  return readSchemaJson(badcasePath(outputDir, badcaseId), badcaseSchema);
}

export async function listBadcases(outputDir: string): Promise<Badcase[]> {
  const directory = resolve(outputDir, 'badcases');
  if (!await pathExists(directory)) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map((name) => readSchemaJson(resolve(directory, name), badcaseSchema)));
}
