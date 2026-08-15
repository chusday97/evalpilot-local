import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, EvalCase, EvalCaseResult, EvidencePacket } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';

const now = '2026-08-16T02:05:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-browser-evaluator-failure', projectId: 'browser-calibration', setType: 'baseline', status: 'stable',
    origin: { type: 'human', note: 'evaluator failure suppression browser calibration' }, capabilityId: 'cap-browser-evaluator-failure', taskId: 'task-browser-evaluator-failure',
    title: 'Evaluator failure suppresses UX findings', hypothesis: 'Evaluator uncertainty must not be converted into a product UX diagnosis.',
    persona: { personaId: 'persona-browser-calibration', name: 'Browser calibration actor', knowledgeLevel: 'low', patienceTurns: 4, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: ['只依据当前可见界面行动'], exitConditions: ['连续没有进展时退出'] },
    goal: 'Submit and reach Done', knownInformation: {}, preconditions: ['Fixture is open'],
    oracle: { expectedOutcome: ['Done'], mustObserve: ['Done'], mustNotObserve: [], businessRules: [], semanticRubric: ['Submission succeeds'], deterministicAssertions: [], inconclusiveWhen: ['Evaluator evidence is incomplete'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-browser-evaluator-failure' }], riskLevel: 'P2', generationReason: 'Browser calibration fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function observation(request: AiStructuredRequest) {
  const body = JSON.parse(request.userPrompt) as { observation?: { interactableElements?: Array<{ elementId: string; label: string }> } };
  return body.observation?.interactableElements ?? [];
}

function evaluatorFailure(caseId: string, runId: string): EvalCaseResult {
  return {
    runId, caseId, verdict: 'inconclusive', failureSource: 'evaluator', severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['evaluator-gap.png'] },
    semantic: { verdict: 'inconclusive', taskCompletion: 'unknown', summary: 'Evaluator evidence is incomplete, so product behavior cannot be classified.', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: ['Whether the product or evaluator caused the unresolved state'], evidenceRefs: ['evaluator-gap.png'], confidence: 0.3 },
    evidencePacketPath: 'evidence-packet.json', createdAt: now,
  };
}

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('Blind evaluator failure suppression in Chromium', () => {
  it('keeps browser behavior auditable but emits zero UX findings when failureSource is evaluator', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent('<!doctype html><html><body><main><h1>Submit form</h1><button>Continue</button></main></body></html>');
      let calls = 0;
      const provider = new MockAiProvider((request) => {
        if (request.task !== 'actor') throw new Error(`Unexpected provider task: ${request.task}`);
        calls += 1;
        if (calls > 1) return { intentSummary: 'No observable result, stop', action: 'abandon', targetElementId: null, value: null, expectedResult: 'Stop', confidence: 0.8 };
        const button = observation(request).find((element) => element.label === 'Continue');
        return { intentSummary: 'Try the visible action', action: 'click', targetElementId: button?.elementId ?? null, value: null, expectedResult: 'Done', confidence: 0.9 };
      });
      const item = evalCase();
      const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-evaluator-failure-suppression-'));
      const run = await runAiTestAgent(page, item, provider, { outputDir, startingUrl: page.url(), maxSteps: 3, waitPolicy: { initialObservationMs: 10, pollIntervalMs: 20, softTimeoutMs: 60, hardTimeoutMs: 120, progressExtensionMs: 30, maxProgressExtensions: 1 }, now: () => new Date(now) });
      const packet = JSON.parse(await readFile(run.evidencePacketPath, 'utf8')) as EvidencePacket;
      const analysis = analyzeBlindExperience({ evalCase: item, result: evaluatorFailure(item.caseId, run.runId), packet, agentRun: { status: run.status, decisions: run.decisions } });

      expect(analysis.actions.some((action) => action.outcome === 'no_feedback')).toBe(true);
      expect(analysis.agentStatus).toBe('abandoned');
      expect(analysis.analysisStatus).toBe('insufficient_evidence');
      expect(analysis.frictions).toEqual([]);
      expect(analysis.findings).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});