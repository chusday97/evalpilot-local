import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { AiStructuredRequest, EvalCase } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runBlindExperienceCase } from '../src/ux-evaluation/blind-experience-service.js';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

const targetUrl = arg('--url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const outputDir = resolve(arg('--output', 'blind-experience-output'));
const pinnedCommit = '8663b469c50605529367daf1b69ac0cd7cfb0cac';
const oracleOnlyMarker = 'SECRET_ORACLE_ONLY_MARKER_DO_NOT_SEND_TO_ACTOR';
await mkdir(outputDir, { recursive: true });

const persona: EvalCase['persona'] = {
  personaId: 'persona-blind-new-user',
  name: '首次使用 AquaGuide 的普通用户',
  knowledgeLevel: 'low',
  patienceTurns: 4,
  retryTolerance: 1,
  privacySensitivity: 'medium',
  behaviorPolicy: [
    '只依据当前可见界面、自己的目标和已知信息行动',
    '优先选择语义上最接近当前目标的安全入口',
    '看不到可靠下一步时允许退出，不凭空猜测隐藏状态',
  ],
  exitConditions: ['连续尝试没有进展时退出', '需要危险或未知信息时退出'],
};

function makeCase(input: {
  caseId: string;
  capabilityId: string;
  taskId: string;
  title: string;
  goal: string;
  knownInformation: Record<string, unknown>;
  assertions: EvalCase['oracle']['deterministicAssertions'];
}): EvalCase {
  const now = '2026-08-15T00:00:00.000Z';
  return {
    caseId: input.caseId,
    projectId: 'aquaguide-blind-experience',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'Pinned AquaGuide blind experience contract' },
    capabilityId: input.capabilityId,
    taskId: input.taskId,
    title: input.title,
    hypothesis: `Blind user can complete: ${input.goal}`,
    persona,
    goal: input.goal,
    knownInformation: input.knownInformation,
    preconditions: [],
    oracle: {
      expectedOutcome: [`独立 Judge 验证：${input.goal}`, oracleOnlyMarker],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: [`用户是否真实完成：${input.goal}`, oracleOnlyMarker],
      deterministicAssertions: input.assertions,
      inconclusiveWhen: ['没有足够可见证据确认成功或产品失败'],
    },
    coverageDimensions: [{ dimension: 'capability', value: input.capabilityId }],
    riskLevel: 'P1',
    generationReason: 'Dedicated blind experience acceptance',
    version: 1,
    stats: {
      passCount: 0, failCount: 0, inconclusiveCount: 0,
      latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null,
    },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

const cases: EvalCase[] = [
  makeCase({
    caseId: 'blind-create-usable-aquarium', capabilityId: 'cap-create-aquarium', taskId: 'task-create-usable-aquarium',
    title: '创建一个可用淡水鱼缸', goal: '创建一个 60×30×30cm 的淡水鱼缸并保存',
    knownInformation: { lengthCm: 60, widthCm: 30, heightCm: 30, waterType: 'freshwater' },
    assertions: [
      { assertionId: 'blind-create-size', type: 'text_visible', target: '60x30x30cm', expected: true, negated: false },
      { assertionId: 'blind-create-water', type: 'text_visible', target: '淡水', expected: true, negated: false },
      { assertionId: 'blind-create-modal-closed', type: 'text_absent', target: 'Save Settings', expected: true, negated: false },
    ],
  }),
  makeCase({
    caseId: 'blind-record-existing-livestock', capabilityId: 'cap-record-livestock', taskId: 'task-record-existing-livestock',
    title: '记录已有生物', goal: '把一只 Corydoras aeneus 记录到当前鱼缸并保存',
    knownInformation: { scientificName: 'Corydoras aeneus', quantity: 1 },
    assertions: [
      { assertionId: 'blind-record-species', type: 'text_visible', target: 'Corydoras aeneus x 1', expected: true, negated: false },
      { assertionId: 'blind-record-persisted', type: 'text_visible', target: 'Recorded', expected: true, negated: false },
    ],
  }),
  makeCase({
    caseId: 'blind-daily-check-risk', capabilityId: 'cap-daily-check', taskId: 'task-daily-check-risk',
    title: '完成每日检查并查看风险结果', goal: '完成每日检查：鱼经常浮头，其余观察正常，并查看系统给出的风险和下一步动作',
    knownInformation: {
      respiration: '经常浮头', waterClarity: '清澈', surface: '没有泡沫或油膜',
      odor: '没有异味', behavior: '正常游动和进食', recentOperation: '没有特别操作',
    },
    assertions: [
      { assertionId: 'blind-daily-risk', type: 'text_visible', target: 'Act now', expected: true, negated: false },
      { assertionId: 'blind-daily-action', type: 'text_visible', target: '增加打氧或水面扰动', expected: true, negated: false },
    ],
  }),
];

function label(item: any): string {
  return String(item?.label ?? item?.text ?? '');
}

function button(input: any, pattern: RegExp) {
  return (input.observation?.interactableElements ?? []).find((item: any) =>
    !item.disabled && item.tagName === 'button' && pattern.test(label(item)));
}

function click(input: any, pattern: RegExp, intentSummary: string, expectedResult: string, confidence = 0.9) {
  const target = button(input, pattern);
  return target
    ? { intentSummary, action: 'click', targetElementId: target.elementId, value: null, expectedResult, confidence }
    : null;
}

function finish(intentSummary: string, expectedResult: string) {
  return { intentSummary, action: 'finish', targetElementId: null, value: null, expectedResult, confidence: 0.98 };
}

function abandon(intentSummary: string) {
  return { intentSummary, action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留当前页面证据', confidence: 0.55 };
}

function actorDecision(input: any) {
  const goal = String(input.goal ?? '');
  const observation = input.observation ?? {};
  const visible = String(observation.visibleStateSummary ?? '');
  const pageUrl = String(observation.pageUrl ?? '');

  if (/Loading AquaGuide/i.test(visible)) {
    return { intentSummary: '页面仍在初始化，先等待可操作内容', action: 'wait', targetElementId: null, value: null, expectedResult: '出现可操作内容', confidence: 0.95 };
  }

  if (goal.includes('60×30×30') && goal.includes('淡水')) {
    if (/60x30x30cm/i.test(visible) && /淡水|Freshwater/i.test(visible) && !/Save Settings/.test(visible)) {
      return finish('自己的目标尺寸和淡水状态已在鱼缸主页面可见', '当前可见状态与建缸目标一致');
    }
    if (pageUrl.includes('/welcome')) {
      return click(input, /Build your first aquarium|建立第一个鱼缸/, '选择与建立第一个鱼缸最直接相关的入口', '进入鱼缸创建流程')
        ?? abandon('欢迎页没有找到与建缸目标匹配的入口');
    }
    const controls = observation.interactableElements ?? [];
    const settingsOpen = controls.some((item: any) => /Save Settings|保存设置/.test(label(item)));
    if (!settingsOpen) {
      return click(input, /Create or configure a tank|Build or complete aquarium|建立或完善鱼缸|Tank Settings|鱼缸设置/, '选择建缸/鱼缸设置入口', '出现尺寸和水体设置')
        ?? abandon('鱼缸主页面没有找到可建立或设置鱼缸的入口');
    }
    const numberFields = (observation.formFields ?? []).filter((field: any) => field.inputType === 'number' && !field.disabled);
    const empty = numberFields.find((field: any) => !field.currentValuePresent);
    if (empty) {
      const index = numberFields.indexOf(empty);
      return {
        intentSummary: `填写自己已知的第 ${index + 1} 个尺寸`, action: 'fill', targetElementId: empty.elementId,
        value: index === 0 ? '60' : '30', expectedResult: '该尺寸字段保留输入值', confidence: 0.95,
      };
    }
    const dimensions = button(input, /Dimensions|尺寸/);
    if (numberFields.length < 3 && dimensions && /Incomplete dimensions|尺寸未记录/.test(label(dimensions))) {
      return { intentSummary: '尺寸尚未记录，打开尺寸设置', action: 'click', targetElementId: dimensions.elementId, value: null, expectedResult: '显示长宽高输入框', confidence: 0.9 };
    }
    const freshwater = button(input, /淡水|Freshwater/);
    if (freshwater && !/海水|Saltwater/.test(label(freshwater))) {
      return { intentSummary: '选择自己已知的淡水类型', action: 'click', targetElementId: freshwater.elementId, value: null, expectedResult: '水体类型变为淡水', confidence: 0.95 };
    }
    const parameters = button(input, /Parameters|参数/);
    if (parameters && /Water type unknown|水体未记录/.test(label(parameters))) {
      return { intentSummary: '水体类型尚未记录，打开参数设置', action: 'click', targetElementId: parameters.elementId, value: null, expectedResult: '出现水体类型选项', confidence: 0.9 };
    }
    return click(input, /Save Settings|保存设置/, '已填写自己的尺寸和水体信息，保存设置', '返回主页面并保留配置')
      ?? abandon('设置已填写但找不到保存入口');
  }

  if (goal.includes('Corydoras aeneus')) {
    if (/Recorded/.test(visible) && /Corydoras aeneus x 1/.test(visible)) {
      return finish('页面明确显示 Recorded 和自己的目标物种数量', '目标生物已经保存到当前鱼缸');
    }
    const search = (observation.formFields ?? []).find((field: any) =>
      /Search fish, shrimp, snails|搜索鱼、虾、螺/.test(String(field.placeholder ?? field.label ?? '')));
    if (search) {
      if (!search.currentValuePresent) {
        return { intentSummary: '用自己知道的学名搜索生物', action: 'fill', targetElementId: search.elementId, value: 'Corydoras aeneus', expectedResult: '出现目标物种候选', confidence: 0.95 };
      }
      const save = click(input, /^保存到鱼缸$|Save to.*tank/i, '把选中的已有生物保存到当前鱼缸', '页面确认记录已保存');
      if (save) return save;
      const species = click(input, /Corydoras aeneus/, '选择与自己目标学名一致的候选', '出现可保存的记录详情');
      if (species) return species;
      return abandon('记录流程已打开，但搜索后没有找到目标物种或保存入口');
    }
    // Main aquarium page also contains the text “Record Existing Livestock”. Presence of the
    // label therefore means the entry is discoverable and should be clicked; it does NOT mean
    // the recording flow is already open. The search field above is the flow-state signal.
    return click(input, /Record Existing Livestock|记录已有生物/, '从鱼缸主页选择记录已有生物入口', '打开已有生物记录流程')
      ?? abandon('鱼缸主页面没有找到与记录已有生物目标匹配的入口');
  }

  if (goal.includes('每日检查')) {
    if (/Act now/.test(visible) && /增加打氧或水面扰动|立刻增加打氧或水面扰动/.test(visible)) {
      return finish('风险等级和立即动作已经在结果页可见', '当前结果回答了自己的每日检查目标');
    }
    if (/Daily Aquarium Check/.test(visible)) {
      const answers = ['经常浮头', '清澈', '没有泡沫或油膜', '没有异味', '正常游动和进食', '没有特别操作'];
      const progress = visible.match(/(?:^|\s)([0-6])\s*\/\s*6(?:\s|$)/);
      const answered = progress ? Number(progress[1]) : 0;
      if (answered < answers.length) {
        const answer = answers[answered]!;
        const choice = click(input, new RegExp(`^${answer}$`), `按自己的观察回答第 ${answered + 1} 项：${answer}`, `检查进度进入 ${answered + 1} / 6`, 0.95);
        if (choice) return choice;
      }
      return click(input, /Generate Results|生成检查结果/, '六项观察已经回答，生成风险结果', '显示风险等级和下一步动作')
        ?? abandon('每日检查已打开，但找不到当前问题选项或生成结果入口');
    }
    return click(input, /Start today.?s check|开始.*检查|每日检查/, '从鱼缸主页选择今天的检查入口', '打开每日鱼缸检查')
      ?? abandon('鱼缸主页面没有找到与每日检查目标匹配的入口');
  }

  return abandon('当前页面没有与目标足够相关且安全的下一步');
}

const actorRequests: Array<{ caseId: string; markerPresent: boolean }> = [];
const judgeRequests: Array<{ caseId: string; markerPresent: boolean }> = [];

function responder(request: AiStructuredRequest) {
  let input: any = {};
  try { input = JSON.parse(request.userPrompt); } catch { input = {}; }

  if (request.schemaName === 'agent_decision') {
    actorRequests.push({ caseId: String(request.metadata.caseId ?? 'unknown'), markerPresent: request.userPrompt.includes(oracleOnlyMarker) });
    return actorDecision(input);
  }
  if (request.schemaName === 'semantic_step_verification') {
    const changed = input.before?.summary !== input.after?.summary
      || (input.networkDelta ?? []).length > 0
      || (input.consoleDelta ?? []).length > 0;
    return {
      status: changed || input.action?.action === 'finish' ? 'confirmed' : 'not_confirmed',
      observed: changed ? '动作后页面出现稳定可见变化。' : '动作前后没有稳定可见变化。',
      confirmedFacts: changed ? ['页面状态已变化'] : ['页面状态未变化'],
      unknowns: [], evidenceRefs: [], confidence: 0.95,
    };
  }
  if (request.schemaName === 'semantic_judge_result') {
    judgeRequests.push({ caseId: String(request.metadata.caseId ?? 'unknown'), markerPresent: request.userPrompt.includes(oracleOnlyMarker) });
    const deterministic = input.deterministic ?? {};
    if (deterministic.hardFailure) {
      return {
        verdict: 'fail', taskCompletion: 'failed', summary: '确定性证据确认任务失败。',
        whatWorked: [], whatFailed: ['成功条件未成立'], whyItMatters: ['用户目标没有完成'],
        confirmedFacts: ['确定性断言失败'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95,
      };
    }
    const passed = (deterministic.checks ?? []).length > 0
      && deterministic.checks.every((check: any) => check.verdict === 'pass');
    return passed
      ? {
        verdict: 'pass', taskCompletion: 'complete', summary: '独立 Judge 确认 Blind Actor 已完成任务。',
        whatWorked: ['全部确定性成功信号成立'], whatFailed: [], whyItMatters: [],
        confirmedFacts: ['真实任务完成信号可见'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95,
      }
      : {
        verdict: 'inconclusive', taskCompletion: 'unknown', summary: '现有证据不足以确认完成。',
        whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [],
        unknowns: ['缺少完整确定性完成信号'], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.4,
      };
  }
  throw new Error(`Unexpected schema in blind harness: ${request.schemaName}`);
}

const provider = new MockAiProvider(responder, 0, 'aquaguide-blind-scripted-v2');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const taskResults: Array<Record<string, any>> = [];

try {
  for (const evalCase of cases) {
    const startingUrl = evalCase.caseId.includes('create') ? `${targetUrl}/welcome` : `${targetUrl}/aquarium`;
    const outcome = await runBlindExperienceCase({
      page, provider, outputDir, evalCase, startingUrl,
      evalSetVersion: 1, productModelVersion: 1, targetAppGitSha: pinnedCommit,
      allowRemoteModel: true, allowScreenshotToProvider: false, maxAgentSteps: 20, agentWaitTimeoutMs: 20_000,
    });
    taskResults.push({
      caseId: evalCase.caseId,
      goal: evalCase.goal,
      runId: outcome.agentRun.runId,
      agentStatus: outcome.agentRun.status,
      verdict: outcome.result.verdict,
      failureSource: outcome.result.failureSource,
      analysisMode: outcome.experience.analysisMode,
      analysisStatus: outcome.experience.analysisStatus,
      actionCount: outcome.experience.actions.length,
      backtrackCount: outcome.experience.metrics.backtrackCount,
      retryCount: outcome.experience.metrics.retryCount,
      repeatedInputCount: outcome.experience.metrics.repeatedInputCount,
      abandoned: outcome.experience.metrics.abandoned,
      frictionCount: outcome.experience.frictions.length,
      findingCount: outcome.experience.findings.length,
      findings: outcome.experience.findings,
      experiencePath: outcome.experiencePath,
    });
  }
} finally {
  await context.close();
  await browser.close();
}

const actorOracleLeakCount = actorRequests.filter((item) => item.markerPresent).length;
const judgeOracleVisible = judgeRequests.length === cases.length && judgeRequests.every((item) => item.markerPresent);
const allPassed = taskResults.every((item) => item.verdict === 'pass' && item.failureSource === null && item.agentStatus === 'completed');
const allBlind = taskResults.every((item) => item.analysisMode === 'blind_experience_run' && item.analysisStatus === 'evaluated');
const falsePositiveFree = taskResults.every((item) => item.frictionCount === 0 && item.findingCount === 0);
const diagnostic = {
  schemaVersion: 2,
  targetAppGitSha: pinnedCommit,
  targetUrl,
  providerModel: provider.info.model,
  claimBoundary: 'Deterministic scripted Blind Actor validates Actor/Judge knowledge separation, main-entry discovery and real-browser plumbing; it is not a real-LLM usability study.',
  actorRequestCount: actorRequests.length,
  judgeRequestCount: judgeRequests.length,
  actorOracleLeakCount,
  judgeOracleVisible,
  allPassed,
  allBlind,
  falsePositiveFree,
  taskResults,
};
await writeFile(resolve(outputDir, 'aquaguide-blind-experience.json'), JSON.stringify(diagnostic, null, 2));
await writeFile(resolve(outputDir, 'knowledge-boundary-audit.json'), JSON.stringify({ actorRequests, judgeRequests }, null, 2));

process.stdout.write(`AquaGuide Blind Experience v2: ${taskResults.filter((item) => item.verdict === 'pass').length}/${taskResults.length} Judge PASS\n`);
for (const item of taskResults) {
  process.stdout.write(`- ${item.caseId}: ${item.verdict}; actions=${item.actionCount}; backtracks=${item.backtrackCount}; frictions=${item.frictionCount}; findings=${item.findingCount}\n`);
}
process.stdout.write(`- Actor Oracle leaks: ${actorOracleLeakCount}\n`);
process.stdout.write(`- Judge received hidden Oracle: ${judgeOracleVisible}\n`);

if (!allPassed) throw new Error('Blind scripted ideal path did not complete all three AquaGuide tasks.');
if (!allBlind) throw new Error('At least one run did not produce an evaluated blind_experience_run artifact.');
if (actorOracleLeakCount !== 0) throw new Error('Hidden Oracle marker leaked into an Actor request.');
if (!judgeOracleVisible) throw new Error('Independent Judge did not receive the hidden Oracle marker for every task.');
if (!falsePositiveFree) throw new Error('Scripted ideal blind path produced a UX false positive; inspect evidence before accepting it.');
