import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  EvalPilotConfig,
  ExploratoryScenario,
  FeatureJourneyGraph,
  FrictionEvent,
  InteractionAction,
  JourneyBreakpoint,
  Persona,
  SimulatedUserMetrics,
  UxEvaluationResult,
  UxIssue,
} from '../../types.js';
import { recordBrowserErrors } from '../browser/network-recorder.js';
import {
  exploratoryScenarioSchema,
  featureJourneyGraphSchema,
  interactionActionSchema,
  journeyBreakpointSchema,
} from '../schemas/ux-evaluation.js';
import { EvalPilotError } from '../utils/errors.js';
import {
  ensureDirectory,
  readJsonLinesFile,
  readYamlFile,
  writeJsonAtomic,
  writeJsonLinesAtomic,
  writeTextAtomic,
} from '../utils/file-system.js';
import { analyzeAbandonment } from './abandonment-detector.js';
import { analyzeClosure } from './closure-analyzer.js';
import { buildExplorationContext } from './exploratory-context.js';
import { detectFrictions } from './friction-detector.js';
import { calculateInteractionMetrics } from './interaction-recorder.js';
import { compareJourneys } from './journey-comparison.js';
import { repeatedInputActionIds } from './repeated-input-detector.js';
import {
  chooseSemanticTarget,
  evaluateVisibleConditions,
  semanticTargetKey,
  type SemanticTarget,
} from './semantic-explorer.js';
import { buildUxIssue, gradeUx, renderUxReport } from './ux-report-builder.js';
import { evidenceItemsFromPaths } from '../dashboard/issue-presenter.js';

export interface ExploratoryRunOptions {
  browser?: Browser;
  now?: () => Date;
  runId?: string;
  onAction?: (action: InteractionAction) => void;
  beforeAction?: () => Promise<void>;
  signal?: AbortSignal;
}

export interface ExploratoryRunSummary {
  runId: string;
  runDirectory: string;
  scenario: ExploratoryScenario;
  actions: InteractionAction[];
  metrics: SimulatedUserMetrics;
  comparison: ReturnType<typeof compareJourneys>;
  frictions: FrictionEvent[];
  breakpoints: JourneyBreakpoint[];
  evaluation: UxEvaluationResult;
  issues: UxIssue[];
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function targetUrl(startingUrl: string, baseUrl: string): string {
  if (/^https?:/.test(startingUrl)) {
    const original = new URL(startingUrl); const base = new URL(baseUrl);
    const local = new Set(['localhost', '127.0.0.1', '::1']);
    if (local.has(original.hostname) && local.has(base.hostname) && original.origin !== base.origin) return new URL(`${original.pathname}${original.search}${original.hash}`, `${base.origin}/`).toString();
    return startingUrl;
  }
  return /^(data:|about:)/.test(startingUrl) ? startingUrl : new URL(startingUrl, `${baseUrl}/`).toString();
}

async function collectSemanticTargets(page: Page): Promise<SemanticTarget[]> {
  const targets = await page.locator('a,button,[role="button"],input,textarea,select').evaluateAll((elements) => elements.flatMap((element, index) => {
    const html = element as HTMLElement;
    const style = window.getComputedStyle(html);
    const rect = html.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0 || rect.height === 0) return [];
    const tag = html.tagName.toLowerCase();
    const kind = tag === 'a' ? 'link' : tag === 'input' ? 'input' : tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'button';
    const label = (
      html.getAttribute('aria-label')
      ?? html.innerText
      ?? html.getAttribute('placeholder')
      ?? html.getAttribute('name')
      ?? ''
    ).trim();
    return [{
      index,
      kind,
      label,
      disabled: (html as HTMLButtonElement | HTMLInputElement).disabled === true || html.getAttribute('aria-disabled') === 'true',
    }];
  }));
  return targets as SemanticTarget[];
}

