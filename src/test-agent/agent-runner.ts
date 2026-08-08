import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { AgentActionResult, AgentDecision, AiTestAgentRun, EvalCase, EvidencePacket, InteractionAction, PageObservation, ReflectionDecision, StepEvidence, StepVerification } from '../../types.js';
import type { AiProvider } from '../ai/provider.js';
import { ensureDirectory, pathExists, writeJsonAtomic } from '../utils/file-system.js';
import { chooseAgentAction } from './actor.js';
import { executeAgentAction } from './action-executor.js';
import { calculateEvidenceCompleteness, saveAgentEvidence } from './evidence-packet.js';
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
  const stepEvidence: StepEvidence[] = [];
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
  const expectedTracePath = resolve(runDirectory, 'trace.zip');
  let tracePath: string | null = null;
  let traceStarted = false;
  let finalObservation: PageObservation | null = null;
  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    traceStarted = true;
  } catch (traceError) {
    error = `本地 Trace 无法启动：${traceError instanceof Error ? traceError.message : String(traceError)}`;
  }
  try {
    if (page.url() !== options.startingUrl) await page.goto(options.startingUrl, { waitUntil: 'domcontentloaded' });
    for (let step = 0; step < (options.maxSteps ?? 8); step += 1) {
      const stepIndex = step + 1;
      const stepLabel = String(stepIndex).padStart(3, '0');
      const beforeScreenshotPath = resolve(screenshotDirectory, `step-${stepLabel}-before.png`);
      const afterScreenshotPath = resolve(screenshotDirectory, `step-${stepLabel}-after.png`);
      const beforeBuffer = await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
      screenshots.push(beforeScreenshotPath);
      const before = await observePage(page, [beforeScreenshotPath], `observation-${stepLabel}-before`);
      observations.push(before);
      let decision: AgentDecision;
      try {
        decision = await chooseAgentAction({
          provider, evalCase, observation: before, history: decisions, verifications,
          screenshotDataUrl: `data:image/png;base64,${beforeBuffer.toString('base64')}`,
          allowRemoteModel: provider.info.remote ? Boolean(options.allowRemoteModel) : true,
          allowScreenshot: provider.info.remote ? Boolean(options.allowScreenshotToProvider) : true,
        });
      } catch (providerError) {
        failureSource = 'evaluator';
        error = providerError instanceof Error ? providerError.message : String(providerError);
        status = 'inconclusive';
        break;
      }
      decision = { ...decision, decisionId: `decision-${stepLabel}` };
      let actionResult: AgentActionResult | null = null;
      if (decision.action === 'fill') {
        const field = before.formFields.find((item) => item.elementId === decision.targetElementId);
        if (!field) decision = { ...decision, value: null };
        else {
          const safeInput = generateSafeInput(field, evalCase.knownInformation, page.url());
          if (safeInput.status === 'blocked_by_safety') {
            decision = { ...decision, value: null };
            actionResult = { status: 'blocked_by_safety', action: 'fill', targetElementId: decision.targetElementId, summary: safeInput.reason, evidenceRefs: [beforeScreenshotPath] };
          }
          else decision = { ...decision, value: safeInput.value };
        }
      }
      decisions.push(decision);
      actionResult ??= await executeAgentAction(page, before, decision);
      actionResults.push(actionResult);
      interactions.push(interactionFor(decision, actionResult, interactions.length, performance.now() - monotonicStartedAt, before.pageUrl));
      await page.waitForTimeout(50);
      await page.screenshot({ path: afterScreenshotPath, fullPage: true });
      screenshots.push(afterScreenshotPath);
      const after = await observePage(page, [afterScreenshotPath], `observation-${stepLabel}-after`);
      observations.push(after);
      finalObservation = after;
      actionResult = { ...actionResult, evidenceRefs: [beforeScreenshotPath, afterScreenshotPath] };
      actionResults[actionResults.length - 1] = actionResult;
      interactions[interactions.length - 1] = interactionFor(decision, actionResult, interactions.length - 1, performance.now() - monotonicStartedAt, before.pageUrl);
      const verification = verifyAgentStep(before, after, decision, actionResult, `verification-${stepLabel}`);
      verifications.push(verification);
      stepEvidence.push({
        stepIndex,
        beforeObservationId: before.observationId,
        afterObservationId: after.observationId,
        beforeScreenshotPath,
        afterScreenshotPath,
        decisionId: decision.decisionId!,
        verificationId: verification.verificationId,
        actionStatus: actionResult.status,
      });
      const failedAttempts = verifications.filter((item) => item.status === 'not_confirmed').length;
      const reflection = reflectOnStep({ evalCase, decision, result: actionResult, verification, failedAttempts });
      reflections.push(reflection);
      if (actionResult.status === 'blocked_by_safety') { status = 'blocked_by_safety'; break; }
      if (reflection.nextStep === 'finish') { status = 'completed'; break; }
      if (reflection.nextStep === 'abandon') { status = 'abandoned'; break; }
    }
  } catch (runError) {
    status = 'inconclusive'; failureSource = 'evaluator'; error = runError instanceof Error ? runError.message : String(runError);
  }
  if (!finalObservation) {
    const finalScreenshotPath = resolve(screenshotDirectory, 'final.png');
    try {
      await page.screenshot({ path: finalScreenshotPath, fullPage: true });
      screenshots.push(finalScreenshotPath);
      finalObservation = await observePage(page, [finalScreenshotPath], 'observation-final');
      observations.push(finalObservation);
    } catch (finalEvidenceError) {
      status = 'inconclusive'; failureSource = 'evaluator';
      error = error ?? `最终证据无法保存：${finalEvidenceError instanceof Error ? finalEvidenceError.message : String(finalEvidenceError)}`;
    }
  }
  if (traceStarted) {
    try {
      await page.context().tracing.stop({ path: expectedTracePath });
      if (await pathExists(expectedTracePath)) tracePath = expectedTracePath;
    } catch (traceError) {
      error = error ?? `本地 Trace 无法保存：${traceError instanceof Error ? traceError.message : String(traceError)}`;
    }
  }
  if (!tracePath) { status = 'inconclusive'; failureSource = 'evaluator'; }
  page.off('console', onConsole);
  page.off('response', onResponse);
  const completedAt = now().toISOString();
  const resolvedFinalObservation = finalObservation ?? observations.at(-1) ?? {
    observationId: 'observation-missing', pageUrl: page.url(), pagePurpose: '', visibleStateSummary: '', primaryAreas: [], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: [], confidence: 0,
  };
  const packetWithoutCompleteness = {
    runId, caseId: evalCase.caseId, targetAppCommit: options.targetAppCommit ?? null,
    actorModel: provider.info.model, actorPromptVersion: '1.0.0', startedAt: started.toISOString(), completedAt,
    actions: interactions, observations, stepVerifications: verifications, stepEvidence, screenshots, tracePath,
    consoleEvidence, networkEvidence, finalState: { url: page.url(), visibleTextSummary: resolvedFinalObservation.visibleStateSummary.slice(0, 1_000) },
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
  const packet: EvidencePacket = { ...packetWithoutCompleteness, evidenceCompleteness: calculateEvidenceCompleteness(packetWithoutCompleteness as Omit<EvidencePacket, 'evidenceCompleteness'>) };
  if (!packet.evidenceCompleteness.complete) { status = 'inconclusive'; failureSource = 'evaluator'; error = error ?? packet.evidenceCompleteness.missing.join(' '); }
  const evidencePacketPath = await saveAgentEvidence(options.outputDir, packet, decisions);
  const run: AiTestAgentRun = { runId, caseId: evalCase.caseId, mode: options.mode ?? 'task', status, failureSource, decisions, actionResults, reflections, evidencePacketPath, startedAt: started.toISOString(), completedAt, error };
  await writeJsonAtomic(resolve(runDirectory, 'agent-run.json'), run);
  return run;
}
