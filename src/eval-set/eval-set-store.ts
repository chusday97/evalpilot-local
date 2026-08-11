import { resolve } from 'node:path';
import type { EvalCase, EvalSetManifest, EvalSetType } from '../../types.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { evalCaseSchema, evalSetManifestSchema, evalSetTypeSchema, storageIdSchema } from './schemas.js';
import { writeEvalSetDocument } from '../documentation/asset-documents.js';

export function evalSetManifestPath(outputDir: string): string {
  return resolve(outputDir, 'eval-sets', 'manifest.json');
}

export function evalCasePath(outputDir: string, setType: EvalSetType, caseId: string): string {
  return resolve(outputDir, 'eval-sets', evalSetTypeSchema.parse(setType), `${storageIdSchema.parse(caseId)}.json`);
}

export async function saveEvalSetManifest(outputDir: string, manifest: EvalSetManifest): Promise<EvalSetManifest> {
  return writeSchemaJsonAtomic(evalSetManifestPath(outputDir), manifest, evalSetManifestSchema);
}

export async function loadEvalSetManifest(outputDir: string): Promise<EvalSetManifest> {
  return readSchemaJson(evalSetManifestPath(outputDir), evalSetManifestSchema);
}

export async function saveEvalCase(outputDir: string, evalCase: EvalCase): Promise<EvalCase> {
  const validatedCase = evalCaseSchema.parse(evalCase);
  const manifestPath = evalSetManifestPath(outputDir);
  const existing = await pathExists(manifestPath) ? await loadEvalSetManifest(outputDir) : null;
  if (existing && existing.projectId !== validatedCase.projectId) {
    throw new Error(`Eval Set 属于项目 ${existing.projectId}，不能写入 ${validatedCase.projectId} 的案例。`);
  }
  const previousReference = existing?.cases.find((item) => item.caseId === validatedCase.caseId);
  if (previousReference && previousReference.setType !== validatedCase.setType) {
    throw new Error(`案例 ${validatedCase.caseId} 已属于 ${previousReference.setType}，Phase 0 不支持静默移动集合。`);
  }
  const savedCase = await writeSchemaJsonAtomic(evalCasePath(outputDir, validatedCase.setType, validatedCase.caseId), validatedCase, evalCaseSchema);
  const now = savedCase.updatedAt;
  const cases = [...(existing?.cases ?? []).filter((item) => item.caseId !== savedCase.caseId), {
    caseId: savedCase.caseId,
    setType: savedCase.setType,
    status: savedCase.status,
    version: savedCase.version,
    updatedAt: savedCase.updatedAt,
  }].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const manifest = await saveEvalSetManifest(outputDir, {
    projectId: savedCase.projectId,
    version: (existing?.version ?? 0) + 1,
    generatedAt: existing?.generatedAt ?? now,
    updatedAt: now,
    cases,
  });
  await writeEvalSetDocument(outputDir, manifest, await loadEvalSetCases(outputDir));
  return savedCase;
}

export async function loadEvalCase(outputDir: string, setType: EvalSetType, caseId: string): Promise<EvalCase> {
  return readSchemaJson(evalCasePath(outputDir, setType, caseId), evalCaseSchema);
}

export async function loadEvalSetCases(outputDir: string): Promise<EvalCase[]> {
  const manifest = await loadEvalSetManifest(outputDir);
  return Promise.all(manifest.cases.map((item) => loadEvalCase(outputDir, item.setType, item.caseId)));
}
