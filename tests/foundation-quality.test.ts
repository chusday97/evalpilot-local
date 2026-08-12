import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiProvider } from '../src/ai/provider.js';
import { foundationQualityFromGeneration, foundationQualityMessage, loadFoundationQualityState, saveFoundationQualityState, shouldRegenerateFoundation } from '../src/evaluation/foundation-quality.js';

const fingerprint = 'a'.repeat(64);
const provider = {
  info: { providerId: 'openai', model: 'gpt-test', remote: true, structuredOutput: true, screenshotInput: false },
  generateStructured: async () => { throw new Error('not used'); },
} as AiProvider;

describe('foundation quality state', () => {
  it('marks AI understanding ready and deterministic fallback degraded', () => {
    expect(foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'ai', warnings: [], provider, generatedAt: '2026-08-12T06:00:00.000Z' })).toMatchObject({ quality: 'ready', retryRecommended: false, providerId: 'openai', model: 'gpt-test' });
    expect(foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'deterministic_fallback', warnings: ['model output invalid'], provider, generatedAt: '2026-08-12T06:00:00.000Z' })).toMatchObject({ quality: 'degraded', retryRecommended: true });
  });

  it('persists a reviewable sidecar without changing the legacy fingerprint state schema', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-foundation-quality-'));
    const state = foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'ai', warnings: ['one warning'], provider, generatedAt: '2026-08-12T06:00:00.000Z' });
    await saveFoundationQualityState(outputDir, state);
    expect(await loadFoundationQualityState(outputDir)).toEqual(state);
  });

  it('forces one rebuild when an old foundation has no quality sidecar', () => {
    expect(shouldRegenerateFoundation({ hasProductModel: true, hasEvalSet: true, sourceFingerprint: fingerprint, persistedFingerprint: fingerprint, qualityState: null, providerId: 'openai', model: 'gpt-test' })).toBe(true);
  });

  it('rebuilds degraded foundations until AI understanding succeeds', () => {
    const degraded = foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'deterministic_fallback', warnings: [], provider, generatedAt: '2026-08-12T06:00:00.000Z' });
    expect(shouldRegenerateFoundation({ hasProductModel: true, hasEvalSet: true, sourceFingerprint: fingerprint, persistedFingerprint: fingerprint, qualityState: degraded, providerId: 'openai', model: 'gpt-test' })).toBe(true);
  });

  it('rebuilds when the connected provider model changes', () => {
    const ready = foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'ai', warnings: [], provider, generatedAt: '2026-08-12T06:00:00.000Z' });
    expect(shouldRegenerateFoundation({ hasProductModel: true, hasEvalSet: true, sourceFingerprint: fingerprint, persistedFingerprint: fingerprint, qualityState: ready, providerId: 'openai', model: 'gpt-new' })).toBe(true);
  });

  it('reuses a ready foundation only when evidence and provider identity still match', () => {
    const ready = foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'ai', warnings: [], provider, generatedAt: '2026-08-12T06:00:00.000Z' });
    expect(shouldRegenerateFoundation({ hasProductModel: true, hasEvalSet: true, sourceFingerprint: fingerprint, persistedFingerprint: fingerprint, qualityState: ready, providerId: 'openai', model: 'gpt-test' })).toBe(false);
  });

  it('explains that degraded understanding will not continue to browser evaluation', () => {
    const degraded = foundationQualityFromGeneration({ sourceFingerprint: fingerprint, generationMode: 'deterministic_fallback', warnings: ['schema invalid'], provider, generatedAt: '2026-08-12T06:00:00.000Z' });
    expect(foundationQualityMessage(degraded)).toContain('不会使用降级案例继续浏览器评测');
    expect(foundationQualityMessage(degraded)).toContain('schema invalid');
  });
});
