import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { ZodType } from 'zod';
import type { AiStructuredRequest } from '../types.js';
import { AiProviderError, type AiProvider } from '../src/ai/provider.js';
import { aiConnectionStatus } from '../src/ai/provider-connection.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import { evidencePacketSchema } from '../src/test-agent/schemas.js';
import { runBlindExperienceCase } from '../src/ux-evaluation/blind-experience-service.js';
import { collectObservedPreFailureSignals } from '../src/ux-evaluation/pre-failure-signals.js';
import {
  AQUAGUIDE_DAILY_RETEST_ANALYSIS_MODE,
  AQUAGUIDE_DAILY_RETEST_CASE_ID,
  AQUAGUIDE_DAILY_RETEST_DEFAULT_TARGET,
  AQUAGUIDE_DAILY_RETEST_ORACLE_MARKER,
  AQUAGUIDE_DAILY_RETEST_SETUP_MODE,
  buildAquaGuideDailyRetestCase,
  buildAquaGuideDailyRetestState,
} from '../src/validation/aquaguide-daily-retest-contract.js';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

function boundedInteger(name: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

interface ProviderAudit {
  schemaName: string;
  caseId: string;
  markerPresent: boolean;
  status: 'ok' | 'provider_failure' | 'error';
  errorCode: string | null;
  errorMessage: string | null;
}

class AuditedProvider implements AiProvider {
  readonly info;

  constructor(
    private readonly delegate: AiProvider,
    private readonly audits: ProviderAudit[],
  ) {
    this.info = delegate.info;
  }

  async generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T> {
    const combinedPrompt = `${request.systemPrompt}\n${request.userPrompt}`;
    const audit: ProviderAudit = {
      schemaName: request.schemaName,
      caseId: String(request.metadata.caseId ?? AQUAGUIDE_DAILY_RETEST_CASE_ID),
      markerPresent: combinedPrompt.includes(AQUAGUIDE_DAILY_RETEST_ORACLE_MARKER),
      status: 'ok',
      errorCode: null,
      errorMessage: null,
    };
    this.audits.push(audit);
    try {
      return await this.delegate.generateStructured(request, schema);
    } catch (error) {
      audit.status = error instanceof AiProviderError ? 'provider_failure' : 'error';
      audit.errorCode = error instanceof AiProviderError ? error.code : null;
      audit.errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}

const targetUrl = arg('--url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const outputDir = resolve(arg('--output', 'connected-aquaguide-daily-retest-output'));
const maxAgentSteps = boundedInteger('--max-steps', arg('--max-steps', '12'), 1, 20);
const pinnedCommit = (process.env.TARGET_APP_COMMIT ?? AQUAGUIDE_DAILY_RETEST_DEFAULT_TARGET).trim();
if (!/^[0-9a-f]{40}$/.test(pinnedCommit)) {
  throw new Error('TARGET_APP_COMMIT must be an exact 40-character lowercase Git SHA.');
}

const benchmarkBrowserLocale = 'en-US';
const benchmarkAppLocale = 'en';
const jsonOutput = process.argv.includes('--json');
const evalCase = buildAquaGuideDailyRetestCase();

function executionConfig() {
  return {
    maxAgentSteps,
    allowScreenshotToProvider: false,
    benchmarkLocale: benchmarkBrowserLocale,
    applicationLocale: benchmarkAppLocale,
    journeyMode: 'daily_only',
    setupMode: AQUAGUIDE_DAILY_RETEST_SETUP_MODE,
    prerequisiteRemoteCalls: 0,
  };
}

async function validateLocalSetup(): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  const pageErrors: string[] = [];
  try {
    const context = await browser.newContext({ locale: benchmarkBrowserLocale });
    const setupState = buildAquaGuideDailyRetestState();
    await context.addInitScript(({ state, locale }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem('aquarium_app_state_v1', JSON.stringify(state));
      window.localStorage.setItem('aquaguide_locale', locale);
    }, { state: setupState, locale: benchmarkAppLocale });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${targetUrl}/aquarium`, { waitUntil: 'domcontentloaded' });
    const dailyTask = page.locator('[data-daily-action="daily_check"]');
    await dailyTask.waitFor({ state: 'visible', timeout: 10_000 });
    const persisted = await page.evaluate(() => {
      const raw = window.localStorage.getItem('aquarium_app_state_v1');
      return raw ? JSON.parse(raw) as Record<string, unknown> : null;
    });
    const diagnosisRecords = Array.isArray(persisted?.diagnosisRecords) ? persisted.diagnosisRecords : null;
    const ready = Boolean(persisted)
      && persisted?.currentAquariumId === 'tank-connected-daily-retest'
      && diagnosisRecords?.length === 0
      && pageErrors.length === 0;
    await context.close();
    return {
      ready,
      dailyTaskVisible: true,
      currentAquariumId: persisted?.currentAquariumId ?? null,
      diagnosisRecordCount: diagnosisRecords?.length ?? null,
      pageErrors,
      remoteCallsMade: false,
    };
  } catch (error) {
    return {
      ready: false,
      dailyTaskVisible: false,
      currentAquariumId: null,
      diagnosisRecordCount: null,
      pageErrors,
      remoteCallsMade: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close();
  }
}

if (process.argv.includes('--preflight')) {
  const connection = aiConnectionStatus();
  const setupValidation = await validateLocalSetup();
  const canRun = connection.configured && connection.provider === 'deepseek' && setupValidation.ready === true;
  const preflight = {
    schemaVersion: 1,
    analysisMode: `${AQUAGUIDE_DAILY_RETEST_ANALYSIS_MODE}_preflight`,
    status: canRun ? 'ready' : 'blocked',
    canRun,
    remoteCallsMade: false,
    provider: connection,
    targetAppGitSha: pinnedCommit,
    targetUrl,
    caseIds: [evalCase.caseId],
    executionConfig: executionConfig(),
    setupValidation,
    oracleAssertionIds: evalCase.oracle.deterministicAssertions.map((item) => item.assertionId),
    claimBoundary: [
      'Preflight validates the pinned product setup in a real browser and makes zero remote provider calls.',
      'Only blind-daily-check-risk is eligible for remote execution; Create Aquarium and Record Livestock are replaced by deterministic local setup.',
      'The local setup shape is derived from AquaGuide GP-003 returning-user Daily Check fixture and creates no diagnosis record before the Actor starts.',
      'This is a same EvalCase retest for PUI-BC-023 plus end-to-end confirmation of the PUI-BC-024 output fix; it is not a model reliability estimate or human usability study.',
      'Screenshots are not sent to the provider.',
    ],
  };
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
  process.exitCode = canRun ? 0 : 2;
} else {
  await mkdir(outputDir, { recursive: true });
  const baseProvider = configuredEvaluationProvider();
  if (baseProvider.info.providerId !== 'deepseek') {
    throw new Error(`Connected AquaGuide Daily retest requires DeepSeek; received ${baseProvider.info.providerId}.`);
  }

  const providerAudits: ProviderAudit[] = [];
  const provider = new AuditedProvider(baseProvider, providerAudits);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: benchmarkBrowserLocale });
  const setupState = buildAquaGuideDailyRetestState();

  await context.addInitScript(({ state, locale }) => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem('aquarium_app_state_v1', JSON.stringify(state));
      window.localStorage.setItem('aquaguide_locale', locale);
    } catch {
      // Browser evidence will expose a setup failure if storage is unavailable.
    }
  }, { state: setupState, locale: benchmarkAppLocale });

  const page = await context.newPage();
  let taskResult: Record<string, unknown>;

  try {
    const auditStart = providerAudits.length;
    process.stderr.write(`[connected-aquaguide-daily] START ${evalCase.caseId}\n`);
    try {
      const outcome = await runBlindExperienceCase({
        page,
        provider,
        outputDir,
        evalCase,
        startingUrl: `${targetUrl}/aquarium`,
        evalSetVersion: 1,
        productModelVersion: 1,
        targetAppGitSha: pinnedCommit,
        allowRemoteModel: true,
        allowScreenshotToProvider: false,
        maxAgentSteps,
        agentWaitTimeoutMs: 20_000,
      });

      const caseAudits = providerAudits.slice(auditStart);
      const providerFailed = caseAudits.some((item) => item.status === 'provider_failure');
      const runtimeFailureSource = providerFailed
        ? 'provider'
        : outcome.runtimeFailureSource ?? (outcome.result.failureSource === 'evaluator' ? 'evaluator' : null);
      const evidencePacket = evidencePacketSchema.parse(JSON.parse(await readFile(outcome.agentRun.evidencePacketPath, 'utf8')));
      const observedPreFailureSignals = collectObservedPreFailureSignals({
        agentRun: outcome.agentRun,
        evidencePacket,
      });
      const passed = outcome.result.verdict === 'pass'
        && outcome.result.failureSource === null
        && outcome.agentRun.status === 'completed'
        && runtimeFailureSource === null;

      taskResult = {
        caseId: evalCase.caseId,
        goal: evalCase.goal,
        executionStatus: 'executed',
        runtimeFailureSource,
        observedPreFailureSignals,
        runId: outcome.agentRun.runId,
        agentStatus: outcome.agentRun.status,
        agentFailureSource: outcome.agentRun.failureSource,
        verdict: outcome.result.verdict,
        failureSource: outcome.result.failureSource,
        analysisMode: outcome.experience.analysisMode,
        analysisStatus: outcome.experience.analysisStatus,
        actionSequence: outcome.agentRun.decisions.map((decision) => decision.action),
        actionCount: outcome.experience.actions.length,
        frictionTypes: outcome.experience.frictions.map((item) => item.type),
        findingTypes: outcome.experience.findings.map((item) => item.type),
        deterministicChecks: outcome.result.deterministic.checks.map((item) => ({
          assertionId: item.assertionId,
          verdict: item.verdict,
          summary: item.summary,
          evidenceRefs: item.evidenceRefs,
        })),
        semanticVerdict: outcome.result.semantic.verdict,
        semanticTaskCompletion: outcome.result.semantic.taskCompletion,
        semanticSummary: outcome.result.semantic.summary,
        productJourneyPassed: passed,
        experiencePath: outcome.experiencePath,
        evidencePacketPath: outcome.agentRun.evidencePacketPath,
        error: outcome.agentRun.error,
      };
      process.stderr.write(`[connected-aquaguide-daily] END ${evalCase.caseId}: verdict=${outcome.result.verdict}; resultSource=${outcome.result.failureSource ?? 'none'}; runtimeSource=${runtimeFailureSource ?? 'none'}; agent=${outcome.agentRun.status}.\n`);
    } catch (error) {
      const caseAudits = providerAudits.slice(auditStart);
      const providerFailure = error instanceof AiProviderError || caseAudits.some((item) => item.status === 'provider_failure');
      taskResult = {
        caseId: evalCase.caseId,
        goal: evalCase.goal,
        executionStatus: 'executed',
        runtimeFailureSource: providerFailure ? 'provider' : 'evaluator',
        observedPreFailureSignals: [],
        runId: null,
        agentStatus: 'inconclusive',
        agentFailureSource: providerFailure ? null : 'evaluator',
        verdict: 'inconclusive',
        failureSource: 'evaluator',
        analysisMode: null,
        analysisStatus: 'missing',
        actionSequence: [],
        actionCount: 0,
        frictionTypes: [],
        findingTypes: [],
        deterministicChecks: [],
        semanticVerdict: 'inconclusive',
        semanticTaskCompletion: 'unknown',
        semanticSummary: null,
        productJourneyPassed: false,
        experiencePath: null,
        evidencePacketPath: null,
        error: error instanceof Error ? error.message : String(error),
      };
      process.stderr.write(`[connected-aquaguide-daily] END ${evalCase.caseId}: runtimeSource=${String(taskResult.runtimeFailureSource)}; uncaught=${String(taskResult.error)}\n`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const actorRequests = providerAudits.filter((item) => item.schemaName === 'agent_decision');
  const judgeRequests = providerAudits.filter((item) => item.schemaName === 'semantic_judge_result');
  const actorOracleLeakCount = actorRequests.filter((item) => item.markerPresent).length;
  const judgeOracleVisible = judgeRequests.length > 0 && judgeRequests.every((item) => item.markerPresent);
  const validBlindStatuses = new Set(['evaluated', 'suppressed_functional_failure', 'insufficient_evidence']);
  const allBlind = taskResult.analysisMode === 'blind_experience_run'
    && validBlindStatuses.has(String(taskResult.analysisStatus));
  const providerFailureCount = taskResult.runtimeFailureSource === 'provider' ? 1 : 0;
  const evaluatorFailureCount = taskResult.runtimeFailureSource === 'evaluator' ? 1 : 0;
  const unknownFailureCount = taskResult.failureSource === 'unknown' ? 1 : 0;
  const protocolHealthy = allBlind
    && actorOracleLeakCount === 0
    && judgeOracleVisible
    && providerFailureCount === 0
    && evaluatorFailureCount === 0
    && unknownFailureCount === 0;
  const productJourneyPassed = taskResult.productJourneyPassed === true;

  const diagnostic = {
    schemaVersion: 1,
    analysisMode: AQUAGUIDE_DAILY_RETEST_ANALYSIS_MODE,
    generatedAt: new Date().toISOString(),
    targetAppGitSha: pinnedCommit,
    targetUrl,
    provider: provider.info,
    executionConfig: executionConfig(),
    caseIds: [evalCase.caseId],
    setupRecord: {
      mode: AQUAGUIDE_DAILY_RETEST_SETUP_MODE,
      diagnosisRecordsBeforeActor: 0,
      remoteCalls: 0,
    },
    protocolHealthy,
    allBlind,
    actorOracleLeakCount,
    judgeOracleVisible,
    providerFailureCount,
    evaluatorFailureCount,
    unknownFailureCount,
    productJourneyPassed,
    requestCounts: {
      total: providerAudits.length,
      actor: actorRequests.length,
      judge: judgeRequests.length,
      providerFailures: providerAudits.filter((item) => item.status === 'provider_failure').length,
    },
    taskResult,
    claimBoundary: [
      'This retest executes only blind-daily-check-risk against one pinned AquaGuide commit.',
      'Create Aquarium and Record Livestock use deterministic local setup and make zero remote model calls.',
      'A PASS requires a healthy Blind Experience protocol, deterministic Oracle PASS, semantic Judge PASS, completed Agent run, and failureSource=null.',
      'PUI-BC-023 is eligible for lifecycle closure only after this same EvalCase produces that complete connected PASS.',
      'PUI-BC-024 is already deterministic product-regression verified; this connected retest adds end-to-end evidence but is not required to establish the code fix.',
      'Provider timeout, evaluator interruption, missing Judge Oracle visibility, or unknown attribution makes this run non-PASS and must not be promoted to Product Failure by absence of success evidence alone.',
      'No screenshot was sent to the provider.',
    ],
  };

  const diagnosticPath = resolve(outputDir, 'connected-aquaguide-daily-retest.json');
  const auditPath = resolve(outputDir, 'knowledge-boundary-audit.json');
  await writeFile(diagnosticPath, JSON.stringify(diagnostic, null, 2));
  await writeFile(auditPath, JSON.stringify({ provider: provider.info, requests: providerAudits }, null, 2));

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ diagnosticPath, auditPath, ...diagnostic }, null, 2)}\n`);
  } else {
    process.stdout.write(`Connected AquaGuide Daily Retest: protocol=${protocolHealthy ? 'HEALTHY' : 'UNHEALTHY'}; product=${productJourneyPassed ? 'PASS' : 'NOT_PASS'}; runtimeSource=${String(taskResult.runtimeFailureSource ?? 'none')}\n`);
    process.stdout.write(`- Actor Oracle leaks: ${actorOracleLeakCount}; Judge Oracle visible: ${judgeOracleVisible}; provider failures: ${providerFailureCount}; evaluator failures: ${evaluatorFailureCount}; unknown failures: ${unknownFailureCount}\n`);
    process.stdout.write(`- Diagnostic: ${diagnosticPath}\n`);
  }
}
