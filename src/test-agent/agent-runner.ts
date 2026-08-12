import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { AgentActionResult, AgentDecision, AiTestAgentRun, EvalCase, EvidencePacket, InteractionAction, PageObservation, ReflectionDecision, StepEvidence, StepVerification, WaitPolicy } from '../../types.js';
import type { AiProvider } from '../ai/provider.js';
import { ensureDirectory, pathExists, writeJsonAtomic } from '../utils/file-system.js';
import { actorPromptV1 } from '../prompts/actor.v1.js';
import { chooseAgentAction } from './actor.js';
import { executeAgentAction } from './action-executor.js';
import { calculateEvidenceCompleteness, saveAgentEvidence } from './evidence-packet.js';
import { readFieldInputConstraints } from './field-input-constraints.js';
import { observePage } from './observer.js';
import { reflectOnStep } from './reflector.js';
import { generateSafeInput } from './safe-input-generator.js';
import { verifyAgentStep } from './verifier.js';
import { packageVersion } from '../runtime/paths.js';
import { semanticJudgePromptV1 } from '../prompts/semantic-judge.v1.js';
import { runSemanticStepVerifier } from './semantic-verifier.js';
import { mergeStepVerifications } from './verification-merger.js';
import { reflectOnStepSemantically } from './semantic-reflector.js';
import { verifierPromptV1 } from '../prompts/verifier.v1.js';
import { reflectorPromptV1 } from '../prompts/reflector.v1.js';
import { captureTaskStateSignals } from './task-state-signals.js';
import { gateVerificationByTaskState } from './task-state-monitor.js';
import { classifyOperation } from './operation-classifier.js';
import { consumesPersonaAttempt, waitForProgressAwareOutcome, waitPolicyFor } from './progress-aware-wait.js';
import { initialActionBudget, maybeExtendActionBudget, pageStateFingerprint, repeatedStateCount, runtimeTaskProgress } from './task-progress.js';

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
  useSemanticReflector?: boolean;
  waitTimeoutMs?: number;
  waitPolicy?: Partial<WaitPolicy>;
  now?: () => Date;
}

