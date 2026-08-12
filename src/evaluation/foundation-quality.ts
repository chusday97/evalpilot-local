import { resolve } from 'node:path';
import { z } from 'zod';
import type { AiProvider } from '../ai/provider.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson, writeSchemaJsonAtomic } from '../utils/schema-file.js';

export type FoundationGenerationMode = 'ai' | 'deterministic' | 'deterministic_fallback';
export type FoundationQuality = 'ready' | 'degraded';

export interface FoundationQualityState {
  schemaVersion: 1;
  sourceFingerprint: string;
  generationMode: FoundationGenerationMode;
  quality: FoundationQuality;
  providerId: string | null;
  model: string | null;
  warnings: string[];
  retryRecommended: boolean;
  generatedAt: string;
}

const foundationQualityStateSchema = z.object({
  schemaVersion: z.literal(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  generationMode: z.enum(['ai', 'deterministic', 'deterministic_fallback']),
  quality: z.enum(['ready', 'degraded']),
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  warnings: z.array(z.string()),
  retryRecommended: z.boolean(),
  generatedAt: z.iso.datetime(),
}).strict();

export function foundationQualityStatePath(outputDir: string): string {
  return resolve(outputDir, 'evaluation-foundation-quality.json');
}

export async function loadFoundationQualityState(outputDir: string): Promise<FoundationQualityState | null> {
  const path = foundationQualityStatePath(outputDir);
  return await pathExists(path) ? readSchemaJson(path, foundationQualityStateSchema) : null;
}

export async function saveFoundationQualityState(outputDir: string, state: FoundationQualityState): Promise<FoundationQualityState> {
  return writeSchemaJsonAtomic(foundationQualityStatePath(outputDir), state, foundationQualityStateSchema);
}

export function foundationQualityFromGeneration(input: {
  sourceFingerprint: string;
  generationMode: FoundationGenerationMode;
  warnings: string[];
  provider: AiProvider | null;
  generatedAt: string;
}): FoundationQualityState {
  const quality: FoundationQuality = input.generationMode === 'ai' ? 'ready' : 'degraded';
  return foundationQualityStateSchema.parse({
    schemaVersion: 1,
    sourceFingerprint: input.sourceFingerprint,
    generationMode: input.generationMode,
    quality,
    providerId: input.provider?.info.providerId ?? null,
    model: input.provider?.info.model ?? null,
    warnings: [...new Set(input.warnings)],
    retryRecommended: quality === 'degraded',
    generatedAt: input.generatedAt,
  });
}

export function shouldRegenerateFoundation(input: {
  hasProductModel: boolean;
  hasEvalSet: boolean;
  sourceFingerprint: string;
  persistedFingerprint: string | null;
  qualityState: FoundationQualityState | null;
}): boolean {
  if (!input.hasProductModel || !input.hasEvalSet) return true;
  if (!input.persistedFingerprint || input.persistedFingerprint !== input.sourceFingerprint) return true;
  if (!input.qualityState) return true;
  if (input.qualityState.sourceFingerprint !== input.sourceFingerprint) return true;
  return input.qualityState.quality === 'degraded' || input.qualityState.retryRecommended;
}

export function foundationQualityMessage(state: FoundationQualityState): string {
  if (state.quality === 'degraded') {
    const warning = state.warnings[0] ? ` ${state.warnings[0]}` : '';
    return `产品理解使用了降级模式，本次案例可信度受限；下次模型可用时会自动重建。${warning}`;
  }
  return state.warnings.length
    ? `AI 产品理解已完成，但有 ${state.warnings.length} 条生成提醒。`
    : 'AI 产品理解已完成。';
}
