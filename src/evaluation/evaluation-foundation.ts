import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AiProvider } from '../ai/provider.js';
import type { DocumentEvidence, EvaluationFoundationState, PageEvidence, ProductModel, ProjectBackground, RouteEvidence } from '../../types.js';
import { analyzeCoverage } from '../eval-set/coverage-analyzer.js';
import { saveCoverageMatrix } from '../eval-set/coverage-store.js';
import { generateAndSaveBaseline, generateAndSaveBaselineWithOracleBuilder } from '../eval-set/eval-set-generator.js';
import { buildProductModel } from '../product-model/product-model-builder.js';
import { listProductModelVersions, saveProductModel } from '../product-model/product-model-store.js';
import { understandProductTasks } from '../product-model/product-understanding-agent.js';
import { pathExists, readJsonFile, readYamlFile } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';
import type { EvalBlueprint } from '../../types.js';
import { evaluationFoundationStateSchema } from './schemas.js';

const sourcePaths = [
  'project-background.yaml',
  'eval-blueprint.yaml',
  'evidence/routes.json',
  'evidence/pages.json',
  'evidence/documents.json',
] as const;

export function evaluationFoundationStatePath(outputDir: string): string {
  return resolve(outputDir, 'evaluation-foundation.json');
}

export async function evaluationSourceFingerprint(outputDir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const relativePath of sourcePaths) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await readFile(resolve(outputDir, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function loadEvaluationFoundationState(outputDir: string): Promise<EvaluationFoundationState | null> {
  const path = evaluationFoundationStatePath(outputDir);
  return await pathExists(path) ? readSchemaJson(path, evaluationFoundationStateSchema) : null;
}

export async function saveEvaluationFoundationState(outputDir: string, state: EvaluationFoundationState): Promise<EvaluationFoundationState> {
  return writeSchemaJsonAtomic(evaluationFoundationStatePath(outputDir), state, evaluationFoundationStateSchema);
}

export async function generateEvaluationFoundation(input: { projectId: string; outputDir: string; provider?: AiProvider; allowRemoteModel?: boolean; generatedAt?: string }) {
  const [background, blueprint, versions] = await Promise.all([
    readYamlFile<ProjectBackground>(resolve(input.outputDir, 'project-background.yaml')),
    readYamlFile<EvalBlueprint>(resolve(input.outputDir, 'eval-blueprint.yaml')),
    listProductModelVersions(input.outputDir),
  ]);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const version = (versions.at(-1) ?? 0) + 1;
  let model: ProductModel;
  let generationMode: 'ai' | 'deterministic' | 'deterministic_fallback' = 'deterministic';
  let warnings: string[] = [];
  if (input.provider && input.allowRemoteModel === true) {
    const evidenceDir = resolve(input.outputDir, 'evidence');
    const [routes, pages, documents] = await Promise.all([
      readJsonFile<RouteEvidence>(resolve(evidenceDir, 'routes.json')),
      readJsonFile<PageEvidence[]>(resolve(evidenceDir, 'pages.json')),
      readJsonFile<DocumentEvidence>(resolve(evidenceDir, 'documents.json')),
    ]);
    const understanding = await understandProductTasks({ projectId: input.projectId, background, blueprint, routes, pages, documents, provider: input.provider, existingUnknowns: background.unknowns, version, generatedAt, allowRemoteModel: true });
    model = understanding.model;
    generationMode = understanding.mode;
    warnings = understanding.warnings;
  } else {
    model = buildProductModel({ projectId: input.projectId, background, blueprint, version, generatedAt });
  }
  await saveProductModel(input.outputDir, model);
  const generated = input.provider && input.allowRemoteModel === true
    ? await generateAndSaveBaselineWithOracleBuilder(input.outputDir, model, input.provider, { generatedAt, allowRemoteModel: true })
    : { cases: await generateAndSaveBaseline(input.outputDir, model, generatedAt), oracleResults: [] };
  const cases = generated.cases;
  warnings = [...warnings, ...generated.oracleResults.flatMap((result) => result.warnings)];
  const coverage = analyzeCoverage({ model, cases, generatedAt });
  await saveCoverageMatrix(input.outputDir, coverage);
  return { productModel: model, cases, coverage, generationMode, warnings };
}
