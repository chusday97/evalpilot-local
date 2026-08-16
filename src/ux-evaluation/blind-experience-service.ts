import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { EvalCase, EvalCaseResult } from '../../types.js';
import type { SyntheticFileFixture } from '../scenario/file-fixture-resolver.js';
import { judgeEvalCase } from '../judge/hybrid-judge.js';
import { evalCaseResultSchema } from '../judge/schemas.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { classifyEvaluatorFailure, evaluatorFailureResult } from '../evaluator-errors/classifier.js';
import { writeJsonAtomic } from '../utils/file-system.js';
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

  // The Judge receives the original case with the real Oracle. This is the core knowledge
  // separation: Actor chooses from visible UI; Judge evaluates against hidden success rules.
  const rawJudgedResult = await judgeEvalCase({
    outputDir: input.outputDir,
    evalCase: input.evalCase,
    packet,
    provider: input.provider,
    allowRemoteModel: input.allowRemoteModel,
    createdAt: agentRun.completedAt,
  });

  const safetyGatedResult = agentRun.status === 'blocked_by_safety'
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
  // failure. Only classify here when the runner itself reports an evaluator failure. This is
  // deliberately different from functional evaluation, where ambiguous abandonment can be
  // promoted to an evaluator badcase.
  let result = safetyGatedResult;
  if (agentRun.failureSource === 'evaluator') {
    const classification = classifyEvaluatorFailure({ agentRun, packet, result: safetyGatedResult });
    if (classification) result = evaluatorFailureResult(safetyGatedResult, classification);
  }

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
