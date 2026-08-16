import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, EvalCase, EvalCaseResult, EvidencePacket } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';

const now = '2026-08-16T01:55:00.000Z';

function item(): EvalCase {
  return {
    caseId: 'case-disabled-only-dead-end', projectId: 'browser-calibration', setType: 'baseline', status: 'stable',
    origin: { type: 'human', note: 'disabled-only dead-end calibration' }, capabilityId: 'cap-disabled-dead-end', taskId: 'task-disabled-dead-end',
    title: 'Disabled-only page is an objective dead end', hypothesis: 'Disabled controls do not provide a usable recovery path.',
    persona: { personaId: 'persona-browser-calibration', name: 'Browser calibration actor', knowledgeLevel: 'low', patienceTurns: 4, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: ['只依据当前可见界面行动'], exitConditions: ['没有安全可执行路径时退出'] },
    goal: 'Reach Done', knownInformation: {}, preconditions: ['Fixture is open'],
    oracle: { expectedOutcome: ['Done'], mustObserve: ['Done'], mustNotObserve: [], businessRules: [], semanticRubric: ['Goal completion is visible'], deterministicAssertions: [], inconclusiveWhen: ['Goal completion is not proven'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-disabled-dead-end' }], riskLevel: 'P2', generationReason: 'Browser calibration fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function observation(request: AiStructuredRequest) {
  const body = JSON.parse(request.userPrompt) as { observation?: { visibleStateSummary?: string; interactableElements?: Array<{ elementId: string; label: string; disabled: boolean }> } };
  return { text: body.observation?.visibleStateSummary ?? '', elements: body.observation?.interactableElements ?? [] };
}

function inconclusiveResult(caseId: string, runId: string): EvalCaseResult {
  return {
    runId, caseId, verdict: 'inconclusive', failureSource: null, severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['final.png'] },
    semantic: { verdict: 'inconclusive', taskCompletion: 'unknown', summary: 'Goal completion is not proven.', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: ['Only disabled controls remain'], hypotheses: [], unknowns: [], evidenceRefs: ['final.png'], confidence: 0.9 },
    evidencePacketPath: 'evidence-packet.json', createdAt: now,
  };
}

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('disabled-only dead-end calibration', () => {
  it('treats an explicit abandon with only disabled controls as dead-end evidence', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html><html><body><main id="app"><h1>Home</h1><button id="open" onclick="document.getElementById('app').innerHTML='<h1>Blocked step</h1><p>No action can be taken.</p><button disabled>Continue</button>'">Open blocked step</button></main></body></html>`);
      const provider = new MockAiProvider((request) => {
        if (request.task !== 'actor') throw new Error(`Unexpected provider task: ${request.task}`);
        const state = observation(request);
        if (state.text.includes('Blocked step')) {
          expect(state.elements.some((element) => element.label === 'Continue' && element.disabled)).toBe(true);
          return { intentSummary: 'Only a disabled action remains', action: 'abandon', targetElementId: null, value: null, expectedResult: 'Stop', confidence: 0.95 };
        }
        const open = state.elements.find((element) => element.label === 'Open blocked step');
        return { intentSummary: 'Open the next step', action: 'click', targetElementId: open?.elementId ?? null, value: null, expectedResult: 'See next state', confidence: 0.9 };
      });
      const evalCase = item();
      const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-disabled-dead-end-'));
      const run = await runAiTestAgent(page, evalCase, provider, { outputDir, startingUrl: page.url(), maxSteps: 3, waitPolicy: { initialObservationMs: 10, pollIntervalMs: 20, softTimeoutMs: 60, hardTimeoutMs: 120, progressExtensionMs: 30, maxProgressExtensions: 1 }, now: () => new Date(now) });
      const packet = JSON.parse(await readFile(run.evidencePacketPath, 'utf8')) as EvidencePacket;
      const analysis = analyzeBlindExperience({ evalCase, result: inconclusiveResult(evalCase.caseId, run.runId), packet, agentRun: { status: run.status, decisions: run.decisions } });

      expect(analysis.actions.at(-1)?.outcome).toBe('dead_end_abandon');
      expect(analysis.findings.some((finding) => finding.type === 'journey_breakpoint')).toBe(true);
      expect(analysis.findings.some((finding) => finding.type === 'abandonment_risk')).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});