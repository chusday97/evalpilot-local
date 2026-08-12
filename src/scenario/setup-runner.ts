import { readFile } from 'node:fs/promises';
import type { Page, Route } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { DeterministicJudgeResult, ProductModel } from '../../types.js';
import { runDeterministicJudge } from '../judge/deterministic-judge.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import type { AutoSetupPlan } from './setup-resolver.js';

type ChainAwareSetupPlan = AutoSetupPlan & { chainSteps?: AutoSetupPlan[] };

export interface AutoSetupExecutionResult {
  setupId: string;
  targetCaseId: string;
  setupTaskId: string;
  runId: string;
  status: 'passed' | 'failed';
  agentStatus: Awaited<ReturnType<typeof runAiTestAgent>>['status'];
  deterministic: DeterministicJudgeResult;
  evidencePacketPath: string;
  blockedRemoteRequests: string[];
  summary: string;
  completedAt: string;
  steps?: AutoSetupExecutionResult[];
}

function isLoopback(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function shouldBlockRemoteBusinessRequest(route: Route): boolean {
  const request = route.request();
  const resourceType = request.resourceType();
  if (!['xhr', 'fetch', 'document'].includes(resourceType)) return false;
  return !isLoopback(request.url());
}

async function runSingleAutoSetup(input: {
  page: Page;
  provider: AiProvider;
  outputDir: string;
  plan: AutoSetupPlan;
  productModel: ProductModel;
  evalSetVersion: number;
  targetAppGitSha?: string | null;
  allowRemoteModel?: boolean;
  allowScreenshotToProvider?: boolean;
  now?: () => Date;
  forceStartingNavigation?: boolean;
}): Promise<AutoSetupExecutionResult> {
  const blockedRemoteRequests: string[] = [];
  const routeHandler = async (route: Route) => {
    if (!shouldBlockRemoteBusinessRequest(route)) {
      await route.continue();
      return;
    }
    const request = route.request();
    blockedRemoteRequests.push(`${request.method()} ${request.url()}`);
    await route.abort('blockedbyclient');
  };
  await input.page.route('**/*', routeHandler);
  let agentRun: Awaited<ReturnType<typeof runAiTestAgent>>;
  try {
    // A chained setup step is a new executable scenario even when it shares the same URL as
    // the previous step. Re-enter its declared starting URL so the app can render from the
    // persisted Browser Context state instead of leaving the next Agent on the prior step's
    // terminal DOM. The route guard is already active, so this refresh cannot bypass the
    // loopback-only business-request boundary.
    if (input.forceStartingNavigation) {
      await input.page.goto(input.plan.setupScenario.startingUrl, { waitUntil: 'domcontentloaded' });
    }
    agentRun = await runAiTestAgent(input.page, input.plan.setupCase, input.provider, {
      outputDir: input.outputDir,
      startingUrl: input.plan.setupScenario.startingUrl,
      mode: 'task',
      targetAppCommit: input.targetAppGitSha ?? null,
      productModelVersion: input.productModel.version,
      evalSetVersion: input.evalSetVersion,
      judgeModel: input.provider.info.model,
      allowRemoteModel: input.allowRemoteModel,
      allowScreenshotToProvider: input.allowScreenshotToProvider,
      now: input.now,
    });
  } finally {
    await input.page.unroute('**/*', routeHandler);
  }
  const packet = evidencePacketSchema.parse(JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')));
  const deterministic = runDeterministicJudge(input.plan.setupCase, packet);
  const allAssertionsPassed = deterministic.checks.length > 0 && deterministic.checks.every((check) => check.verdict === 'pass');
  const passed = agentRun.status === 'completed' && packet.evidenceCompleteness.complete && allAssertionsPassed && blockedRemoteRequests.length === 0;
  const remoteBoundarySummary = blockedRemoteRequests.length
    ? `检测到并阻止 ${blockedRemoteRequests.length} 个发往非本地环境的业务请求。`
    : null;
  return {
    setupId: input.plan.setupId,
    targetCaseId: input.plan.targetCaseId,
    setupTaskId: input.plan.setupTaskId,
    runId: agentRun.runId,
    status: passed ? 'passed' : 'failed',
    agentStatus: agentRun.status,
    deterministic,
    evidencePacketPath: agentRun.evidencePacketPath,
    blockedRemoteRequests,
    summary: passed
      ? `前置任务“${input.plan.setupCase.title}”已由确定性证据确认完成。`
      : `前置任务“${input.plan.setupCase.title}”没有形成可安全复用的本地测试状态，目标 Case 未启动。${remoteBoundarySummary ? ` ${remoteBoundarySummary}` : ''}`,
    completedAt: agentRun.completedAt,
  };
}

export async function runAutoSetup(input: {
  page: Page;
  provider: AiProvider;
  outputDir: string;
  plan: ChainAwareSetupPlan;
  productModel: ProductModel;
  evalSetVersion: number;
  targetAppGitSha?: string | null;
  allowRemoteModel?: boolean;
  allowScreenshotToProvider?: boolean;
  now?: () => Date;
}): Promise<AutoSetupExecutionResult> {
  const chain = input.plan.chainSteps ?? [];
  if (chain.length <= 1) {
    return runSingleAutoSetup({ ...input, plan: chain[0] ?? input.plan });
  }

  const steps: AutoSetupExecutionResult[] = [];
  for (const [index, step] of chain.entries()) {
    const execution = await runSingleAutoSetup({
      ...input,
      plan: step,
      forceStartingNavigation: index > 0,
    });
    steps.push(execution);
    if (execution.status !== 'passed') {
      return {
        ...execution,
        setupId: input.plan.setupId,
        summary: `Setup 链在“${step.setupCase.title}”停止；前面 ${steps.filter((item) => item.status === 'passed').length} 步已通过，但目标 Case 未启动。 ${execution.summary}`,
        steps,
      };
    }
  }

  const final = steps.at(-1)!;
  return {
    ...final,
    setupId: input.plan.setupId,
    status: 'passed',
    blockedRemoteRequests: steps.flatMap((step) => step.blockedRemoteRequests),
    summary: `Setup 链 ${steps.map((step) => step.setupTaskId).join(' → ')} 已逐步通过确定性证据验证。`,
    steps,
  };
}
