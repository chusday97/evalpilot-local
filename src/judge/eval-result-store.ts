import { resolve } from 'node:path';
import type { EvalCaseResult } from '../../types.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { storageIdSchema } from '../eval-set/schemas.js';
import { evalCaseResultSchema } from './schemas.js';

export function evalCaseResultPath(outputDir: string, runId: string): string {
  return resolve(outputDir, 'runs', storageIdSchema.parse(runId), 'result.json');
}

export async function saveEvalCaseResult(outputDir: string, result: EvalCaseResult): Promise<EvalCaseResult> {
  return writeSchemaJsonAtomic(evalCaseResultPath(outputDir, result.runId), result, evalCaseResultSchema);
}

export async function loadEvalCaseResult(outputDir: string, runId: string): Promise<EvalCaseResult> {
  return readSchemaJson(evalCaseResultPath(outputDir, runId), evalCaseResultSchema);
}
