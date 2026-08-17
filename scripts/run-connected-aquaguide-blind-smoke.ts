import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { ZodType } from 'zod';
import type { AiStructuredRequest, EvalCase } from '../types.js';
import { AiProviderError, type AiProvider } from '../src/ai/provider.js';
import { aiConnectionStatus } from '../src/ai/provider-connection.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import { evidencePacketSchema } from '../src/test-agent/schemas.js';
import { runBlindExperienceCase } from '../src/ux-evaluation/blind-experience-service.js';
import { collectObservedPreFailureSignals } from '../src/ux-evaluation/pre-failure-signals.js';

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

const targetUrl = arg('--url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const outputDir = resolve(arg('--output', 'connected-aquaguide-blind-output'));
const maxAgentSteps = boundedInteger('--max-steps', arg('--max-steps', '12'), 1, 20);
const defaultPinnedCommit = '2add55a54402afc18b642b572d8ee8351ab72c53';
const pinnedCommit = (process.env.TARGET_APP_COMMIT ?? defaultPinnedCommit).trim();
if (!/^[0-9a-f]{40}$/.test(pinnedCommit)) {
  throw new Error('TARGET_APP_COMMIT must be an exact 40-character lowercase Git SHA.');
}
const oracleOnlyMarker = 'SECRET_ORACLE_ONLY_MARKER_DO_NOT_SEND_TO_ACTOR';
const benchmarkBrowserLocale = 'en-US';
const benchmarkAppLocale = 'en';
const jsonOutput = process.argv.includes('--json');

const persona: EvalCase['persona'] = {
  personaId: 'persona-blind-new-user',
  name: '首次使用 AquaGuide 的普通用户',
  knowledgeLevel: 'low',
  patienceTurns: 4,
  retryTolerance: 1,
  privacySensitivity: 'medium',
  behaviorPolicy: [
    '只依据当前可见界面、自己的目标和已知信息行动',
    '优先选择语义上最接近当前目标的安全入口',
    '不知道的信息保持未知，不为了完成任务自行补齐',
    '看不到可靠下一步时允许退出，不凭空猜测隐藏状态',
  ],
  exitConditions: ['连续尝试没有进展时退出', '需要危险或未知信息时退出'],
};

function makeCase(input: {
  caseId: string;
  capabilityId: string;
  taskId: string;
  title: string;
  goal: string;
  knownInformation: Record<string, unknown>;
  assertions: EvalCase['oracle']['deterministicAssertions'];
}): EvalCase {
  const now = '2026-08-15T00:00:00.000Z';
  return {
    caseId: input.caseId,
    projectId: 'aquaguide-blind-experience',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'Pinned AquaGuide blind experience contract' },
    capabilityId: input.capabilityId,
    taskId: input.taskId,
    title: input.title,
    hypothesis: `Blind user can complete: ${input.goal}`,
    persona,
    goal: input.goal,
    knownInformation: input.knownInformation,
    preconditions: [],
    oracle: {
      expectedOutcome: [`独立 Judge 验证：${input.goal}`, oracleOnlyMarker],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: [`用户是否真实完成：${input.goal}`, oracleOnlyMarker],
      deterministicAssertions: input.assertions,
      inconclusiveWhen: ['没有足够可见证据确认成功或产品失败'],
    },
    coverageDimensions: [{ dimension: 'capability', value: input.capabilityId }],
    riskLevel: 'P1',
    generationReason: 'Connected real-product Blind Experience smoke',
    version: 1,
    stats: {
      passCount: 0,
      failCount: 0,
      inconclusiveCount: 0,
      latestResult: null,
      latestRunId: null,
      uniqueCoverageContribution: 1,
      lastExecutedAt: null,
    },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

const cases: EvalCase[] = [
  makeCase({
    caseId: 'blind-create-usable-aquarium',
    capabilityId: 'cap-create-aquarium',
    taskId: 'task-create-usable-aquarium',
    title: '创建一个可用淡水鱼缸',
    goal: '创建一个 60×30×30cm 的淡水鱼缸并保存',
    knownInformation: { lengthCm: 60, widthCm: 30, heightCm: 30, waterType: 'freshwater' },
    assertions: [
      { assertionId: 'blind-create-size', type: 'text_visible', target: '60x30x30cm', expected: true, negated: false },
      { assertionId: 'blind-create-water', type: 'text_visible', target: 'Freshwater', expected: true, negated: false },
      { assertionId: 'blind-create-modal-closed', type: 'text_absent', target: 'Save Settings', expected: true, negated: false },
    ],
  }),
  makeCase({
    caseId: 'blind-record-existing-livestock',
    capabilityId: 'cap-record-livestock',
    taskId: 'task-record-existing-livestock',
    title: '记录已有生物',
    goal: '把一只 Corydoras aeneus 记录到当前鱼缸并保存',
    knownInformation: { scientificName: 'Corydoras aeneus', quantity: 1 },
    assertions: [
      { assertionId: 'blind-record-species', type: 'text_visible', target: 'Corydoras aeneus x 1', expected: true, negated: false },
      { assertionId: 'blind-record-persisted', type: 'text_visible', target: 'Recorded', expected: true, negated: false },
    ],
  }),
  makeCase({
    caseId: 'blind-daily-check-risk',
    capabilityId: 'cap-daily-check',
    taskId: 'task-daily-check-risk',
    title: '完成每日检查并查看风险结果',
    goal: '完成每日检查：鱼经常浮头，其余观察正常，并查看系统给出的风险和下一步动作',
    knownInformation: {
      respiration: '经常浮头',
      waterClarity: '清澈',
      surface: '没有泡沫或油膜',
      odor: '没有异味',
      behavior: '正常游动和进食',
      recentOperation: '没有特别操作',
    },
    assertions: [
      { assertionId: 'blind-daily-risk', type: 'text_visible', target: 'Act now', expected: true, negated: false },
      { assertionId: 'blind-daily-action', type: 'text_visible', target: 'Do this first', expected: true, negated: false },
      { assertionId: 'blind-daily-recorded-high-risk', type: 'text_visible', target: '已保存今天的检查记录。', expected: true, negated: false },
    ],
  }),
];

const prerequisiteByCaseId = new Map<string, string>([
  ['blind-record-existing-livestock', 'blind-create-usable-aquarium'],
  ['blind-daily-check-risk', 'blind-record-existing-livestock'],
]);

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
  private activeCaseId = 'unknown';

  constructor(
    private readonly delegate: AiProvider,
    private readonly audits: ProviderAudit[],
  ) {
    this.info = delegate.info;
  }

  setActiveCase(caseId: string): void {
    this.activeCaseId = caseId;
  }

  async generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T> {
    const combinedPrompt = `${request.systemPrompt}\n${request.userPrompt}`;
    const audit: ProviderAudit = {
      schemaName: request.schemaName,
      caseId: String(request.metadata.caseId ?? this.activeCaseId),
      markerPresent: combinedPrompt.includes(oracleOnlyMarker),
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

function executionConfig() {
  return {
    maxAgentSteps,
    allowScreenshotToProvider: false,
    sequentialSharedBrowserContext: true,
    prerequisiteCascadeGuard: true,
    preFailureSignalSidecar: true,
    benchmarkLocale: benchmarkBrowserLocale,
    applicationLocale: benchmarkAppLocale,
  };
}

if (process.argv.includes('--preflight')) {
  const connection = aiConnectionStatus();
  const canRun = connection.configured && connection.provider === 'deepseek';
  const preflight = {
    schemaVersion: 1,
    analysisMode: 'connected_aquaguide_blind_preflight',
    status: canRun ? 'ready' : 'blocked',
    canRun,
    remoteCallsMade: false,
    provider: connection,
    targetAppGitSha: pinnedCommit,
    targetUrl,
    caseIds: cases.map((item) => item.caseId),
    executionConfig: executionConfig(),
    claimBoundary: [
      'Preflight is local planning only and makes zero remote provider calls.',
      'This smoke uses the pinned AquaGuide commit and the existing three Blind Experience journeys.',
      'The benchmark browser locale is fixed to en-US and the AquaGuide application locale is fixed to en; deterministic Oracle targets use stable visible product-state markers from the pinned product contract rather than assuming generated diagnosis copy is English.',
      'A single connected run can expose protocol or behavior badcases but cannot estimate model variance.',
      'Dependent journeys are blocked when their upstream journey does not pass, preventing cascade misattribution.',
      'Recoverable action execution failures are preserved as sidecar evidence and do not change the terminal verdict by themselves.',
      'Screenshots are not sent to the provider.',
    ],
  };
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
  process.exitCode = canRun ? 0 : 2;
} else {
  await mkdir(outputDir, { recursive: true });
  const baseProvider = configuredEvaluationProvider();
  if (baseProvider.info.providerId !== 'deepseek') {
    throw new Error(`Connected AquaGuide smoke requires DeepSeek; received ${baseProvider.info.providerId}.`);
  }

  const providerAudits: ProviderAudit[] = [];
  const provider = new AuditedProvider(baseProvider, providerAudits);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: benchmarkBrowserLocale });
  await context.addInitScript((locale) => {
    try {
      window.localStorage.setItem('aquaguide_locale', locale);
    } catch {
      // Keep the benchmark runnable if storage is unavailable; browser locale still remains fixed.
    }
  }, benchmarkAppLocale);
  const page = await context.newPage();
  const taskResults: Array<Record<string, unknown>> = [];
  const passedCaseIds = new Set<string>();

  try {
    for (const evalCase of cases) {
      const prerequisiteCaseId = prerequisiteByCaseId.get(evalCase.caseId) ?? null;
      if (prerequisiteCaseId && !passedCaseIds.has(prerequisiteCaseId)) {
        process.stderr.write(`[connected-aquaguide] BLOCKED ${evalCase.caseId}: prerequisite ${prerequisiteCaseId} did not pass.\n`);
        taskResults.push({
          caseId: evalCase.caseId,
          goal: evalCase.goal,
          executionStatus: 'blocked_prerequisite',
          blockedByCaseId: prerequisiteCaseId,
          runtimeFailureSource: null,
          observedPreFailureSignals: [],
          runId: null,
          agentStatus: null,
          agentFailureSource: null,
          verdict: null,
          failureSource: null,
          analysisMode: null,
          analysisStatus: null,
          actionSequence: [],
          actionCount: 0,
          backtrackCount: 0,
          retryCount: 0,
          repeatedInputCount: 0,
          abandoned: false,
          frictionTypes: [],
          findingTypes: [],
          fillValues: [],
          experiencePath: null,
          error: `Prerequisite ${prerequisiteCaseId} did not pass; dependent journey was not executed.`,
        });
        continue;
      }

      const startingUrl = evalCase.caseId.includes('create') ? `${targetUrl}/welcome` : `${targetUrl}/aquarium`;
      provider.setActiveCase(evalCase.caseId);
      const auditStart = providerAudits.length;
      process.stderr.write(`[connected-aquaguide] START ${evalCase.caseId}\n`);

      try {
        const outcome = await runBlindExperienceCase({
          page,
          provider,
          outputDir,
          evalCase,
          startingUrl,
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
        const fills = outcome.agentRun.decisions
          .filter((decision) => decision.action === 'fill')
          .map((decision) => decision.value);
        const passed = outcome.result.verdict === 'pass'
          && outcome.result.failureSource === null
          && outcome.agentRun.status === 'completed'
          && runtimeFailureSource === null;
        if (passed) passedCaseIds.add(evalCase.caseId);

        taskResults.push({
          caseId: evalCase.caseId,
          goal: evalCase.goal,
          executionStatus: 'executed',
          blockedByCaseId: null,
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
          backtrackCount: outcome.experience.metrics.backtrackCount,
          retryCount: outcome.experience.metrics.retryCount,
          repeatedInputCount: outcome.experience.metrics.repeatedInputCount,
          abandoned: outcome.experience.metrics.abandoned,
          frictionTypes: outcome.experience.frictions.map((item) => item.type),
          findingTypes: outcome.experience.findings.map((item) => item.type),
          fillValues: fills,
          experiencePath: outcome.experiencePath,
          error: outcome.agentRun.error,
        });
        process.stderr.write(`[connected-aquaguide] END ${evalCase.caseId}: verdict=${outcome.result.verdict}; resultSource=${outcome.result.failureSource ?? 'none'}; runtimeSource=${runtimeFailureSource ?? 'none'}; preFailureSignals=${observedPreFailureSignals.length}; agent=${outcome.agentRun.status}.\n`);
      } catch (error) {
        const caseAudits = providerAudits.slice(auditStart);
        const providerFailure = error instanceof AiProviderError || caseAudits.some((item) => item.status === 'provider_failure');
        const runtimeFailureSource = providerFailure ? 'provider' : 'evaluator';
        taskResults.push({
          caseId: evalCase.caseId,
          goal: evalCase.goal,
          executionStatus: 'executed',
          blockedByCaseId: null,
          runtimeFailureSource,
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
          backtrackCount: 0,
          retryCount: 0,
          repeatedInputCount: 0,
          abandoned: false,
          frictionTypes: [],
          findingTypes: [],
          fillValues: [],
          experiencePath: null,
          error: error instanceof Error ? error.message : String(error),
        });
        process.stderr.write(`[connected-aquaguide] END ${evalCase.caseId}: runtimeSource=${runtimeFailureSource}; uncaught=${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const executedTaskResults = taskResults.filter((item) => item.executionStatus === 'executed');
  const blockedTaskResults = taskResults.filter((item) => item.executionStatus === 'blocked_prerequisite');
  const actorRequests = providerAudits.filter((item) => item.schemaName === 'agent_decision');
  const judgeRequests = providerAudits.filter((item) => item.schemaName === 'semantic_judge_result');
  const actorOracleLeakCount = actorRequests.filter((item) => item.markerPresent).length;
  const judgeEligibleCaseIds = executedTaskResults
    .filter((item) => item.runtimeFailureSource === null)
    .map((item) => String(item.caseId));
  const judgeOracleVisible = judgeRequests.every((item) => item.markerPresent)
    && judgeEligibleCaseIds.every((caseId) => judgeRequests.some((item) => item.caseId === caseId && item.markerPresent));
  const validBlindStatuses = new Set(['evaluated', 'suppressed_functional_failure', 'insufficient_evidence']);
  const allBlind = executedTaskResults.length > 0 && executedTaskResults.every((item) =>
    item.analysisMode === 'blind_experience_run' && validBlindStatuses.has(String(item.analysisStatus)));
  const providerFailureCount = executedTaskResults.filter((item) => item.runtimeFailureSource === 'provider').length;
  const evaluatorFailureCount = executedTaskResults.filter((item) => item.runtimeFailureSource === 'evaluator').length;
  const unknownFailureCount = executedTaskResults.filter((item) => item.failureSource === 'unknown').length;
  const blockedPrerequisiteCount = blockedTaskResults.length;
  const observedPreFailureSignalCount = executedTaskResults.reduce((total, item) => (
    total + (Array.isArray(item.observedPreFailureSignals) ? item.observedPreFailureSignals.length : 0)
  ), 0);
  const allProductJourneysPassed = taskResults.length === cases.length
    && taskResults.every((item) => item.executionStatus === 'executed'
      && item.verdict === 'pass'
      && item.failureSource === null
      && item.runtimeFailureSource === null
      && item.agentStatus === 'completed');
  const createResult = taskResults.find((item) => item.caseId === 'blind-create-usable-aquarium');
  const knownInformationFaithful = JSON.stringify(createResult?.fillValues ?? []) === JSON.stringify(['60', '30', '30']);
  const protocolHealthy = allBlind
    && actorOracleLeakCount === 0
    && judgeOracleVisible
    && providerFailureCount === 0
    && evaluatorFailureCount === 0
    && unknownFailureCount === 0;

  const diagnostic = {
    schemaVersion: 3,
    analysisMode: 'connected_aquaguide_blind_smoke',
    generatedAt: new Date().toISOString(),
    targetAppGitSha: pinnedCommit,
    targetUrl,
    provider: provider.info,
    executionConfig: executionConfig(),
    caseIds: cases.map((item) => item.caseId),
    protocolHealthy,
    allBlind,
    actorOracleLeakCount,
    judgeOracleVisible,
    providerFailureCount,
    evaluatorFailureCount,
    unknownFailureCount,
    blockedPrerequisiteCount,
    observedPreFailureSignalCount,
    allProductJourneysPassed,
    knownInformationFaithful,
    requestCounts: {
      total: providerAudits.length,
      actor: actorRequests.length,
      judge: judgeRequests.length,
      providerFailures: providerAudits.filter((item) => item.status === 'provider_failure').length,
    },
    taskResults,
    claimBoundary: [
      'This is one connected-model smoke on a pinned real product, not a model reliability estimate or human usability study.',
      'The browser locale is fixed to en-US and AquaGuide application locale is fixed to en; deterministic Oracle targets use stable visible product-state markers from the pinned product contract rather than assuming generated diagnosis copy is English.',
      'runtimeFailureSource separates provider transport/model failures from evaluator runtime failures without changing the persisted EvalCaseResult schema in this narrow regression fix.',
      'observedPreFailureSignals preserves deterministic action execution failures that occurred before the final task outcome; these sidecar signals do not override the terminal runtime failure or automatically prove a Product Failure.',
      'A pointer_interception signal records what Playwright deterministically observed at the product/evaluator interaction boundary; human-user impact still requires separate confirmation.',
      'A runner/Judge runtime interruption is inconclusive and cannot be promoted to Product Failure merely because the interrupted final page lacks success signals.',
      'Dependent journeys are marked blocked_prerequisite and are not executed when their upstream journey does not pass; a blocked downstream journey is not a second product failure.',
      'Product verdicts, normal Actor abandonment, friction findings, known-information mistakes, and recoverable action execution signals remain evidence; they do not by themselves make the protocol unhealthy.',
      'Provider/evaluator/unknown-attribution failures, Oracle leakage, missing required Judge Oracle visibility, or missing Blind Experience artifacts make the protocol unhealthy.',
      'No screenshot was sent to the provider.',
    ],
  };

  const diagnosticPath = resolve(outputDir, 'connected-aquaguide-blind-smoke.json');
  const auditPath = resolve(outputDir, 'knowledge-boundary-audit.json');
  await writeFile(diagnosticPath, JSON.stringify(diagnostic, null, 2));
  await writeFile(auditPath, JSON.stringify({ provider: provider.info, requests: providerAudits }, null, 2));

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ diagnosticPath, auditPath, ...diagnostic }, null, 2)}\n`);
  } else {
    process.stdout.write(`Connected AquaGuide Blind Smoke: protocol=${protocolHealthy ? 'HEALTHY' : 'UNHEALTHY'}; product journeys passed=${taskResults.filter((item) => item.verdict === 'pass').length}/${taskResults.length}; blocked=${blockedPrerequisiteCount}; pre-failure signals=${observedPreFailureSignalCount}\n`);
    for (const item of taskResults) {
      process.stdout.write(`- ${item.caseId}: execution=${item.executionStatus}; verdict=${item.verdict ?? 'n/a'}; resultSource=${item.failureSource ?? 'none'}; runtimeSource=${item.runtimeFailureSource ?? 'none'}; preFailureSignals=${Array.isArray(item.observedPreFailureSignals) ? item.observedPreFailureSignals.length : 0}; actions=${JSON.stringify(item.actionSequence)}\n`);
    }
    process.stdout.write(`- Actor Oracle leaks: ${actorOracleLeakCount}; Judge Oracle visible: ${judgeOracleVisible}; provider failures: ${providerFailureCount}; evaluator failures: ${evaluatorFailureCount}; unknown failures: ${unknownFailureCount}\n`);
    process.stdout.write(`- Benchmark locale: ${benchmarkBrowserLocale}; AquaGuide locale: ${benchmarkAppLocale}\n`);
    process.stdout.write(`- Diagnostic: ${diagnosticPath}\n`);
  }
}