function action(
  actions: InteractionAction[],
  value: Omit<InteractionAction, 'actionId'>,
  onRecorded?: (action: InteractionAction) => void,
): InteractionAction {
  const parsed = interactionActionSchema.parse({ ...value, actionId: `action-${String(actions.length + 1).padStart(3, '0')}` });
  actions.push(parsed);
  onRecorded?.(parsed);
  return parsed;
}

async function screenshotEvidence(page: Page, directory: string, actionCount: number): Promise<string[]> {
  const path = resolve(directory, 'screenshots', `action-${String(actionCount).padStart(3, '0')}.png`);
  try {
    await page.screenshot({ path, fullPage: true });
    return [path];
  } catch {
    return [];
  }
}

function breakpointsFromFrictions(frictions: FrictionEvent[]): JourneyBreakpoint[] {
  return frictions
    .filter((friction) => friction.type === 'journey_breakpoint' || friction.type === 'abandonment_risk')
    .map((friction, index) => journeyBreakpointSchema.parse({
      breakpointId: `breakpoint-${friction.featureId}-${index + 1}`,
      featureId: friction.featureId,
      journeyStage: friction.step,
      persona: friction.persona,
      observedBehavior: friction.observedBehavior,
      expectedBehavior: '用户应能继续、恢复或明确结束任务',
      userImpact: friction.type === 'abandonment_risk' ? '用户可能在完成目标前放弃。' : '用户无法证明完整闭环。',
      evidence: friction.evidence,
      severity: friction.severity,
      confidence: friction.confidence,
    }));
}

async function loadInputs(config: EvalPilotConfig, caseId?: string): Promise<{
  scenario: ExploratoryScenario;
  persona: Persona;
  graph: FeatureJourneyGraph;
}> {
  try {
    const scenarios = (await readJsonLinesFile<ExploratoryScenario>(resolve(config.outputDir, 'exploratory-scenarios.jsonl')))
      .map((item) => exploratoryScenarioSchema.parse(item));
    const scenario = caseId ? scenarios.find((item) => item.caseId === caseId) : scenarios[0];
    if (!scenario) throw new EvalPilotError(`没有找到探索案例${caseId ? `：${caseId}` : ''}`, 'CASE_NOT_FOUND');
    const personas = await readJsonLinesFile<Persona>(resolve(config.outputDir, 'personas.jsonl'));
    const persona = personas.find((item) => item.personaId === scenario.personaId);
    if (!persona) throw new EvalPilotError(`探索案例缺少 Persona：${scenario.personaId}`, 'PERSONA_NOT_FOUND');
    const graph = featureJourneyGraphSchema.parse(await readYamlFile(
      resolve(config.outputDir, 'journeys', `${safeSegment(scenario.capability)}.yaml`),
    ));
    return { scenario, persona, graph };
  } catch (error) {
    if (error instanceof EvalPilotError) throw error;
    throw new EvalPilotError(`探索运行所需文件缺失或损坏：${String(error)}`, 'EXPLORATORY_INPUT_INVALID');
  }
}

