import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { AgentActionResult, AgentDecision, AiTestAgentRun, EvalCase, EvidencePacket, InteractionAction, PageObservation, ReflectionDecision, StepVerification } from '../../types.js';
import type { AiProvider } from '../ai/provider.js';
import { ensureDirectory, writeJsonAtomic } from '../utils/file-system.js';
import { chooseAgentAction } from './actor.js';
import { executeAgentAction } from './action-executor.js';
import { saveAgentEvidence } from './evidence-packet.js';
import { observePage } from './observer.js';
import { reflectOnStep } from './reflector.js';
import { generateSafeInput } from './safe-input-generator.js';
import { verifyAgentStep } from './verifier.js';
import { packageVersion } from '../runtime/paths.js';
import { semanticJudgePromptV1 } from '../prompts/semantic-judge.v1.js';

interface AgentRunnerOptions {
  outputDir: string;
  startingUrl: string;
  maxSteps?: number;
  mode?: 'task' | 'exploration';
  allowRemoteModel?: boolean;
  allowScreenshotToProvider?: boolean;
  targetAppCommit?: string | null;
  productModelVersion?: number;
  evalSetVersion?: number;
  judgeModel?: string;
  now?: () => Date;
}

function interactionFor(decision: AgentDecision, result: AgentActionResult, index: number, elapsedMs: number, pageUrl: string): InteractionAction {
  const type = decision.action === 'fill' || decision.action === 'select' ? 'input' : decision.action === 'click' ? 'click' : decision.action === 'back' ? 'backtrack' : result.status === 'failed' ? 'error' : 'navigation';
  return { actionId: `agent-action-${String(index + 1).padStart(3, '0')}`, type, timestampMs: Math.max(0, Math.round(elapsedMs)), page: pageUrl, target: decision.targetElementId, inputField: decision.action === 'fill' ? decision.targetElementId : null, inputLength: decision.action === 'fill' ? decision.value?.length ?? 0 : null, inputFingerprint: null, outcome: result.summary, evidence: result.evidenceRefs };
}

