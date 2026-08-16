import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { EvalCase } from '../../types.js';
import { configuredEvaluationProvider } from '../evaluation/evaluation-orchestrator.js';
import { loadEvalSetCases, loadEvalSetManifest } from '../eval-set/eval-set-store.js';
import { loadProductModel, listProductModelVersions } from '../product-model/product-model-store.js';
import { configForProject } from '../projects/project-registry.js';
import { materializeSyntheticFileFixtures, type SyntheticFileFixture } from '../scenario/file-fixture-resolver.js';
import { planScenarioPrerequisites, summarizePrerequisitePlan, type ChainAwareSetupPlan, type PrerequisitePlan } from '../scenario/prerequisite-planner.js';
import { compileExecutableScenario } from '../scenario/scenario-compiler.js';
import { verifyAuthSession, type AuthSessionCheck } from '../scenario/auth-session-verifier.js';
import { runAutoSetup, type AutoSetupExecutionResult } from '../scenario/setup-runner.js';
import type { AutoSetupPlan } from '../scenario/setup-resolver.js';
import { EvalPilotError } from '../utils/errors.js';
import { writeJsonAtomic } from '../utils/file-system.js';
import { runBlindExperienceCase, type BlindExperienceRunResult } from './blind-experience-service.js';
import { buildSetupStateSignature } from './setup-state-signature.js';

export interface ConfiguredBlindExperienceInput {
  projectId: string;
  caseId: string;
  /**
   * Optional neutral user-visible start. When omitted, the Product Model capability entry is
   * used. The prerequisite planner still evaluates the canonical Product Model scenario.
   */
  startingUrl?: string;
  allowScreenshot?: boolean;
  maxAgentSteps?: number;
  agentWaitTimeoutMs?: number;
}

export interface BlindSetupKnowledgeSource {
  setupTaskId: string;
  sourceCaseId: string | null;
  sourceCaseTitle: string | null;
  candidateCaseIds: string[];
  candidateStateFingerprints: Array<{ caseId: string; fingerprint: string }>;
  setupStateFingerprint: string | null;
  equivalence: 'missing' | 'unique' | 'exact_signature_match' | 'ambiguous';
  knownInformationKeys: string[];
  status: 'ready' | 'missing_baseline';
  reason: string;
}

export interface ConfiguredBlindExperiencePreflight {
  projectId: string;
  caseId: string;
  caseTitle: string;
  status: 'ready' | 'blocked';
  canRun: boolean;
  startingUrl: string;
  scenarioReadiness: string;
  prerequisite: ReturnType<typeof summarizePrerequisitePlan>;
  setupKnowledge: BlindSetupKnowledgeSource[];
  reasons: string[];
}

export type ConfiguredBlindExperienceRunResult = BlindExperienceRunResult & {
  preflight: ConfiguredBlindExperiencePreflight;
  setupExecution: AutoSetupExecutionResult | null;
  authCheck: AuthSessionCheck | null;
};

interface LoadedBlindContext {
  config: Awaited<ReturnType<typeof configForProject>>;
  cases: EvalCase[];
  evalCase: EvalCase;
  manifest: Awaited<ReturnType<typeof loadEvalSetManifest>>;
  productModelVersion: number;
  productModel: Awaited<ReturnType<typeof loadProductModel>>;
  prerequisitePlan: PrerequisitePlan;
  boundPrerequisitePlan: PrerequisitePlan;
  preflight: ConfiguredBlindExperiencePreflight;
}

