import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, AiTestAgentRun, EvalCase, EvalCaseResult, EvidencePacket, UxIssueType } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { analyzeBlindExperience } from '../src/ux-evaluation/blind-experience-analyzer.js';

const now = '2026-08-16T01:00:00.000Z';
const calibratedTypes = new Set<UxIssueType>([
  'repeated_input_issue',
  'interaction_feedback_issue',
  'path_efficiency_issue',
  'journey_breakpoint',
  'abandonment_risk',
]);

interface BrowserCalibrationFixture {
  fixtureId: string;
  html: string;
  expectedTypes: UxIssueType[];
  expectedVerdict: EvalCaseResult['verdict'];
  actor: (request: AiStructuredRequest, actorCall: number) => Record<string, unknown>;
}

function evalCase(fixtureId: string): EvalCase {
  return {
    caseId: `case-${fixtureId}`,
    projectId: 'browser-calibration',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'browser experience calibration' },
    capabilityId: `cap-${fixtureId}`,
    taskId: `task-${fixtureId}`,
    title: fixtureId,
    hypothesis: '受控浏览器 fixture 应产生预先定义的体验摩擦。',
    persona: {
      personaId: 'persona-browser-calibration',
      name: 'Browser calibration actor',
      knowledgeLevel: 'low',
      patienceTurns: 6,
      retryTolerance: 2,
      privacySensitivity: 'medium',
      behaviorPolicy: ['只依据当前可见界面行动'],
      exitConditions: ['没有安全下一步时退出'],
    },
    goal: 'Reach the Done state',
    knownInformation: {},
    preconditions: ['Fixture is open'],
    oracle: {
      expectedOutcome: ['Done'],
      mustObserve: ['Done'],
      mustNotObserve: ['Fatal error'],
      businessRules: [],
      semanticRubric: ['Goal completion is visible'],
      deterministicAssertions: [{ assertionId: 'done-visible', type: 'text_visible', target: 'Done', expected: true, negated: false }],
      inconclusiveWhen: ['No evidence'],
    },
    coverageDimensions: [{ dimension: 'capability', value: `cap-${fixtureId}` }],
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

function judgeResult(caseId: string, runId: string, verdict: EvalCaseResult['verdict']): EvalCaseResult {
  const pass = verdict === 'pass';
  return {
    runId,
    caseId,
    verdict,
    failureSource: null,
    severity: null,
    deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['final.png'] },
    semantic: {
      verdict,
      taskCompletion: pass ? 'complete' : 'unknown',
      summary: pass ? 'Done is visible.' : 'The goal is not proven.',
      whatWorked: [],
      whatFailed: [],
      whyItMatters: [],
      confirmedFacts: pass ? ['Done is visible'] : ['Goal completion is not proven'],
      hypotheses: [],
      unknowns: pass ? [] : ['Whether the user can recover'],
      evidenceRefs: ['final.png'],
      confidence: pass ? 1 : 0.5,
    },
    evidencePacketPath: 'evidence-packet.json',
    createdAt: now,
  };
}

function observation(request: AiStructuredRequest): {
  text: string;
  elements: Array<{ elementId: string; label: string }>;
  fields: Array<{ elementId: string; currentValuePresent: boolean }>;
} {
  const body = JSON.parse(request.userPrompt) as {
    observation?: {
      visibleStateSummary?: string;
      interactableElements?: Array<{ elementId: string; label: string }>;
      formFields?: Array<{ elementId: string; currentValuePresent: boolean }>;
    };
  };
  return {
    text: body.observation?.visibleStateSummary ?? '',
    elements: body.observation?.interactableElements ?? [],
    fields: body.observation?.formFields ?? [],
  };
}

function buttonId(request: AiStructuredRequest, label: string): string | null {
  return observation(request).elements.find((item) => item.label === label)?.elementId ?? null;
}

