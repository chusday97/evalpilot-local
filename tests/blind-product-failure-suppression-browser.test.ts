import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, EvalCase, EvalCaseResult, EvidencePacket } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';

const now = '2026-08-16T02:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-browser-product-failure', projectId: 'browser-calibration', setType: 'baseline', status: 'stable',
    origin: { type: 'human', note: 'product failure suppression browser calibration' }, capabilityId: 'cap-browser-product-failure', taskId: 'task-browser-product-failure',
    title: 'Confirmed product failure suppresses UX findings', hypothesis: 'A functional product break must not be reframed as UX friction.',
    persona: { personaId: 'persona-browser-calibration', name: 'Browser calibration actor', knowledgeLevel: 'low', patienceTurns: 4, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: ['只依据当前可见界面行动'], exitConditions: ['连续没有进展时退出'] },
    goal: 'Submit and reach Done', knownInformation: {}, preconditions: ['Fixture is open'],
    oracle: { expectedOutcome: ['Done'], mustObserve: ['Done'], mustNotObserve: ['Broken'], businessRules: [], semanticRubric: ['Submission succeeds'], deterministicAssertions: [], inconclusiveWhen: ['Evidence is insufficient'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-browser-product-failure' }], riskLevel: 'P1', generationReason: 'Browser calibration fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function observation(request: AiStructuredRequest) {
  const body = JSON.parse(request.userPrompt) as { observation?: { visibleStateSummary?: string; interactableElements?: Array<{ elementId: string; label: string }> } };
  return { text: body.observation?.visibleStateSummary ?? '', elements: body.observation?.interactableElements ?? [] };
}

function productFailure(caseId: string, runId: string): EvalCaseResult {
  return {
    runId, caseId, verdict: 'fail', failureSource: 'product', severity: 'P1',
    deterministic: { checks: [], hardFailure: true, severity: 'P1', evidenceRefs: ['failure.png'] },
    semantic: { verdict: 'fail', taskCompletion: 'failed', summary: 'The submit control does not advance the product state.', whatWorked: ['Submit control is visible'], whatFailed: ['Submission never reaches Done'], whyItMatters: ['The user cannot complete the task'], confirmedFacts: ['Submit was attempted and the required result did not appear'], hypotheses: [], unknowns: [], evidenceRefs: ['failure.png'], confidence: 1 },
    evidencePacketPath: 'evidence-packet.json', createdAt: now,
  };
}

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('Blind product failure suppression in Chromium', () => {
  it('keeps observed no-feedback/abandonment evidence but emits zero UX findings after confirmed Product Failure', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent('<!doctype html><html><body><main><h1>Submit form</h1><button>Submit</button></main></body></html>');
      let actorCalls = 0;
      const provider = new MockAiProvider((request) => {
        if (request.task !== 'actor') throw new Error(`Unexpected provider task: ${request.task}`);
        actorCalls += 1;
        const state = observation(request);
        if (actorCalls > 1) return { intentSummary: 'Submit produced no result, stop', action: 'abandon', targetElementId: null, value: null, expectedResult: 'Stop', confidence: 0.9 };
        const submit = state.elements.find((element) => element.label === 'Submit');
        return { intentSummary: 'Submit the form', action: 'click', targetElementId: submit?.elementId ?? null, value: null, expectedResult: 'Done', confidence: 0.95 };
      });
      const item = evalCase();
      const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-product-failure-suppression-'));
      const run = await runAiTestAgent(page, item, provider, { outputDir, startingUrl: page.url(), maxSteps: 3, waitPolicy: { initialObservationMs: 10, pollIntervalMs: 20, softTimeoutMs: 60, hardTimeoutMs: 120, progressExtensionMs: 30, maxProgressExtensions: 1 }, now: () => new Date(now) });
      const packet = JSON.parse(await readFile(run.evidencePacketPath, 'utf8')) as EvidencePacket;
      const analysis = analyzeBlindExperience({ evalCase: item, result: productFailure(item.caseId, run.runId), packet, agentRun: { status: run.status, decisions: run.decisions } });

      expect(analysis.actions.some((action) => action.outcome === 'no_feedback')).toBe(true);
      expect(analysis.agentStatus).toBe('abandoned');
      expect(analysis.analysisStatus).toBe('suppressed_functional_failure');
      expect(analysis.frictions).toEqual([]);
      expect(analysis.findings).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});