export async function runExploratoryScenario(
  config: EvalPilotConfig,
  caseId?: string,
  options: ExploratoryRunOptions = {},
): Promise<ExploratoryRunSummary> {
  const { scenario, persona, graph } = await loadInputs(config, caseId);
  const context = buildExplorationContext(scenario, persona);
  const now = options.now ?? (() => new Date());
  const started = now();
  const runId = options.runId ?? `run-exploratory-${started.toISOString().replace(/[:.]/g, '-')}-${safeSegment(scenario.caseId)}`;
  const runDirectory = resolve(config.outputDir, 'runs', runId);
  const tracePath = resolve(runDirectory, 'trace.zip');
  await ensureDirectory(resolve(runDirectory, 'screenshots'));

  const actions: InteractionAction[] = [];
  const visited = new Set<string>();
  let failedAttempts = 0;
  let abandonment = { abandoned: false, reason: null as string | null, step: null as string | null };
  let browser: Browser;
  let ownBrowser = false;
  try {
    browser = options.browser ?? await chromium.launch({ headless: true });
    ownBrowser = !options.browser;
  } catch (error) {
    throw new EvalPilotError(`Chromium 无法启动，探索运行被阻塞：${String(error)}`, 'BROWSER_BLOCKED');
  }

  let browserContext: BrowserContext | null = null;
  let page: Page | null = null;
  let consoleErrors: { message: string }[] = [];
  let functionalStatus: 'passed' | 'failed' | 'blocked' = 'passed';
  let finalVisibleText = '';
  let finalEvidence: string[] = [];

  try {
    browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await browserContext.newPage();
    const recording = recordBrowserErrors(page);
    try {
      const startUrl = targetUrl(context.startingUrl, config.targetUrl);
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(250);
      const evidence = await screenshotEvidence(page, runDirectory, actions.length + 1);
      action(actions, {
        type: 'navigation', timestampMs: Date.now() - started.getTime(), page: page.url(), target: context.startingUrl,
        inputField: null, inputLength: null, inputFingerprint: null, outcome: 'started_from_declared_url', evidence,
      }, options.onAction);

      while (actions.length < context.abandonmentPolicy.maxTotalActions) {
        await options.beforeAction?.();
        if (options.signal?.aborted) {
          abandonment = { abandoned: true, reason: '运行已由用户停止，已有轨迹将被保留', step: actions.at(-1)?.actionId ?? null };
          action(actions, {
            type: 'abandon', timestampMs: Date.now() - started.getTime(), page: page.url(), target: null,
            inputField: null, inputLength: null, inputFingerprint: null, outcome: abandonment.reason ?? '运行已停止',
            evidence: await screenshotEvidence(page, runDirectory, actions.length + 1),
          }, options.onAction);
          break;
        }
        finalVisibleText = await page.locator('body').innerText().catch(() => '');
        const conditionState = evaluateVisibleConditions(finalVisibleText, context.successConditions);
        if (conditionState.complete) break;

        const targets = await collectSemanticTargets(page);
        const target = chooseSemanticTarget(targets, `${context.goal} ${conditionState.missing.join(' ')}`, visited);
        if (!target) {
          abandonment = { abandoned: true, reason: '当前页面没有与目标相关且安全的未尝试操作', step: actions.at(-1)?.actionId ?? null };
          action(actions, {
            type: 'abandon', timestampMs: Date.now() - started.getTime(), page: page.url(), target: null,
            inputField: null, inputLength: null, inputFingerprint: null, outcome: abandonment.reason ?? 'abandoned', evidence: await screenshotEvidence(page, runDirectory, actions.length + 1),
          }, options.onAction);
          break;
        }
        visited.add(semanticTargetKey(target));

        if (target.kind === 'input' || target.kind === 'textarea' || target.kind === 'select') {
          action(actions, {
            type: 'hesitation', timestampMs: Date.now() - started.getTime(), page: page.url(), target: target.label,
            inputField: target.label, inputLength: null, inputFingerprint: null,
            outcome: 'known_information_does_not_contain_a_safe_value', evidence: await screenshotEvidence(page, runDirectory, actions.length + 1),
          }, options.onAction);
          continue;
        }

        const beforeUrl = page.url();
        const beforeText = finalVisibleText;
        try {
          await page.locator('a,button,[role="button"],input,textarea,select').nth(target.index).click({ timeout: 5_000 });
          await page.waitForTimeout(350);
          const afterText = await page.locator('body').innerText().catch(() => '');
          const changed = beforeUrl !== page.url() || beforeText !== afterText;
          const evidence = await screenshotEvidence(page, runDirectory, actions.length + 1);
          action(actions, {
            type: 'click', timestampMs: Date.now() - started.getTime(), page: beforeUrl, target: target.label,
            inputField: null, inputLength: null, inputFingerprint: null,
            outcome: changed ? 'observable_feedback' : 'no_feedback', evidence,
          }, options.onAction);
          if (beforeUrl !== page.url()) {
            action(actions, {
              type: 'navigation', timestampMs: Date.now() - started.getTime(), page: page.url(), target: target.label,
              inputField: null, inputLength: null, inputFingerprint: null, outcome: 'navigated_after_semantic_choice', evidence,
            }, options.onAction);
          }
        } catch (error) {
          failedAttempts += 1;
          action(actions, {
            type: 'error', timestampMs: Date.now() - started.getTime(), page: page.url(), target: target.label,
            inputField: null, inputLength: null, inputFingerprint: null,
            outcome: `semantic_action_failed:${error instanceof Error ? error.message : String(error)}`,
            evidence: await screenshotEvidence(page, runDirectory, actions.length + 1),
          }, options.onAction);
        }

        abandonment = analyzeAbandonment({
          actions,
          failedAttempts,
          clarificationTurns: actions.filter((item) => /clarification/.test(item.outcome)).length,
          idleTimeMs: 0,
          policy: context.abandonmentPolicy,
        });
        if (abandonment.abandoned) {
          action(actions, {
            type: 'abandon', timestampMs: Date.now() - started.getTime(), page: page.url(), target: null,
            inputField: null, inputLength: null, inputFingerprint: null, outcome: abandonment.reason ?? 'abandoned',
            evidence: await screenshotEvidence(page, runDirectory, actions.length + 1),
          }, options.onAction);
          break;
        }
      }
      finalVisibleText = await page.locator('body').innerText().catch(() => '');
      finalEvidence = await screenshotEvidence(page, runDirectory, actions.length + 1);
      consoleErrors = recording.consoleErrors.map((item) => ({ message: item.message }));
    } finally {
      recording.dispose();
    }
  } catch (error) {
    functionalStatus = page ? 'failed' : 'blocked';
    if (page) {
      action(actions, {
        type: 'error', timestampMs: Date.now() - started.getTime(), page: page.url(), target: null,
        inputField: null, inputLength: null, inputFingerprint: null,
        outcome: error instanceof Error ? error.message : String(error), evidence: await screenshotEvidence(page, runDirectory, actions.length + 1),
      }, options.onAction);
    }
  } finally {
    if (browserContext) {
      try { await browserContext.tracing.stop({ path: tracePath }); } catch { /* result stays honest through missing trace evidence */ }
      await browserContext.close();
    }
    if (ownBrowser) await browser.close();
  }

  const visibleConditions = evaluateVisibleConditions(finalVisibleText, context.successConditions);
  const followUpVisible = /保存|修改|导出|分享|继续|完成|结束|save|edit|export|share|continue|finish/i.test(finalVisibleText);
  const closure = analyzeClosure({
    technical: { conditions: graph.completionDefinition.technical.conditions, evidence: [tracePath], satisfied: functionalStatus === 'passed' },
    interface: { conditions: graph.completionDefinition.interface.conditions, evidence: finalEvidence, satisfied: functionalStatus === 'passed' && consoleErrors.length === 0 },
    userGoal: { conditions: context.successConditions, evidence: visibleConditions.complete ? finalEvidence : [], satisfied: visibleConditions.complete },
    followUp: { conditions: graph.completionDefinition.followUp.conditions, evidence: followUpVisible ? finalEvidence : [], satisfied: followUpVisible },
  });
  const repeated = new Set(repeatedInputActionIds(actions));
  const requiredActionIds = actions.filter((item) => item.type === 'navigation' || item.type === 'click' || item.type === 'input').map((item) => item.actionId);
  const redundantActionIds = actions.filter((item) => repeated.has(item.actionId) || item.type === 'backtrack').map((item) => item.actionId);
  const metrics = calculateInteractionMetrics(actions, {
    completion: closure.completion,
    requiredActionIds,
    redundantActionIds,
    abandoned: abandonment.abandoned,
    abandonmentReason: abandonment.reason,
  });
  const comparison = compareJourneys(graph, actions, metrics, runId);
  const frictions = detectFrictions({ featureId: graph.featureId, personaId: persona.personaId, actions, metrics, completion: closure.completion });
  const breakpoints = breakpointsFromFrictions(frictions);
  const evaluation = gradeUx({ runId, functionalStatus, completion: closure.completion, metrics, frictions, directEvidence: [tracePath, ...finalEvidence] });
  const actualPath = actions.map((item) => item.target ?? item.outcome);
  const shortestPath = graph.steps.filter((step) => ['required', 'safety', 'explanation'].includes(step.type)).map((step) => step.label);
  const issues = frictions.map((friction) => {
    const actionIndex = actions.findIndex((item) => item.actionId === friction.step);
    const relatedAction = actionIndex >= 0 ? actions[actionIndex] : null;
    const recommendation = friction.type === 'repeated_input_issue'
      ? '复用已经提供的信息；仅在安全或业务条件变化时要求重新确认。'
      : '根据对应轨迹和页面证据补齐入口、反馈、恢复或下一步。';
    return buildUxIssue(evaluation, friction, {
      featureId: graph.featureId,
      personaId: persona.personaId,
      caseId: scenario.caseId,
      userGoal: scenario.goal,
      idealPath: graph.primaryPath,
      actualPath,
      shortestReasonablePath: shortestPath,
      failureOrAbandonmentPoint: abandonment.step,
      metrics,
      evidence: friction.evidence,
      recommendation,
      protectedSafetySteps: graph.steps.filter((step) => step.type === 'safety').map((step) => step.label),
      addedToRegression: false,
      location: { page: friction.page, stepIndex: actionIndex >= 0 ? actionIndex : null, stepLabel: relatedAction?.target ?? relatedAction?.outcome ?? friction.step, target: relatedAction?.target ?? null, sourceFile: null },
      evidenceItems: evidenceItemsFromPaths(friction.evidence, actionIndex >= 0 ? actionIndex : null),
      causeHypothesis: friction.possibleUserReason.replace(/^推测：/, ''),
      resolutionSteps: [recommendation, relatedAction?.target ? `优先检查“${relatedAction.target}”操作后的页面状态和反馈。` : '优先检查失败步骤附近的主操作、反馈和恢复入口。'],
      verificationSteps: [`复跑“${scenario.goal}”这条用户任务，确认原卡点不再出现。`, '确认结果页仍有清晰下一步，且安全确认没有被删除。'],
    });
  });

  await Promise.all([
    writeJsonLinesAtomic(resolve(runDirectory, 'interactions.jsonl'), actions),
    writeJsonAtomic(resolve(runDirectory, 'ux-metrics.json'), metrics),
    writeJsonAtomic(resolve(runDirectory, 'journey-comparison.json'), comparison),
    writeJsonLinesAtomic(resolve(runDirectory, 'frictions.jsonl'), frictions),
    writeJsonLinesAtomic(resolve(runDirectory, 'breakpoints.jsonl'), breakpoints),
    writeJsonAtomic(resolve(runDirectory, 'ux-evaluation.json'), evaluation),
    writeJsonLinesAtomic(resolve(config.outputDir, 'reports', 'ux-issues.jsonl'), issues),
    writeTextAtomic(resolve(config.outputDir, 'reports', 'LATEST_UX_REPORT.md'), renderUxReport(evaluation, issues)),
    writeJsonAtomic(resolve(runDirectory, 'summary.json'), {
      type: 'exploratory_user_journey', runId, caseId: scenario.caseId, functionalStatus,
      taskCompleted: metrics.taskCompleted, fullLoopCompleted: metrics.fullLoopCompleted,
      abandoned: metrics.abandoned, actionCount: actions.length, completedAt: new Date().toISOString(),
    }),
  ]);

  return { runId, runDirectory, scenario, actions, metrics, comparison, frictions, breakpoints, evaluation, issues };
}
