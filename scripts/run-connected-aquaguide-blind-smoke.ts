import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { ZodType } from 'zod';
import type { AiStructuredRequest, EvalCase } from '../types.js';
import type { AiProvider } from '../src/ai/provider.js';
import { aiConnectionStatus } from '../src/ai/provider-connection.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import { runBlindExperienceCase } from '../src/ux-evaluation/blind-experience-service.js';

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
const pinnedCommit = '8663b469c50605529367daf1b69ac0cd7cfb0cac';
const oracleOnlyMarker = 'SECRET_ORACLE_ONLY_MARKER_DO_NOT_SEND_TO_ACTOR';
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
      { assertionId: 'blind-create-water', type: 'text_visible', target: '淡水', expected: true, negated: false },
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
      { assertionId: 'blind-daily-action', type: 'text_visible', target: '增加打氧或水面扰动', expected: true, negated: false },
    ],
  }),
];

interface ProviderAudit {
  schemaName: string;
  caseId: string;
  markerPresent: boolean;
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
    this.audits.push({
      schemaName: request.schemaName,
      caseId: String(request.metadata.caseId ?? 'unknown'),
      markerPresent: combinedPrompt.includes(oracleOnlyMarker),
    });
    return this.delegate.generateStructured(request, schema);
  }
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
    executionConfig: {
      maxAgentSteps,
      allowScreenshotToProvider: false,
      sequentialSharedBrowserContext: true,
    },
    claimBoundary: [
      'Preflight is local planning only and makes zero remote provider calls.',
      'This smoke uses the pinned AquaGuide commit and the existing three Blind Experience journeys.',
      'A single connected run can expose protocol or behavior badcases but cannot estimate model variance.',
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const taskResults: Array<Record<string, unknown>> = [];

  try {
    for (const evalCase of cases) {
      const startingUrl = evalCase.caseId.includes('create') ? `${targetUrl}/welcome` : `${targetUrl}/aquarium`;
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
      const fills = outcome.agentRun.decisions
        .filter((decision) => decision.action === 'fill')
        .map((decision) => decision.value);
      taskResults.push({
        caseId: evalCase.caseId,
        goal: evalCase.goal,
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
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const actorRequests = providerAudits.filter((item) => item.schemaName === 'agent_decision');
  const judgeRequests = providerAudits.filter((item) => item.schemaName === 'semantic_judge_result');
  const actorOracleLeakCount = actorRequests.filter((item) => item.markerPresent).length;
  const judgeOracleVisible = judgeRequests.length === cases.length && judgeRequests.every((item) => item.markerPresent);
  const allBlind = taskResults.every((item) => item.analysisMode === 'blind_experience_run' && item.analysisStatus === 'evaluated');
  const providerFailureCount = taskResults.filter((item) => item.failureSource === 'provider' || item.agentFailureSource === 'provider').length;
  const evaluatorFailureCount = taskResults.filter((item) => item.failureSource === 'evaluator' || item.agentFailureSource === 'evaluator').length;
  const allProductJourneysPassed = taskResults.every((item) => item.verdict === 'pass' && item.failureSource === null && item.agentStatus === 'completed');
  const createResult = taskResults.find((item) => item.caseId === 'blind-create-usable-aquarium');
  const knownInformationFaithful = JSON.stringify(createResult?.fillValues ?? []) === JSON.stringify(['60', '30', '30']);
  const protocolHealthy = allBlind
    && actorOracleLeakCount === 0
    && judgeOracleVisible
    && providerFailureCount === 0
    && evaluatorFailureCount === 0;

  const diagnostic = {
    schemaVersion: 1,
    analysisMode: 'connected_aquaguide_blind_smoke',
    generatedAt: new Date().toISOString(),
    targetAppGitSha: pinnedCommit,
    targetUrl,
    provider: provider.info,
    executionConfig: {
      maxAgentSteps,
      allowScreenshotToProvider: false,
      sequentialSharedBrowserContext: true,
    },
    caseIds: cases.map((item) => item.caseId),
    protocolHealthy,
    allBlind,
    actorOracleLeakCount,
    judgeOracleVisible,
    providerFailureCount,
    evaluatorFailureCount,
    allProductJourneysPassed,
    knownInformationFaithful,
    requestCounts: {
      total: providerAudits.length,
      actor: actorRequests.length,
      judge: judgeRequests.length,
    },
    taskResults,
    claimBoundary: [
      'This is one connected-model smoke on a pinned real product, not a model reliability estimate or human usability study.',
      'Product verdicts, normal Actor abandonment, friction findings, and known-information mistakes remain evidence; they do not by themselves make the protocol unhealthy.',
      'Provider/evaluator failures, Oracle leakage, missing Judge Oracle visibility, or missing Blind Experience artifacts make the protocol unhealthy.',
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
    process.stdout.write(`Connected AquaGuide Blind Smoke: protocol=${protocolHealthy ? 'HEALTHY' : 'UNHEALTHY'}; product journeys passed=${taskResults.filter((item) => item.verdict === 'pass').length}/${taskResults.length}\n`);
    for (const item of taskResults) {
      process.stdout.write(`- ${item.caseId}: verdict=${item.verdict}; failureSource=${item.failureSource ?? 'none'}; actions=${JSON.stringify(item.actionSequence)}\n`);
    }
    process.stdout.write(`- Actor Oracle leaks: ${actorOracleLeakCount}; Judge Oracle visible: ${judgeOracleVisible}; provider failures: ${providerFailureCount}; evaluator failures: ${evaluatorFailureCount}\n`);
    process.stdout.write(`- Diagnostic: ${diagnosticPath}\n`);
  }
}
