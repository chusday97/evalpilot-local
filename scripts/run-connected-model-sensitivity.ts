import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { EvalCase, UxIssueType } from '../types.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import { runBlindExperienceCase } from '../src/ux-evaluation/blind-experience-service.js';
import { summarizeModelSensitivity, type ModelSensitivityObservation } from '../src/ux-evaluation/model-sensitivity.js';

interface ProbeFixture {
  fixtureId: string;
  path: string;
  goal: string;
  expectedSignals: UxIssueType[];
  html: string;
}

const now = () => new Date();

const fixtures: ProbeFixture[] = [
  {
    fixtureId: 'clean-one-click',
    path: '/clean',
    goal: 'Reach the Done state.',
    expectedSignals: [],
    html: `<!doctype html><html><body><main><h1>Start</h1><button onclick="document.querySelector('main').innerHTML='<h1>Done</h1><p>Saved.</p>'">Continue</button></main></body></html>`,
  },
  {
    fixtureId: 'no-feedback-recovery',
    path: '/no-feedback',
    goal: 'Reach the Done state.',
    expectedSignals: ['interaction_feedback_issue'],
    html: `<!doctype html><html><body><main><h1>Start</h1><button onclick="window.__n=(window.__n||0)+1;if(window.__n>1)document.querySelector('main').innerHTML='<h1>Done</h1><p>Saved.</p>'">Continue</button></main></body></html>`,
  },
  {
    fixtureId: 'objective-dead-end',
    path: '/dead-end',
    goal: 'Reach the Done state.',
    expectedSignals: ['journey_breakpoint', 'abandonment_risk'],
    html: `<!doctype html><html><body><main><h1>Home</h1><button onclick="document.querySelector('main').innerHTML='<h1>Archive</h1><p>No actions available.</p>'">Archive</button></main></body></html>`,
  },
];

function evalCase(fixture: ProbeFixture): EvalCase {
  const createdAt = new Date().toISOString();
  return {
    caseId: `connected-${fixture.fixtureId}`,
    projectId: 'connected-model-sensitivity',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'connected-model sensitivity probe' },
    capabilityId: `cap-${fixture.fixtureId}`,
    taskId: `task-${fixture.fixtureId}`,
    title: fixture.fixtureId,
    hypothesis: 'Connected model behavior should preserve calibrated browser signals without inventing product UX defects.',
    persona: {
      personaId: 'persona-connected-model-probe',
      name: 'First-time user',
      knowledgeLevel: 'low',
      patienceTurns: 5,
      retryTolerance: 2,
      privacySensitivity: 'medium',
      behaviorPolicy: ['只依据当前可见界面行动', '不猜测隐藏成功条件'],
      exitConditions: ['没有安全下一步时退出'],
    },
    goal: fixture.goal,
    knownInformation: {},
    preconditions: ['Fixture is open'],
    oracle: {
      expectedOutcome: ['Done is visible'],
      mustObserve: ['Done'],
      mustNotObserve: ['Fatal error'],
      businessRules: [],
      semanticRubric: ['The user goal is complete only when Done is visibly reached.'],
      deterministicAssertions: [{ assertionId: 'done-visible', type: 'text_visible', target: 'Done', expected: true, negated: false }],
      inconclusiveWhen: ['The visible evidence does not prove completion or a product failure.'],
    },
    coverageDimensions: [{ dimension: 'capability', value: fixture.fixtureId }],
    riskLevel: 'P2',
    generationReason: 'Connected-model sensitivity probe',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt,
    updatedAt: createdAt,
  };
}

async function main() {
  const provider = configuredEvaluationProvider();
  const server = createServer((request, response) => {
    const fixture = fixtures.find((item) => item.path === request.url);
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(fixture.html);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Sensitivity fixture server did not expose a TCP port.');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const observations: ModelSensitivityObservation[] = [];

  try {
    for (const fixture of fixtures) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const outputDir = await mkdtemp(join(tmpdir(), `evalpilot-connected-${fixture.fixtureId}-`));
        try {
          const outcome = await runBlindExperienceCase({
            page,
            provider,
            outputDir,
            evalCase: evalCase(fixture),
            startingUrl: `${baseUrl}${fixture.path}`,
            evalSetVersion: 1,
            allowRemoteModel: true,
            allowScreenshotToProvider: false,
            maxAgentSteps: 7,
            agentWaitTimeoutMs: 400,
            now,
          });
          observations.push({
            fixtureId: fixture.fixtureId,
            expectedSignals: fixture.expectedSignals,
            predictedSignals: [...new Set(outcome.experience.frictions.map((friction) => friction.type))],
            actorActions: outcome.agentRun.decisions.map((decision) => decision.action),
            runStatus: outcome.agentRun.status,
            verdict: outcome.result.verdict,
            failureSource: outcome.result.failureSource,
            providerFailure: outcome.agentRun.failureSource === 'evaluator' ? outcome.agentRun.error ?? 'Evaluator/provider failure' : null,
          });
        } catch (error) {
          observations.push({
            fixtureId: fixture.fixtureId,
            expectedSignals: fixture.expectedSignals,
            predictedSignals: [],
            actorActions: [],
            runStatus: null,
            verdict: null,
            failureSource: 'evaluator',
            providerFailure: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const summary = summarizeModelSensitivity(observations);
  const report = {
    ...summary,
    generatedAt: new Date().toISOString(),
    provider: {
      providerId: provider.info.providerId,
      model: provider.info.model,
      remote: provider.info.remote,
    },
    claimBoundary: 'This measures connected-model runtime sensitivity on controlled Chromium fixtures. It is not a real-user UX accuracy score.',
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = process.env.EVALPILOT_MODEL_SENSITIVITY_OUTPUT?.trim();
  if (outputPath) await writeFile(outputPath, serialized, 'utf8');
  process.stdout.write(serialized);
  if (summary.providerFailureCount === summary.scenarioCount) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