function inputScreenshotAllowed(remoteProvider: boolean, explicitPermission: boolean | undefined): boolean {
  return remoteProvider ? explicitPermission === true : true;
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
  const coreNetworkFailures: string[] = [];
  const uncaughtErrors: string[] = [];
  const decisionStateFingerprints: string[] = [];
  let actionBudget = initialActionBudget(options.maxSteps);
  let activeRequests = 0;
  let networkResponseCount = 0;
  const onConsole = (message: { type(): string; text(): string }) => { if (message.type() === 'error') consoleEvidence.push(message.text()); };
  const onPageError = (pageError: Error) => { uncaughtErrors.push(pageError.message); consoleEvidence.push(`uncaught: ${pageError.message}`); };
  const onRequest = () => { activeRequests += 1; };
  const onRequestSettled = () => { activeRequests = Math.max(0, activeRequests - 1); };
  const onResponse = (response: { status(): number; url(): string; request(): { resourceType(): string } }) => {
    networkResponseCount += 1;
    if (response.status() < 400) return;
    const failure = `${response.status()} ${response.url()}`;
    networkEvidence.push(failure);
    if (['document', 'xhr', 'fetch'].includes(response.request().resourceType())) coreNetworkFailures.push(failure);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('request', onRequest);
  page.on('requestfinished', onRequestSettled);
  page.on('requestfailed', onRequestSettled);
  page.on('response', onResponse);
  let status: AiTestAgentRun['status'] = 'inconclusive';
  let failureSource: AiTestAgentRun['failureSource'] = null;
  let error: string | null = null;
  const expectedTracePath = resolve(runDirectory, 'trace.zip');
  let tracePath: string | null = null;
  let traceStarted = false;
  let finalObservation: PageObservation | null = null;
  let failedAttempts = 0;
  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    traceStarted = true;
  } catch (traceError) {
    error = `本地 Trace 无法启动：${traceError instanceof Error ? traceError.message : String(traceError)}`;
  }
  try {
    if (page.url() !== options.startingUrl) await page.goto(options.startingUrl, { waitUntil: 'domcontentloaded' });
    for (let step = 0; step < actionBudget.current; step += 1) {
      const stepIndex = step + 1;
      const stepLabel = String(stepIndex).padStart(3, '0');
      const beforeScreenshotPath = resolve(screenshotDirectory, `step-${stepLabel}-before.png`);
      const afterScreenshotPath = resolve(screenshotDirectory, `step-${stepLabel}-after.png`);
      const beforeBuffer = await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
      screenshots.push(beforeScreenshotPath);
      const before = await observePage(page, [beforeScreenshotPath], `observation-${stepLabel}-before`);
      observations.push(before);
      const progress = runtimeTaskProgress({ evalCase, observation: before, verifications, budget: actionBudget, currentStep: step, failedAttempts });
      const consoleStart = consoleEvidence.length;
      const networkStart = networkEvidence.length;
      const coreNetworkFailureStart = coreNetworkFailures.length;
      const uncaughtErrorStart = uncaughtErrors.length;
      let decision: AgentDecision;
      try {
        decision = await chooseAgentAction({
          provider, evalCase, observation: before, history: decisions, verifications, progress,
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
      const decisionStateFingerprint = `${pageStateFingerprint(before)}::${decision.action}:${decision.targetElementId ?? 'none'}`;
      const repeatedAttempts = repeatedStateCount(decisionStateFingerprints, decisionStateFingerprint);
      decisionStateFingerprints.push(decisionStateFingerprint);
      const previousTaskState = stepEvidence.at(-1)?.taskState?.state;
      if (repeatedAttempts >= 3 && verifications.at(-1)?.status !== 'confirmed' && previousTaskState !== 'pending' && previousTaskState !== 'progressing') {
        finalObservation = before;
        failureSource = 'evaluator';
        error = '评测器连续多次在同一页面状态尝试同一个操作且没有形成新证据，已停止本次循环。';
        status = 'inconclusive';
        break;
      }
      let actionResult: AgentActionResult | null = null;
      if (decision.action === 'fill') {
        const field = before.formFields.find((item) => item.elementId === decision.targetElementId);
        if (!field) decision = { ...decision, value: null };
        else {
          const constraints = await readFieldInputConstraints(page, field);
          const safeInput = generateSafeInput(field, evalCase.knownInformation, page.url(), decision.value, constraints);
          if (safeInput.status === 'blocked_by_safety') {
            decision = { ...decision, value: null };
            actionResult = { status: 'blocked_by_safety', action: 'fill', targetElementId: decision.targetElementId, summary: safeInput.reason, evidenceRefs: [beforeScreenshotPath] };
          }
          else decision = { ...decision, value: safeInput.value };
        }
      }
      decisions.push(decision);
      const taskStateBefore = await captureTaskStateSignals(page, decision);
      actionResult ??= await executeAgentAction(page, before, decision);
      const operationType = classifyOperation({ decision, observation: before, evalCase });
      const waitResult = await waitForProgressAwareOutcome({
        page,
        before: taskStateBefore,
        decision,
        actionResult,
        operationType,
        policy: waitPolicyFor(operationType, options.waitPolicy, options.waitTimeoutMs),
        stepIndex,
        readRuntimeSignals: () => ({
          activeRequests,
          responseCount: networkResponseCount,
          coreNetworkFailures: coreNetworkFailures.slice(coreNetworkFailureStart),
          consoleErrors: uncaughtErrors.slice(uncaughtErrorStart),
        }),
      });
      actionResult = { ...actionResult, summary: `${actionResult.summary} ${waitResult.summary}` };
      actionResults.push(actionResult);
      interactions.push(interactionFor(decision, actionResult, interactions.length, performance.now() - monotonicStartedAt, before.pageUrl));
      const afterBuffer = await page.screenshot({ path: afterScreenshotPath, fullPage: true });
      screenshots.push(afterScreenshotPath);
      const after = await observePage(page, [afterScreenshotPath], `observation-${stepLabel}-after`);
      observations.push(after);
      finalObservation = after;
      actionResult = { ...actionResult, evidenceRefs: [beforeScreenshotPath, afterScreenshotPath] };
      actionResults[actionResults.length - 1] = actionResult;
      interactions[interactions.length - 1] = interactionFor(decision, actionResult, interactions.length - 1, performance.now() - monotonicStartedAt, before.pageUrl);
      const taskState = { ...waitResult.taskState, evidenceRefs: [...new Set([...waitResult.taskState.evidenceRefs, beforeScreenshotPath, afterScreenshotPath])] };
      const deterministicVerification = verifyAgentStep(before, after, decision, actionResult, `verification-${stepLabel}`);
      const screenshotAllowed = inputScreenshotAllowed(provider.info.remote, options.allowScreenshotToProvider);
      const semanticVerification = actionResult.status === 'executed'
        ? await runSemanticStepVerifier({
          provider,
          decision,
          before,
          after,
          actionResult,
          networkDelta: networkEvidence.slice(networkStart),
          consoleDelta: consoleEvidence.slice(consoleStart),
          beforeScreenshotDataUrl: `data:image/png;base64,${beforeBuffer.toString('base64')}`,
          afterScreenshotDataUrl: `data:image/png;base64,${afterBuffer.toString('base64')}`,
          allowRemoteModel: provider.info.remote ? Boolean(options.allowRemoteModel) : true,
          allowScreenshot: screenshotAllowed,
        })
        : { status: 'inconclusive' as const, observed: actionResult.summary, confirmedFacts: [], unknowns: ['动作未执行，未调用语义验证器。'], evidenceRefs: actionResult.evidenceRefs, confidence: 1 };
      const mergedVerification = mergeStepVerifications({ deterministic: deterministicVerification, semantic: semanticVerification, hardFailure: actionResult.status === 'failed', expectation: decision.expectedResult, visualEvidenceIncluded: screenshotAllowed });
      const verification = gateVerificationByTaskState(mergedVerification, taskState);
      const consumedPersonaAttempt = consumesPersonaAttempt(taskState, verification.status);
      if (consumedPersonaAttempt) failedAttempts += 1;
      const taskWait = {
        ...waitResult.taskWait,
        observations: waitResult.taskWait.observations.map((observation, index, all) => index === all.length - 1 ? taskState : observation),
        consumedPersonaAttempt,
      };
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
        taskState,
        taskWait,
      });
      actionBudget = maybeExtendActionBudget({ budget: actionBudget, stepIndex, taskState, verification });
      const retryAttempts = decisions.filter((item) => item.action === decision.action && item.targetElementId === decision.targetElementId).length;
      const deterministicReflection = reflectOnStep({ evalCase, decision, result: actionResult, verification, taskState, failedAttempts, retryAttempts });
      const semanticReflection = options.useSemanticReflector
        ? await reflectOnStepSemantically({ provider, evalCase, decision, result: actionResult, verification, taskState, failedAttempts, retryAttempts, history: reflections, allowRemoteModel: provider.info.remote ? Boolean(options.allowRemoteModel) : true })
        : null;
      const reflection = semanticReflection ?? deterministicReflection;
      reflections.push(reflection);
      if (actionResult.status === 'blocked_by_safety') { status = 'blocked_by_safety'; break; }
      if (reflection.nextStep === 'finish') { status = 'completed'; break; }
      if (reflection.nextStep === 'abandon') { status = 'abandoned'; break; }
    }
  } catch (runError) {
    status = 'inconclusive'; failureSource = 'evaluator'; error = runError instanceof Error ? runError.message : String(runError);
  }
  if (status === 'inconclusive' && !error && decisions.length >= actionBudget.current) {
    failureSource = 'evaluator';
    error = actionBudget.current < actionBudget.hard
      ? `评测器在 ${actionBudget.current} 个操作内没有观察到足够进展，因此没有继续扩大操作预算。`
      : `评测器达到 ${actionBudget.hard} 个安全操作上限，任务仍未完成。`;
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
  page.off('pageerror', onPageError);
  page.off('request', onRequest);
  page.off('requestfinished', onRequestSettled);
  page.off('requestfailed', onRequestSettled);
  page.off('response', onResponse);
  const completedAt = now().toISOString();
  const resolvedFinalObservation = finalObservation ?? observations.at(-1) ?? {
    observationId: 'observation-missing', pageUrl: page.url(), pagePurpose: '', visibleStateSummary: '', primaryAreas: [], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: [], confidence: 0,
  };
  const packetWithoutCompleteness = {
    runId, caseId: evalCase.caseId, targetAppCommit: options.targetAppCommit ?? null,
    actorModel: provider.info.model, actorPromptVersion: actorPromptV1.version, startedAt: started.toISOString(), completedAt,
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
      actorPromptVersion: actorPromptV1.version,
      judgePromptVersion: semanticJudgePromptV1.version,
      verifierPromptVersion: verifierPromptV1.version,
      reflectorPromptVersion: options.useSemanticReflector ? reflectorPromptV1.version : null,
      toolSchemaVersion: '1.3.0',
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
