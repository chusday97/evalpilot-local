import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
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
  summary: string;
  completedAt: string;
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
  const agentRun = await runAiTestAgent(input.page, input.plan.setupCase, input.provider, {
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
  const packet = evidencePacketSchema.parse(JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')));
  const deterministic = runDeterministicJudge(input.plan.setupCase, packet);
  const allAssertionsPassed = deterministic.checks.length > 0 && deterministic.checks.every((check) => check.verdict === 'pass');
  const passed = agentRun.status === 'completed' && packet.evidenceCompleteness.complete && allAssertionsPassed;
  return {
    setupId: input.plan.setupId,
    targetCaseId: input.plan.targetCaseId,
    setupTaskId: input.plan.setupTaskId,
    runId: agentRun.runId,
    status: passed ? 'passed' : 'failed',
    agentStatus: agentRun.status,
    deterministic,
    evidencePacketPath: agentRun.evidencePacketPath,
    summary: passed
      ? `前置任务“${input.plan.setupCase.title}”已由确定性证据确认完成。`
      : `前置任务“${input.plan.setupCase.title}”没有形成完整且全部通过的确定性证据，目标 Case 未启动。`,
    completedAt: agentRun.completedAt,
  };
}
