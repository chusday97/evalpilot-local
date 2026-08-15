import { chromium } from 'playwright';
import { configuredEvaluationProvider } from '../evaluation/evaluation-orchestrator.js';
import { loadEvalSetCases, loadEvalSetManifest } from '../eval-set/eval-set-store.js';
import { listProductModelVersions } from '../product-model/product-model-store.js';
import { configForProject } from '../projects/project-registry.js';
import { EvalPilotError } from '../utils/errors.js';
import { runBlindExperienceCase, type BlindExperienceRunResult } from './blind-experience-service.js';

export interface ConfiguredBlindExperienceInput {
  projectId: string;
  caseId: string;
  /**
   * Blind evaluation intentionally starts from a neutral user-visible location instead of a
   * hidden task entrypoint. Defaults to the project's configured target URL.
   */
  startingUrl?: string;
  allowScreenshot?: boolean;
  maxAgentSteps?: number;
  agentWaitTimeoutMs?: number;
}

/**
 * Application-level entrypoint for a genuine configured-model Blind Experience run.
 *
 * This function deliberately does NOT call the adaptive functional orchestrator: it does not
 * update case pass/fail stats, coverage, badcases, or the regression corpus. It observes one
 * selected task with the connected provider while the independent Judge keeps the real Oracle.
 * Preconditions are not auto-materialized here; callers should choose a start state that is
 * already valid for the selected task or run prerequisite setup separately.
 */
export async function runConfiguredBlindExperience(
  cwd: string,
  input: ConfiguredBlindExperienceInput,
): Promise<BlindExperienceRunResult> {
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

  const provider = configuredEvaluationProvider();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return await runBlindExperienceCase({
      page,
      provider,
      outputDir: config.outputDir,
      evalCase,
      startingUrl: input.startingUrl ?? config.targetUrl,
      evalSetVersion: manifest.version,
      productModelVersion,
      targetAppGitSha: null,
      allowRemoteModel: true,
      allowScreenshotToProvider: input.allowScreenshot ?? false,
      maxAgentSteps: input.maxAgentSteps,
      agentWaitTimeoutMs: input.agentWaitTimeoutMs,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}