function baselineProducers(cases: EvalCase[], targetCaseId: string, taskId: string): EvalCase[] {
  return cases.filter((item) =>
    item.caseId !== targetCaseId
    && item.taskId === taskId
    && item.setType === 'baseline'
    && item.status === 'stable',
  ).sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function rebuildChainAwarePlan(original: ChainAwareSetupPlan | null, steps: AutoSetupPlan[]): ChainAwareSetupPlan | null {
  if (!steps.length || !original) return null;
  if (steps.length === 1) return steps[0]!;
  const final = steps.at(-1)!;
  return {
    ...final,
    setupId: original.setupId,
    reason: original.reason,
    chainSteps: steps,
  };
}

/**
 * Bind automatic Setup to already-approved baseline fixture knowledge instead of letting a
 * Blind target run invent prerequisite state. Setup remains evaluator-managed and is verified
 * independently before the target Blind Actor starts.
 *
 * V1 equivalence is intentionally exact: multiple stable baselines may be reused only when
 * their task, known fixture inputs and observable Oracle contract produce the same setup-state
 * signature. Different signatures remain ambiguous and fail closed. This allows duplicate
 * representations of the same state without guessing that distinct configurations are equal.
 */
export function bindBlindSetupKnownInformation(plan: PrerequisitePlan, cases: EvalCase[]): {
  plan: PrerequisitePlan;
  sources: BlindSetupKnowledgeSource[];
  missingTaskIds: string[];
} {
  if (!plan.setupPlans.length) return { plan, sources: [], missingTaskIds: [] };
  const missingTaskIds: string[] = [];
  const sources: BlindSetupKnowledgeSource[] = [];
  const steps = plan.setupPlans.map((step) => {
    const candidates = baselineProducers(cases, plan.caseId, step.setupTaskId);
    const signedCandidates = candidates.map((candidate) => ({
      candidate,
      signature: buildSetupStateSignature(candidate),
    }));
    const distinctFingerprints = [...new Set(signedCandidates.map((item) => item.signature.fingerprint))];
    const equivalentDuplicates = signedCandidates.length > 1 && distinctFingerprints.length === 1;
    const producer = signedCandidates.length === 1 || equivalentDuplicates
      ? signedCandidates[0]!.candidate
      : null;
    const equivalence: BlindSetupKnowledgeSource['equivalence'] = candidates.length === 0
      ? 'missing'
      : candidates.length === 1
        ? 'unique'
        : equivalentDuplicates
          ? 'exact_signature_match'
          : 'ambiguous';
    const setupStateFingerprint = producer ? signedCandidates[0]!.signature.fingerprint : null;
    const reason = candidates.length === 0
      ? `Setup ${step.setupTaskId} 没有可复用的稳定 baseline Case；不会为 Blind 目标猜测前置状态。`
      : candidates.length === 1
        ? `Setup ${step.setupTaskId} 使用稳定 baseline ${producer!.caseId} 的已知测试信息。`
        : equivalentDuplicates
          ? `Setup ${step.setupTaskId} 的 ${candidates.length} 个稳定 baseline 具有相同 exact setup-state signature（${setupStateFingerprint!.slice(0, 12)}…）；按 caseId 稳定选择 ${producer!.caseId} 执行。`
          : `Setup ${step.setupTaskId} 存在多个不等价 setup-state signature（${distinctFingerprints.length} 组；${candidates.map((item) => item.caseId).join('、')}），当前无法证明这些状态等价；不会随机选择前置状态。`;
    sources.push({
      setupTaskId: step.setupTaskId,
      sourceCaseId: producer?.caseId ?? null,
      sourceCaseTitle: producer?.title ?? null,
      candidateCaseIds: candidates.map((item) => item.caseId),
      candidateStateFingerprints: signedCandidates.map((item) => ({
        caseId: item.candidate.caseId,
        fingerprint: item.signature.fingerprint,
      })),
      setupStateFingerprint,
      equivalence,
      knownInformationKeys: producer ? Object.keys(producer.knownInformation).sort() : [],
      status: producer ? 'ready' : 'missing_baseline',
      reason,
    });
    if (!producer) {
      missingTaskIds.push(step.setupTaskId);
      return step;
    }
    return {
      ...step,
      setupCase: {
        ...step.setupCase,
        knownInformation: { ...producer.knownInformation },
      },
    };
  });
  return {
    plan: {
      ...plan,
      setupPlans: steps,
      setupPlan: rebuildChainAwarePlan(plan.setupPlan, steps),
    },
    sources,
    missingTaskIds,
  };
}

function resolvedStartingUrl(configTargetUrl: string, scenarioStartingUrl: string, requested?: string): string {
  if (!requested) return scenarioStartingUrl;
  try {
    return new URL(requested, configTargetUrl).toString();
  } catch {
    throw new EvalPilotError('Blind Experience 的起始页面无法解析。', 'STARTING_URL_INVALID');
  }
}

async function loadBlindContext(cwd: string, input: ConfiguredBlindExperienceInput): Promise<LoadedBlindContext> {
  const config = await configForProject(cwd, input.projectId);
  const [cases, manifest, productModelVersions] = await Promise.all([
    loadEvalSetCases(config.outputDir),
    loadEvalSetManifest(config.outputDir),
    listProductModelVersions(config.outputDir),
  ]);
  const evalCase = cases.find((item) => item.caseId === input.caseId);
  if (!evalCase) throw new EvalPilotError(`没有找到 Blind Experience 案例：${input.caseId}`, 'EVALUATION_CASE_NOT_FOUND');
  const productModelVersion = productModelVersions.at(-1);
  if (!productModelVersion) throw new EvalPilotError('产品理解尚未生成，无法绑定 Blind Experience 版本。', 'PRODUCT_MODEL_REQUIRED');
  const productModel = await loadProductModel(config.outputDir, productModelVersion);
  const generatedAt = new Date().toISOString();
  const scenario = compileExecutableScenario({ evalCase, productModel, targetUrl: config.targetUrl, generatedAt });
  const prerequisitePlan = await planScenarioPrerequisites({
    scenario,
    evalCase,
    productModel,
    targetUrl: config.targetUrl,
    projectRoot: config.projectRoot,
    authStorageStatePath: process.env.EVALPILOT_AUTH_STATE ?? null,
    generatedAt,
  });
  const bound = bindBlindSetupKnownInformation(prerequisitePlan, cases);
  const startingUrl = resolvedStartingUrl(config.targetUrl, scenario.startingUrl, input.startingUrl);
  const setupMissing = bound.missingTaskIds.length > 0;
  const blockedByPlanner = prerequisitePlan.status === 'blocked';
  const reasons = [
    ...prerequisitePlan.reasons,
    ...bound.sources.map((source) => source.reason),
  ];
  const preflight: ConfiguredBlindExperiencePreflight = {
    projectId: input.projectId,
    caseId: evalCase.caseId,
    caseTitle: evalCase.title,
    status: blockedByPlanner || setupMissing ? 'blocked' : 'ready',
    canRun: !blockedByPlanner && !setupMissing,
    startingUrl,
    scenarioReadiness: scenario.readiness,
    prerequisite: summarizePrerequisitePlan(prerequisitePlan),
    setupKnowledge: bound.sources,
    reasons,
  };
  return {
    config,
    cases,
    evalCase,
    manifest,
    productModelVersion,
    productModel,
    prerequisitePlan,
    boundPrerequisitePlan: bound.plan,
    preflight,
  };
}

export async function planConfiguredBlindExperience(
  cwd: string,
  input: ConfiguredBlindExperienceInput,
): Promise<ConfiguredBlindExperiencePreflight> {
  return (await loadBlindContext(cwd, input)).preflight;
}

/**
 * Application-level entrypoint for a genuine configured-model Blind Experience run.
 *
 * Prerequisites are prepared and independently verified before the target Blind Actor starts.
 * A missing or unverifiable prerequisite stops the run before UX analysis, so setup failures
 * cannot be mislabeled as discoverability or abandonment problems in the product target.
 * Functional case stats, coverage, badcases and the regression corpus remain untouched.
 */
export async function runConfiguredBlindExperience(
  cwd: string,
  input: ConfiguredBlindExperienceInput,
): Promise<ConfiguredBlindExperienceRunResult> {
  const loaded = await loadBlindContext(cwd, input);
  if (!loaded.preflight.canRun) {
    throw new EvalPilotError(
      `Blind Experience 前置状态未就绪，目标 Actor 未启动：${loaded.preflight.reasons.join('；')}`,
      'BLIND_EXPERIENCE_PREREQUISITE_BLOCKED',
    );
  }

  const provider = configuredEvaluationProvider();
  let fileFixtures: SyntheticFileFixture[] = [];
  if (loaded.boundPrerequisitePlan.fileFixturePlan) {
    fileFixtures = await materializeSyntheticFileFixtures(
      loaded.boundPrerequisitePlan.fileFixturePlan,
      resolve(loaded.config.outputDir, 'blind-experience-fixtures', loaded.evalCase.caseId, Date.now().toString()),
    );
  }

  const browser = await chromium.launch({ headless: true });
  const storageState = loaded.boundPrerequisitePlan.authFixture?.storageState ?? null;
  const context = await browser.newContext(storageState ? { storageState } : undefined);
  let setupExecution: AutoSetupExecutionResult | null = null;
  let authCheck: AuthSessionCheck | null = null;
  try {
    const page = await context.newPage();
    if (loaded.boundPrerequisitePlan.authFixture) {
      authCheck = await verifyAuthSession(page, loaded.preflight.startingUrl);
      if (authCheck.status !== 'ready') {
        throw new EvalPilotError(
          `Blind Experience 的认证前置状态未通过验证，目标 Actor 未启动：${authCheck.reason}`,
          'BLIND_EXPERIENCE_PREREQUISITE_FAILED',
        );
      }
    }

    if (loaded.boundPrerequisitePlan.setupPlan) {
      setupExecution = await runAutoSetup({
        page,
        provider,
        outputDir: loaded.config.outputDir,
        plan: loaded.boundPrerequisitePlan.setupPlan,
        productModel: loaded.productModel,
        evalSetVersion: loaded.manifest.version,
        targetAppGitSha: null,
        allowRemoteModel: true,
        allowScreenshotToProvider: input.allowScreenshot ?? false,
      });
      if (setupExecution.status !== 'passed') {
        throw new EvalPilotError(
          `Blind Experience 的 Setup 没有形成可验证状态，目标 Actor 未启动：${setupExecution.summary}`,
          'BLIND_EXPERIENCE_PREREQUISITE_FAILED',
        );
      }
    }

    const blind = await runBlindExperienceCase({
      page,
      provider,
      outputDir: loaded.config.outputDir,
      evalCase: loaded.evalCase,
      startingUrl: loaded.preflight.startingUrl,
      evalSetVersion: loaded.manifest.version,
      productModelVersion: loaded.productModelVersion,
      targetAppGitSha: null,
      allowRemoteModel: true,
      allowScreenshotToProvider: input.allowScreenshot ?? false,
      maxAgentSteps: input.maxAgentSteps,
      agentWaitTimeoutMs: input.agentWaitTimeoutMs,
      fileFixtures,
    });
    await writeJsonAtomic(resolve(loaded.config.outputDir, 'runs', blind.agentRun.runId, 'blind-prerequisite.json'), {
      schemaVersion: 1,
      preflight: loaded.preflight,
      authCheck,
      setupExecution,
      targetActorStarted: true,
    });
    return { ...blind, preflight: loaded.preflight, setupExecution, authCheck };
  } finally {
    await context.close();
    await browser.close();
  }
}