const fixtures: BrowserCalibrationFixture[] = [
  {
    fixtureId: 'clean-success',
    html: '<main><h1>Start</h1><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Done</h1><p>Saved.</p>\'">Continue</button></main>',
    expectedTypes: [],
    expectedVerdict: 'pass',
    actor: (request) => observation(request).text.includes('Done')
      ? { intentSummary: 'Goal is complete', action: 'finish', targetElementId: null, value: null, expectedResult: 'Done', confidence: 1 }
      : { intentSummary: 'Continue', action: 'click', targetElementId: buttonId(request, 'Continue'), value: null, expectedResult: 'Done', confidence: 1 },
  },
  {
    fixtureId: 'no-feedback-recovery',
    html: '<main><h1>Start</h1><button onclick="window.__n=(window.__n||0)+1;if(window.__n>1)document.querySelector(\'main\').innerHTML=\'<h1>Done</h1><p>Saved.</p>\'">Continue</button></main>',
    expectedTypes: ['interaction_feedback_issue'],
    expectedVerdict: 'pass',
    actor: (request) => observation(request).text.includes('Done')
      ? { intentSummary: 'Goal is complete', action: 'finish', targetElementId: null, value: null, expectedResult: 'Done', confidence: 1 }
      : { intentSummary: 'Try Continue', action: 'click', targetElementId: buttonId(request, 'Continue'), value: null, expectedResult: 'Visible progress', confidence: 0.8 },
  },
  {
    fixtureId: 'backtrack-recovery',
    html: `<main id="app"><h1>Home</h1><button id="settings">Settings</button><button id="create">Create</button></main><script>
      const app=document.getElementById('app');
      function home(){app.innerHTML='<h1>Home</h1><button id="settings">Settings</button><button id="create">Create</button>';bind();}
      function bind(){document.getElementById('settings')?.addEventListener('click',()=>{location.hash='settings';app.innerHTML='<h1>Settings</h1><p>Profile preferences</p>'});document.getElementById('create')?.addEventListener('click',()=>{app.innerHTML='<h1>Done</h1><p>Created.</p>'});}
      addEventListener('hashchange',()=>{if(!location.hash)home()});bind();
    </script>`,
    expectedTypes: ['path_efficiency_issue'],
    expectedVerdict: 'pass',
    actor: (request, actorCall) => {
      const state = observation(request);
      if (state.text.includes('Done')) return { intentSummary: 'Goal is complete', action: 'finish', targetElementId: null, value: null, expectedResult: 'Done', confidence: 1 };
      if (state.text.includes('Settings')) return { intentSummary: 'Wrong area, go back', action: 'back', targetElementId: null, value: null, expectedResult: 'Home', confidence: 0.9 };
      return actorCall === 1
        ? { intentSummary: 'Settings might contain setup', action: 'click', targetElementId: buttonId(request, 'Settings'), value: null, expectedResult: 'Settings', confidence: 0.6 }
        : { intentSummary: 'Use Create', action: 'click', targetElementId: buttonId(request, 'Create'), value: null, expectedResult: 'Done', confidence: 0.9 };
    },
  },
  {
    fixtureId: 'repeated-input',
    html: '<main><h1>Form</h1><label>Code <input name="code"></label><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Done</h1><p>Submitted.</p>\'">Submit</button></main>',
    expectedTypes: ['repeated_input_issue'],
    expectedVerdict: 'pass',
    actor: (request, actorCall) => {
      const state = observation(request);
      if (state.text.includes('Done')) return { intentSummary: 'Goal is complete', action: 'finish', targetElementId: null, value: null, expectedResult: 'Done', confidence: 1 };
      if (actorCall <= 2) return { intentSummary: actorCall === 1 ? 'Enter code' : 'Re-enter code to make sure it is accepted', action: 'fill', targetElementId: state.fields[0]?.elementId ?? null, value: '42', expectedResult: 'Code is present', confidence: 0.8 };
      return { intentSummary: 'Submit', action: 'click', targetElementId: buttonId(request, 'Submit'), value: null, expectedResult: 'Done', confidence: 0.9 };
    },
  },
  {
    fixtureId: 'hesitation-then-success',
    html: '<main><h1>Start</h1><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Done</h1><p>Finished.</p>\'">Continue</button></main>',
    expectedTypes: ['path_efficiency_issue'],
    expectedVerdict: 'pass',
    actor: (request, actorCall) => observation(request).text.includes('Done')
      ? { intentSummary: 'Goal is complete', action: 'finish', targetElementId: null, value: null, expectedResult: 'Done', confidence: 1 }
      : actorCall === 1
        ? { intentSummary: 'Not sure which action is correct', action: 'wait', targetElementId: null, value: null, expectedResult: 'More clarity', confidence: 0.4 }
        : { intentSummary: 'Continue looks safest', action: 'click', targetElementId: buttonId(request, 'Continue'), value: null, expectedResult: 'Done', confidence: 0.8 },
  },
  {
    fixtureId: 'dead-end-abandonment',
    html: '<main><h1>Home</h1><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Archive</h1><p>No actions available.</p>\'">Archive</button></main>',
    expectedTypes: ['journey_breakpoint', 'abandonment_risk'],
    expectedVerdict: 'inconclusive',
    actor: (request) => observation(request).text.includes('Archive No actions available') || observation(request).text.includes('No actions available')
      ? { intentSummary: 'There is no safe next action', action: 'abandon', targetElementId: null, value: null, expectedResult: 'Stop', confidence: 0.9 }
      : { intentSummary: 'Archive might contain the target', action: 'click', targetElementId: buttonId(request, 'Archive'), value: null, expectedResult: 'Relevant controls', confidence: 0.5 },
  },
];

