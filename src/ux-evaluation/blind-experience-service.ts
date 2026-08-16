import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { EvalCase, EvalCaseResult, EvidencePacket } from '../../types.js';
import type { SyntheticFileFixture } from '../scenario/file-fixture-resolver.js';
import { runDeterministicJudge } from '../judge/deterministic-judge.js';
import { saveEvalCaseResult } from '../judge/eval-result-store.js';
import { judgeEvalCase } from '../judge/hybrid-judge.js';
import {
  deterministicJudgeResultSchema,
  evalCaseResultSchema,
  semanticJudgeResultSchema,
} from '../judge/schemas.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { writeJsonAtomic } from '../utils/file-system.js';
import { writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { analyzeBlindExperience, type BlindExperienceAnalysis } from './blind-experience-analyzer.js';

/**
 * Create the case that is visible to the Blind Actor runtime.
 *
 * The original case — including the real Oracle — is retained separately for the Judge.
 * Scrubbing the entire Oracle here prevents hidden success strings from influencing not only
 * the Actor prompt, but also runner-side task-progress heuristics and deterministic auto-finish.
 */
export function buildBlindActorCase(evalCase: EvalCase): EvalCase {
  return {
    ...evalCase,
    oracle: {
      expectedOutcome: ['仅依据当前可见界面自行判断是否已经完成用户目标'],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: ['Blind Actor 只依据 persona、goal、known information 和可见 UI 行动'],
      deterministicAssertions: [],
      inconclusiveWhen: ['当前可见界面不足以安全判断下一步或是否已经完成目标'],
      aiOutputCriteria: undefined,
    },
  };
}

export interface BlindExperienceRunResult {
  agentRun: Awaited<ReturnType<typeof runAiTestAgent>>;
  result: EvalCaseResult;
  experience: BlindExperienceAnalysis;
  experiencePath: string;
}

async function runtimeFailureResult(input: {
  outputDir: string;
  evalCase: EvalCase;
  packet: EvidencePacket;
  createdAt: string;
  technicalReason: string;
}): Promise<EvalCaseResult> {
  const deterministic = runDeterministicJudge(input.evalCase, input.packet);
  const semantic = semanticJudgeResultSchema.parse({
    verdict: 'inconclusive',
    taskCompletion: 'unknown',
    summary: 'EvalPilot 的运行时或独立 Judge 没有完整结束，本次不能据此判断产品通过或失败。',
    whatWorked: [],
    whatFailed: [],
    whyItMatters: ['未完整执行的 Blind Experience 不能因为最终页面缺少成功信号而自动升级为 Product Failure。'],
    confirmedFacts: ['已保留中断前的浏览器证据与确定性检查结果。'],
    hypotheses: [],
    unknowns: [input.technicalReason],
    evidenceRefs: deterministic.evidenceRefs,
    confidence: 0,
  });
  const result = evalCaseResultSchema.parse({
    runId: input.packet.runId,
    caseId: input.evalCase.caseId,
    verdict: 'inconclusive',
    failureSource: 'evaluator',
    severity: null,
    deterministic,
    semantic,
    evidencePacketPath: `runs/${input.packet.runId}/evidence-packet.json`,
    createdAt: input.createdAt,
  });
  const runDirectory = resolve(input.outputDir, 'runs', input.packet.runId);
  await Promise.all([
    writeSchemaJsonAtomic(resolve(runDirectory, 'deterministic-judge.json'), deterministic, deterministicJudgeResultSchema),
    writeSchemaJsonAtomic(resolve(runDirectory, 'semantic-judge.json'), semantic, semanticJudgeResultSchema),
    saveEvalCaseResult(input.outputDir, result),
  ]);
  return result;
}

export async function runBlindExperienceCase(input: {
  page: Page;
  provider: AiProvider;
  outputDir: string;
  evalCase: EvalCase;
  startingUrl: string;
  evalSetVersion: number;
  productModelVersion?: number;
  targetAppGitSha?: string | null;
  allowRemoteModel?: boolean;
  allowScreenshotToProvider?: boolean;
  maxAgentSteps?: number;
  agentWaitTimeoutMs?: number;
  fileFixtures?: SyntheticFileFixture[];
  now?: () => Date;
}): Promise<BlindExperienceRunResult> {
  const actorCase = buildBlindActorCase(input.evalCase);

  // A Blind task starts from an explicit user-visible entry state every time. Reload even when
  // the URL string is unchanged: the previous task may have left a modal/result layer open at
  // the same route. BrowserContext storage is preserved, so real persisted product state remains
  // available while transient UI state is reset.
  await input.page.goto(input.startingUrl, { waitUntil: 'domcontentloaded' });

  const agentRun = await runAiTestAgent(input.page, actorCase, input.provider, {
    outputDir: input.outputDir,
    startingUrl: input.startingUrl,
    mode: 'exploration',
    maxSteps: input.maxAgentSteps,
    waitTimeoutMs: input.agentWaitTimeoutMs,
    targetAppCommit: input.targetAppGitSha ?? null,
    productModelVersion: input.productModelVersion,
    evalSetVersion: input.evalSetVersion,
    judgeModel: input.provider.info.model,
    allowRemoteModel: input.allowRemoteModel,
    allowScreenshotToProvider: input.allowScreenshotToProvider,
    fileFixtures: input.fileFixtures,
    now: input.now,
  });
  const packet = evidencePacketSchema.parse(JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')));

  // A runner-level evaluator interruption means the target journey did not finish under a
  // trustworthy evaluator runtime. Preserve deterministic evidence, but do not let missing
  // success strings on the interrupted final page become a Product Failure.
  let rawJudgedResult: EvalCaseResult;
  if (agentRun.failureSource === 'evaluator') {
    rawJudgedResult = await runtimeFailureResult({
      outputDir: input.outputDir,
      evalCase: input.evalCase,
      packet,
      createdAt: agentRun.completedAt,
      technicalReason: agentRun.error ?? 'Blind Actor runtime ended inconclusively before an independent product verdict could be formed.',
    });
  } else {
    try {
      // The Judge receives the original case with the real Oracle. This is the core knowledge
      // separation: Actor chooses from visible UI; Judge evaluates against hidden success rules.
      rawJudgedResult = await judgeEvalCase({
        outputDir: input.outputDir,
        evalCase: input.evalCase,
        packet,
        provider: input.provider,
        allowRemoteModel: input.allowRemoteModel,
        createdAt: agentRun.completedAt,
      });
    } catch (judgeError) {
      rawJudgedResult = await runtimeFailureResult({
        outputDir: input.outputDir,
        evalCase: input.evalCase,
        packet,
        createdAt: agentRun.completedAt,
        technicalReason: `Independent Judge failed before producing a trustworthy verdict: ${judgeError instanceof Error ? judgeError.message : String(judgeError)}`,
      });
    }
  }

  const result = agentRun.status === 'blocked_by_safety'
    ? evalCaseResultSchema.parse({
      ...rawJudgedResult,
      verdict: 'inconclusive',
      failureSource: 'evaluator',
      severity: null,
      semantic: {
        ...rawJudgedResult.semantic,
        verdict: 'inconclusive',
        taskCompletion: 'unknown',
        summary: '安全策略阻止继续操作，本次 Blind Experience 不能据此判断产品或体验。',
        whatFailed: [],
        whyItMatters: ['安全阻断不应被解释成产品体验问题。'],
        confirmedFacts: ['Agent 已阻止危险操作'],
        hypotheses: [],
        unknowns: ['需要人工确认是否应在受控环境继续测试该操作'],
        confidence: 1,
      },
    })
    : rawJudgedResult;

  // A normal Blind Actor abandonment is behavioral evidence, not automatically an evaluator
  // failure. Only runner/Judge runtime interruptions are forced inconclusive above. This is
  // deliberately different from functional evaluation, where ambiguous abandonment can be
  // promoted to an evaluator badcase.
  const experience = analyzeBlindExperience({
    evalCase: input.evalCase,
    result,
    packet,
    agentRun,
  });
  const experiencePath = resolve(input.outputDir, 'runs', agentRun.runId, 'blind-experience-analysis.json');
  await writeJsonAtomic(experiencePath, experience);
  return { agentRun, result, experience, experiencePath };
}
