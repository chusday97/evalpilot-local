import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, EvalCase, EvalCaseResult, EvidencePacket } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';

const now = '2026-08-16T01:30:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-safe-recovery-abandon',
    projectId: 'browser-calibration',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'dead-end recovery boundary calibration' },
    capabilityId: 'cap-safe-recovery-abandon',
    taskId: 'task-safe-recovery-abandon',
    title: 'Actor abandons while a safe recovery control remains',
    hypothesis: 'Abandonment with a visible safe recovery control is not a proven dead end.',
    persona: {
      personaId: 'persona-browser-calibration',
      name: 'Browser calibration actor',
      knowledgeLevel: 'low',
      patienceTurns: 4,
      retryTolerance: 1,
      privacySensitivity: 'medium',
      behaviorPolicy: ['只依据当前可见界面行动'],
      exitConditions: ['可以主动退出'],
    },
    goal: 'Reach Done',
    knownInformation: {},
    preconditions: ['Fixture is open'],
    oracle: {
      expectedOutcome: ['Done'],
      mustObserve: ['Done'],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: ['Goal completion is visible'],
      deterministicAssertions: [],
      inconclusiveWhen: ['Goal completion is not proven'],
    },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-safe-recovery-abandon' }],
    riskLevel: 'P2',
    generationReason: 'Browser calibration fixture',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function observation(request: AiStructuredRequest): {
  text: string;
  elements: Array<{ elementId: string; label: string }>;
} {
  const body = JSON.parse(request.userPrompt) as {
    observation?: {
      visibleStateSummary?: string;
      interactableElements?: Array<{ elementId: string; label: string }>;
    };
  };
  return {
    text: body.observation?.visibleStateSummary ?? '',
    elements: body.observation?.interactableElements ?? [],
  };
}

function result(caseId: string, runId: string): EvalCaseResult {
  return {
    runId,
    caseId,
    verdict: 'inconclusive',
    failureSource: null,
    severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['final.png'] },
    semantic: {
      verdict: 'inconclusive',
      taskCompletion: 'unknown',
      summary: 'The user goal is not proven.',
      whatWorked: [],
      whatFailed: [],
      whyItMatters: [],
      confirmedFacts: ['A safe recovery control remains visible'],
      hypotheses: [],
      unknowns: ['Whether the actor would recover if it continued'],
      evidenceRefs: ['final.png'],
      confidence: 0.7,
    },
    evidencePacketPath: 'evidence-packet.json',
    createdAt: now,
  };
}

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('dead-end browser recovery boundary', () => {
  it('does not call an actor-selected abandonment a dead end while a safe recovery control remains', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html><html><body><main id="app">
        <h1>Home</h1>
        <button id="open" onclick="document.getElementById('app').innerHTML='<h1>Confusing page</h1><p>The user is unsure.</p><button id=&quot;recover&quot;>Back to start</button>'">Open area</button>
      </main></body></html>`);

      const provider = new MockAiProvider((request) => {
        if (request.task !== 'actor') throw new Error(`Unexpected provider task: ${request.task}`);
        const state = observation(request);
        if (state.text.includes('Confusing page')) {
          expect(state.elements.some((item) => item.label === 'Back to start')).toBe(true);
          return { intentSummary: 'I choose to stop even though recovery is visible', action: 'abandon', targetElementId: null, value: null, expectedResult: 'Stop', confidence: 0.7 };
        }
        const open = state.elements.find((item) => item.label === 'Open area');
        return { intentSummary: 'Open the area', action: 'click', targetElementId: open?.elementId ?? null, value: null, expectedResult: 'See the next page', confidence: 0.8 };
      });

      const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-dead-end-boundary-'));
      const item = evalCase();
      const agentRun = await runAiTestAgent(page, item, provider, {
        outputDir,
        startingUrl: page.url(),
        maxSteps: 3,
        waitPolicy: { initialObservationMs: 10, pollIntervalMs: 20, softTimeoutMs: 60, hardTimeoutMs: 120, progressExtensionMs: 30, maxProgressExtensions: 1 },
        now: () => new Date(now),
      });
      const packet = JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')) as EvidencePacket;
      const analysis = analyzeBlindExperience({
        evalCase: item,
        result: result(item.caseId, agentRun.runId),
        packet,
        agentRun: { status: agentRun.status, decisions: agentRun.decisions },
      });

      expect(analysis.findings.some((finding) => finding.type === 'abandonment_risk')).toBe(true);
      expect(analysis.findings.some((finding) => finding.type === 'journey_breakpoint')).toBe(false);
      expect(analysis.actions.at(-1)?.outcome).not.toBe('dead_end_abandon');
    } finally {
      await browser.close();
    }
  }, 60_000);
});