async function runFixture(page: Page, fixture: BrowserCalibrationFixture) {
  await page.setContent(`<!doctype html><html><head><title>${fixture.fixtureId}</title></head><body>${fixture.html}</body></html>`);
  let actorCall = 0;
  const provider = new MockAiProvider((request) => {
    if (request.task !== 'actor') throw new Error(`Unexpected calibration provider task: ${request.task}`);
    actorCall += 1;
    return fixture.actor(request, actorCall);
  });
  const outputDir = await mkdtemp(join(tmpdir(), `evalpilot-experience-browser-${fixture.fixtureId}-`));
  const item = evalCase(fixture.fixtureId);
  const agentRun = await runAiTestAgent(page, item, provider, {
    outputDir,
    startingUrl: page.url(),
    maxSteps: 7,
    waitPolicy: { initialObservationMs: 10, pollIntervalMs: 20, softTimeoutMs: 60, hardTimeoutMs: 120, progressExtensionMs: 30, maxProgressExtensions: 1 },
    now: () => new Date(now),
  });
  const packet = JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')) as EvidencePacket;
  const result = judgeResult(item.caseId, agentRun.runId, fixture.expectedVerdict);
  const analysis = analyzeBlindExperience({
    evalCase: item,
    result,
    packet,
    agentRun: agentRun as Pick<AiTestAgentRun, 'status' | 'decisions'>,
  });
  return { agentRun, analysis };
}

function calibrationMetrics(rows: Array<{ expected: UxIssueType[]; predicted: UxIssueType[] }>) {
  let tp = 0; let fp = 0; let fn = 0;
  let clean = 0; let cleanWithFinding = 0;
  for (const row of rows) {
    const expected = new Set(row.expected.filter((type) => calibratedTypes.has(type)));
    const predicted = new Set(row.predicted.filter((type) => calibratedTypes.has(type)));
    if (expected.size === 0) { clean += 1; if (predicted.size > 0) cleanWithFinding += 1; }
    for (const type of predicted) expected.has(type) ? tp += 1 : fp += 1;
    for (const type of expected) if (!predicted.has(type)) fn += 1;
  }
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    cleanFalsePositiveRate: clean === 0 ? 0 : cleanWithFinding / clean,
    tp, fp, fn,
  };
}

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('browser-level experience detector calibration', () => {
  it('measures Observer → Actor → evidence reconstruction → friction detection without hiding known false negatives', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const rows: Array<{ fixtureId: string; expected: UxIssueType[]; predicted: UxIssueType[] }> = [];
    try {
      for (const fixture of fixtures) {
        const { analysis } = await runFixture(page, fixture);
        rows.push({ fixtureId: fixture.fixtureId, expected: fixture.expectedTypes, predicted: [...new Set(analysis.frictions.map((item) => item.type))] });
      }
    } finally {
      await browser.close();
    }

    const byId = new Map(rows.map((row) => [row.fixtureId, row]));
    expect(byId.get('clean-success')?.predicted).toEqual([]);
    expect(byId.get('no-feedback-recovery')?.predicted).toContain('interaction_feedback_issue');
    expect(byId.get('backtrack-recovery')?.predicted).toContain('path_efficiency_issue');
    expect(byId.get('repeated-input')?.predicted).toContain('repeated_input_issue');
    expect(byId.get('hesitation-then-success')?.predicted).toContain('path_efficiency_issue');
    expect(byId.get('dead-end-abandonment')?.predicted).toContain('abandonment_risk');

    // Known calibration gap: browser evidence reconstruction does not currently preserve an
    // explicit `dead_end` outcome, so the detector cannot emit journey_breakpoint here even
    // though the controlled page has no available recovery action. Keep this as a measured
    // false negative instead of relabeling the fixture to make the benchmark look perfect.
    expect(byId.get('dead-end-abandonment')?.expected).toContain('journey_breakpoint');
    expect(byId.get('dead-end-abandonment')?.predicted).not.toContain('journey_breakpoint');

    const metrics = calibrationMetrics(rows);
    expect(metrics.precision).toBe(1);
    expect(metrics.cleanFalsePositiveRate).toBe(0);
    expect(metrics.fn).toBeGreaterThanOrEqual(1);
    expect(metrics.recall).toBeLessThan(1);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
});
