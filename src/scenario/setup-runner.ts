import { readFile } from 'node:fs/promises';
import type { Page, Route } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { DeterministicJudgeResult, ProductModel } from '../../types.js';
import { runDeterministicJudge } from '../judge/deterministic-judge.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import type { AutoSetupPlan } from './setup-resolver.js';

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

export async function runAutoSetup(input: {
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