export async function runAiTestAgent(page: Page, evalCase: EvalCase, provider: AiProvider, options: AgentRunnerOptions): Promise<AiTestAgentRun> {
  const now = options.now ?? (() => new Date());
  const started = now();
  const monotonicStartedAt = performance.now();
  const runId = `run-ai-${started.toISOString().replace(/[:.]/g, '-')}`;
  const runDirectory = resolve(options.outputDir, 'runs', runId);
  const screenshotDirectory = resolve(runDirectory, 'screenshots');
  await ensureDirectory(screenshotDirectory);
  const decisions: AgentDecision[] = [];
  const actionResults: AgentActionResult[] = [];
  const observations: PageObservation[] = [];
  const verifications: StepVerification[] = [];
  const reflections: ReflectionDecision[] = [];
  const interactions: InteractionAction[] = [];
  const screenshots: string[] = [];
  const consoleEvidence: string[] = [];
  const networkEvidence: string[] = [];
  const onConsole = (message: { type(): string; text(): string }) => { if (message.type() === 'error') consoleEvidence.push(message.text()); };
  const onResponse = (response: { status(): number; url(): string }) => { if (response.status() >= 400) networkEvidence.push(`${response.status()} ${response.url()}`); };
  page.on('console', onConsole);
  page.on('response', onResponse);
  let status: AiTestAgentRun['status'] = 'inconclusive';
  let failureSource: AiTestAgentRun['failureSource'] = null;
  let error: string | null = null;
  try {
    if (page.url() !== options.startingUrl) await page.goto(options.startingUrl, { waitUntil: 'domcontentloaded' });
    for (let step = 0; step < (options.maxSteps ?? 8); step += 1) {
      const screenshotPath = resolve(screenshotDirectory, `step-${String(step + 1).padStart(2, '0')}.png`);
      const screenshot = await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push(screenshotPath);
      const before = await observePage(page, [screenshotPath]);
      observations.push(before);
      let decision: AgentDecision;
      try {
        decision = await chooseAgentAction({
          provider, evalCase, observation: before, history: decisions, verifications,
          screenshotDataUrl: `data:image/png;base64,${screenshot.toString('base64')}`,
          allowRemoteModel: provider.info.remote ? Boolean(options.allowRemoteModel) : true,
          allowScreenshot: provider.info.remote ? Boolean(options.allowScreenshotToProvider) : true,
        });
      } catch (providerError) {
        failureSource = 'evaluator';
        error = providerError instanceof Error ? providerError.message : String(providerError);
        status = 'inconclusive';
        break;
      }
      if (decision.action === 'fill') {
        const field = before.formFields.find((item) => item.elementId === decision.targetElementId);
        if (!field) decision = { ...decision, value: null };
        else {
          const safeInput = generateSafeInput(field, evalCase.knownInformation, page.url());
          if (safeInput.status === 'blocked_by_safety') {
            decisions.push({ ...decision, value: null });
            const blocked: AgentActionResult = { status: 'blocked_by_safety', action: 'fill', targetElementId: decision.targetElementId, summary: safeInput.reason, evidenceRefs: before.evidenceRefs };
            actionResults.push(blocked);
            const verification = verifyAgentStep(before, before, decision, blocked); verifications.push(verification);
            reflections.push(reflectOnStep({ evalCase, decision, result: blocked, verification, failedAttempts: 1 }));
            status = 'blocked_by_safety';
            break;
          }
          decision = { ...decision, value: safeInput.value };
        }
      }
      decisions.push(decision);
      const actionResult = await executeAgentAction(page, before, decision);
      actionResults.push(actionResult);
      interactions.push(interactionFor(decision, actionResult, interactions.length, performance.now() - monotonicStartedAt, before.pageUrl));
      await page.waitForTimeout(50);
      const after = await observePage(page, before.evidenceRefs);
      const verification = verifyAgentStep(before, after, decision, actionResult);
      verifications.push(verification);
      const failedAttempts = verifications.filter((item) => item.status === 'not_confirmed').length;
      const reflection = reflectOnStep({ evalCase, decision, result: actionResult, verification, failedAttempts });
      reflections.push(reflection);
      if (actionResult.status === 'blocked_by_safety') { status = 'blocked_by_safety'; break; }
      if (reflection.nextStep === 'finish') { status = 'completed'; observations.push(after); break; }
      if (reflection.nextStep === 'abandon') { status = 'abandoned'; observations.push(after); break; }
      if (step === (options.maxSteps ?? 8) - 1) observations.push(after);
    }
  } catch (runError) {
    status = 'inconclusive'; failureSource = 'evaluator'; error = runError instanceof Error ? runError.message : String(runError);
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
  const completedAt = now().toISOString();
  const finalObservation = observations.at(-1) ?? await observePage(page);
  const packet: EvidencePacket = {
    runId, caseId: evalCase.caseId, targetAppCommit: options.targetAppCommit ?? null,
    actorModel: provider.info.model, actorPromptVersion: '1.0.0', startedAt: started.toISOString(), completedAt,
    actions: interactions, observations, stepVerifications: verifications, screenshots, tracePath: null,
    consoleEvidence, networkEvidence, finalState: { url: page.url(), visibleTextSummary: finalObservation.visibleStateSummary.slice(0, 1_000) },
    versions: {
      targetAppGitSha: options.targetAppCommit ?? null,
      productModelVersion: options.productModelVersion ?? (evalCase.origin.type === 'generated_from_product_model' ? evalCase.origin.productModelVersion : 1),
      evalSetVersion: options.evalSetVersion ?? 1,
      caseVersion: evalCase.version,
      evalPilotVersion: packageVersion(),
      actorModel: provider.info.model,
      judgeModel: options.judgeModel ?? provider.info.model,
      actorPromptVersion: '1.0.0',
      judgePromptVersion: semanticJudgePromptV1.version,
      toolSchemaVersion: '1.0.0',
      timestamp: started.toISOString(),
    },
  };
  const evidencePacketPath = await saveAgentEvidence(options.outputDir, packet, decisions);
  const run: AiTestAgentRun = { runId, caseId: evalCase.caseId, mode: options.mode ?? 'task', status, failureSource, decisions, actionResults, reflections, evidencePacketPath, startedAt: started.toISOString(), completedAt, error };
  await writeJsonAtomic(resolve(runDirectory, 'agent-run.json'), run);
  return run;
}
