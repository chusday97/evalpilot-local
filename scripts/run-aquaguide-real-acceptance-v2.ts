import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { evaluateRealProductAcceptanceFromArtifacts } from '../src/acceptance/real-product-acceptance.js';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

const projectRoot = resolve(arg('--project-root'));
const targetUrl = arg('--url', 'http://127.0.0.1:3000');
const outputDir = resolve(arg('--output', 'real-product-acceptance-output'));
const dataDir = resolve(outputDir, 'evalpilot-data');
const manifestPath = resolve('acceptance/real-products/aquaguide.yaml');
const children: ChildProcess[] = [];
const servers: Server[] = [];
const providerCalls: Array<{ at: string; schemaName: string }> = [];
const sessionSnapshots: Array<{ at: string; status: string; stage: string; message: string | null; runIds: string[] }> = [];
const acceptanceDeadlineMs = 180_000;

await mkdir(outputDir, { recursive: true });
await mkdir(dataDir, { recursive: true });

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function waitFor(url: string, attempts = 120): Promise<Response> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
    } catch {
      // Service may still be starting.
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function api<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
  });
  const payload = await response.json() as { success?: boolean; data?: T; error?: unknown };
  if (!response.ok || !payload.success) throw new Error(`${path} failed: ${JSON.stringify(payload)}`);
  return payload.data as T;
}

async function safeApi<T>(baseUrl: string, path: string): Promise<T | null> {
  try { return await api<T>(baseUrl, path); }
  catch { return null; }
}

function verifiedEvidence(input: any): { evidenceId: string; evidenceStatus: 'verified' | 'declared' } | null {
  const catalog = input.evidenceCatalog ?? [];
  const evidence = catalog.find((item: any) => item.sourceType === 'browser' && item.status === 'verified') ?? catalog[0];
  if (!evidence?.evidenceId) return null;
  return { evidenceId: evidence.evidenceId, evidenceStatus: evidence.status === 'verified' ? 'verified' : 'declared' };
}

function productUnderstanding(input: any) {
  const evidence = verifiedEvidence(input);
  if (!evidence) return {};
  const refs = [evidence.evidenceId];
  const evidenceStatus = evidence.evidenceStatus;
  const taskEvidence = { evidenceStatus, evidenceRefs: refs, needsHumanReview: false };

  const createSize = '鱼缸页面显示已保存的 60×30×30cm 尺寸';
  const createWater = '鱼缸页面显示已保存的淡水水体';
  const recordLivestock = '鱼缸主页面显示已保存的咖啡鼠活体记录';
  const dailyRisk = '每日检查结果保持高风险并显示 Act now';
  const dailyAction = '经常浮头结果显示立即增加供氧或水面扰动';

  return {
    capabilities: [
      { capabilityId: 'cap-create-aquarium', name: '创建鱼缸', description: '从创建入口建立并保存一个可用淡水鱼缸。', routes: ['/welcome', '/aquarium'], entryPoints: ['/aquarium?action=create'], userGoals: ['创建一个可用淡水鱼缸'], importance: 'critical', ...taskEvidence },
      { capabilityId: 'cap-record-livestock', name: '记录已有生物', description: '把现实中已有生物保存到当前鱼缸。', routes: ['/aquarium'], entryPoints: ['/aquarium?action=record-existing'], userGoals: ['记录已有生物到当前鱼缸'], importance: 'critical', ...taskEvidence },
      { capabilityId: 'cap-daily-check', name: '每日检查', description: '完成鱼缸每日检查并获得确定性风险分级。', routes: ['/aquarium'], entryPoints: ['/aquarium?action=daily-check'], userGoals: ['完成每日检查并查看风险分级'], importance: 'critical', ...taskEvidence },
    ],
    userTasks: [
      {
        taskId: 'task-create-usable-aquarium', capabilityId: 'cap-create-aquarium', name: '创建一个可用淡水鱼缸', goal: '创建一个可用淡水鱼缸',
        preconditions: ['项目页面已打开'], successConditions: [createSize, createWater],
        successSignals: [
          { signalId: 'signal-create-size', kind: 'text_visible', target: '60×30×30cm', description: createSize, ...taskEvidence },
          { signalId: 'signal-create-water', kind: 'text_visible', target: '淡水', description: createWater, ...taskEvidence },
        ], businessRuleIds: [], ...taskEvidence,
      },
      {
        taskId: 'task-record-existing-livestock', capabilityId: 'cap-record-livestock', name: '向已有鱼缸记录生物', goal: '记录已有生物到当前鱼缸',
        preconditions: ['已有鱼缸'], successConditions: [recordLivestock],
        successSignals: [
          { signalId: 'signal-record-livestock', kind: 'text_visible', target: '咖啡鼠', description: recordLivestock, ...taskEvidence },
        ], businessRuleIds: [], ...taskEvidence,
      },
      {
        taskId: 'task-daily-check-risk', capabilityId: 'cap-daily-check', name: '完成每日检查并得到风险分级', goal: '完成每日检查并查看风险分级',
        preconditions: ['已有鱼缸', '已有生物记录'], successConditions: [dailyRisk, dailyAction],
        successSignals: [
          { signalId: 'signal-daily-high-risk', kind: 'text_visible', target: 'Act now', description: dailyRisk, ...taskEvidence },
          { signalId: 'signal-daily-action', kind: 'text_visible', target: '立即增加供氧或水面扰动', description: dailyAction, ...taskEvidence },
        ], businessRuleIds: ['rule-daily-high-risk'], ...taskEvidence,
      },
    ],
    objectLifecycles: [{
      lifecycleId: 'lifecycle-aquarium', objectName: '鱼缸', states: ['empty', 'usable', 'stocked', 'checked'],
      transitions: [
        { transitionId: 'transition-create', fromState: 'empty', toState: 'usable', trigger: '保存 60×30×30cm 尺寸和 Freshwater 水体', successSignalIds: ['signal-create-size', 'signal-create-water'] },
        { transitionId: 'transition-stock', fromState: 'usable', toState: 'stocked', trigger: '记录已有咖啡鼠', successSignalIds: ['signal-record-livestock'] },
        { transitionId: 'transition-check', fromState: 'stocked', toState: 'checked', trigger: '完成每日检查', successSignalIds: ['signal-daily-high-risk', 'signal-daily-action'] },
      ], ...taskEvidence,
    }],
    crossPageJourneys: [{
      journeyId: 'journey-aquarium-core', name: '从建缸到每日检查',
      taskIds: ['task-create-usable-aquarium', 'task-record-existing-livestock', 'task-daily-check-risk'],
      routes: ['/welcome', '/aquarium'], successConditions: ['可用鱼缸已建立', '已有生物已记录', '每日检查已完成'], ...taskEvidence,
    }],
    businessRules: [{ ruleId: 'rule-daily-high-risk', statement: '经常浮头必须保持高风险；AI 解释不得降低本地确定性风险。', ...taskEvidence }],
    unknowns: [],
  };
}

function oracleBuilder(input: any) {
  const signals = input.task?.successSignals ?? [];
  return {
    expectedOutcome: signals.map((signal: any) => signal.description || signal.target),
    mustObserve: signals.map((signal: any) => signal.target),
    mustNotObserve: [],
    businessRules: input.task?.businessRuleIds ?? [],
    semanticRubric: [`用户是否真实完成：${input.task?.goal ?? '目标任务'}`],
    deterministicAssertions: signals
      .filter((signal: any) => signal.kind !== 'semantic')
      .map((signal: any) => ({ assertionId: `assert-${signal.signalId}`, type: signal.kind, target: signal.target, expected: true, negated: false })),
    inconclusiveWhen: ['没有观察到成功信号且没有明确产品失败证据'],
    needsHumanReview: false,
    reviewReasons: [],
  };
}

function labelIncludes(item: any, value: string): boolean {
  return String(item?.label ?? '').includes(value);
}

function labelIncludesAny(item: any, values: string[]): boolean {
  return values.some((value) => labelIncludes(item, value));
}

function safeButtonClick(input: any, predicate: (item: any) => boolean, intent: string, expectedResult: string) {
  const target = (input.observation?.interactableElements ?? []).find((item: any) => !item.disabled && item.tagName === 'button' && predicate(item));
  return target ? { intentSummary: intent, action: 'click', targetElementId: target.elementId, value: null, expectedResult, confidence: 1 } : null;
}

function actorDecision(input: any) {
  const goal = String(input.goal ?? '');
  const observation = input.observation ?? {};
  const visible = String(observation.visibleStateSummary ?? '');
  const expected = input.oracleSummary?.mustObserve ?? [];
  if (expected.length > 0 && expected.every((item: string) => visible.includes(item))) {
    return { intentSummary: '验收目标已经可见', action: 'finish', targetElementId: null, value: null, expectedResult: expected.join('；'), confidence: 1 };
  }

  if (/Loading AquaGuide/i.test(visible)) {
    return { intentSummary: '等待 AquaGuide 完成初始化', action: 'wait', targetElementId: null, value: null, expectedResult: 'AquaGuide 页面完成初始化', confidence: 1 };
  }

  if (goal.includes('创建') && goal.includes('鱼缸')) {
    if (String(observation.pageUrl ?? '').includes('/welcome')) {
      return safeButtonClick(input, (item) => labelIncludesAny(item, ['建立第一个鱼缸', 'Build your first aquarium']), '沿真实 onboarding 建立第一个鱼缸', '进入鱼缸创建流程')
        ?? { intentSummary: '欢迎页没有建缸入口', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
    }

    const buttons = (observation.interactableElements ?? []).filter((item: any) => item.tagName === 'button' && !item.disabled);
    const settingsOpen = buttons.some((item: any) => ['保存设置', 'Save Settings'].includes(String(item.label ?? '')));
    if (!settingsOpen) {
      return safeButtonClick(input, (item) => labelIncludesAny(item, ['建立或完善鱼缸', 'Build or complete aquarium', '鱼缸设置', 'Tank Settings']), '打开鱼缸设置', '显示尺寸和水体设置')
        ?? { intentSummary: '没有找到鱼缸设置入口', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
    }

    const numberFields = (observation.formFields ?? []).filter((field: any) => field.inputType === 'number' && !field.disabled);
    const emptyNumbers = numberFields.filter((field: any) => !field.currentValuePresent);
    if (numberFields.length >= 3 && emptyNumbers.length > 0) {
      const index = numberFields.indexOf(emptyNumbers[0]);
      const value = index === 0 ? '60' : '30';
      return { intentSummary: `填写第 ${index + 1} 个尺寸字段`, action: 'fill', targetElementId: emptyNumbers[0].elementId, value, expectedResult: '尺寸字段保存当前输入值', confidence: 1 };
    }

    const dimensionsButton = buttons.find((item: any) => labelIncludesAny(item, ['Dimensions', '尺寸']));
    const parametersButton = buttons.find((item: any) => labelIncludesAny(item, ['Parameters', '参数']));
    const freshwaterButton = buttons.find((item: any) => labelIncludes(item, '淡水') && !labelIncludes(item, '海水'));
    const dimensionsNeedConfig = Boolean(dimensionsButton && labelIncludesAny(dimensionsButton, ['Incomplete dimensions', '尺寸未记录']));
    const waterTypeUnknown = Boolean(parametersButton && labelIncludesAny(parametersButton, ['Water type unknown', '水体未记录']));

    if (waterTypeUnknown && freshwaterButton) {
      return { intentSummary: '选择 Freshwater 水体', action: 'click', targetElementId: freshwaterButton.elementId, value: null, expectedResult: '水体参数变为 Freshwater', confidence: 1 };
    }
    if (dimensionsNeedConfig && numberFields.length < 3 && dimensionsButton) {
      return { intentSummary: '打开尺寸设置', action: 'click', targetElementId: dimensionsButton.elementId, value: null, expectedResult: '显示长宽高数字输入框', confidence: 1 };
    }
    if (waterTypeUnknown && parametersButton) {
      return { intentSummary: '打开水体参数', action: 'click', targetElementId: parametersButton.elementId, value: null, expectedResult: '显示淡水/海水选项', confidence: 1 };
    }

    const save = safeButtonClick(input, (item) => ['保存设置', 'Save Settings'].includes(String(item.label ?? '')), '保存鱼缸设置', '鱼缸主页面显示已保存尺寸和水体');
    if (save) return save;
  }

  if (goal.includes('记录') && goal.includes('生物')) {
    const search = (observation.formFields ?? []).find((field: any) => {
      const text = String(field.placeholder ?? field.label ?? '');
      return text.includes('搜索鱼、虾、螺') || text.includes('Search fish, shrimp, snails');
    });
    if (search && !search.currentValuePresent) {
      return { intentSummary: '用学名搜索真实测试物种', action: 'fill', targetElementId: search.elementId, value: 'Corydoras aeneus', expectedResult: '候选列表显示 Corydoras aeneus', confidence: 1 };
    }
    const saveToTank = safeButtonClick(input, (item) => String(item.label ?? '') === '保存到鱼缸', '保存已有生物记录', '主鱼缸页面保留咖啡鼠记录');
    if (saveToTank) return saveToTank;
    const fish = safeButtonClick(input, (item) => labelIncludes(item, 'Corydoras aeneus'), '选择 Corydoras aeneus', '显示数量和入缸日期表单');
    if (fish) return fish;
  }

  if (goal.includes('每日') && goal.includes('检查')) {
    const questionAnswers: Array<[string, string]> = [
      ['鱼是否浮头或呼吸急促？', '经常浮头'],
      ['水体是否发白、发绿或浑浊？', '清澈'],
      ['水面是否有持续泡沫或油膜？', '没有泡沫或油膜'],
      ['鱼缸是否出现异味？', '没有异味'],
      ['鱼是否拒食、趴底、躲藏或追咬？', '正常游动和进食'],
      ['最近 48 小时做过什么？', '没有特别操作'],
      ['还有其他情况想补充吗？', '跳过'],
    ];
    for (const [question, answer] of questionAnswers) {
      if (!visible.includes(question)) continue;
      const choice = safeButtonClick(input, (item) => String(item.label ?? '') === answer, `回答每日检查：${answer}`, '进入下一项检查问题');
      if (choice) return choice;
    }
    const generate = safeButtonClick(input, (item) => labelIncludesAny(item, ['生成检查结果', 'Generate Results']), '生成每日检查风险结果', '页面显示高风险等级和立即动作');
    if (generate) return generate;
  }

  return { intentSummary: '当前真实页面没有安全且可证明的下一步', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
}

function mockStructuredOutput(schemaName: string, userPrompt: string) {
  let input: any = {};
  try { input = JSON.parse(userPrompt); } catch { return {}; }
  if (schemaName === 'product_understanding_draft') return productUnderstanding(input);
  if (schemaName === 'oracle_builder_output') return oracleBuilder(input);
  if (schemaName === 'agent_decision') return actorDecision(input);
  if (schemaName === 'semantic_step_verification') {
    const changed = input.before?.summary !== input.after?.summary || (input.networkDelta ?? []).length > 0 || (input.consoleDelta ?? []).length > 0;
    return { status: changed || input.action?.action === 'finish' ? 'confirmed' : 'not_confirmed', observed: changed ? '动作后页面出现稳定变化。' : '动作前后没有稳定变化。', confirmedFacts: changed ? ['页面状态已变化'] : ['页面状态未变化'], unknowns: [], evidenceRefs: [], confidence: 0.95 };
  }
  if (schemaName === 'semantic_judge_result') {
    const deterministic = input.deterministic ?? {};
    if (deterministic.hardFailure) {
      return { verdict: 'fail', taskCompletion: 'failed', summary: '确定性断言已确认真实任务失败。', whatWorked: ['运行证据已保存'], whatFailed: ['验收成功信号未全部成立'], whyItMatters: ['真实用户任务没有完成'], confirmedFacts: ['确定性断言失败'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95 };
    }
    const passed = (deterministic.checks ?? []).length > 0 && deterministic.checks.every((check: any) => check.verdict === 'pass');
    return passed
      ? { verdict: 'pass', taskCompletion: 'complete', summary: '真实 AquaGuide 任务已完成。', whatWorked: ['验收成功信号全部可见'], whatFailed: [], whyItMatters: [], confirmedFacts: ['真实任务完成信号可见'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95 }
      : { verdict: 'inconclusive', taskCompletion: 'unknown', summary: '当前真实页面证据不足以确认任务完成。', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: ['缺少确定性完成信号'], evidenceRefs: [], confidence: 0.4 };
  }
  if (schemaName === 'reflection_decision') return { nextStep: 'continue', summary: '继续沿当前真实任务寻找完成信号。', confidence: 0.9 };
  return {};
}

async function startMockProvider(): Promise<string> {
  const port = await freePort();
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const schemaName = String(body.text?.format?.name ?? 'unknown');
        providerCalls.push({ at: new Date().toISOString(), schemaName });
        const userPrompt = body.input?.[0]?.content?.find((item: any) => item.type === 'input_text')?.text ?? '{}';
        const output = mockStructuredOutput(schemaName, userPrompt);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ output_text: JSON.stringify(output) }));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
      }
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  servers.push(server);
  return `http://127.0.0.1:${port}/v1`;
}

async function stopInfrastructure() {
  for (const child of children) {
    child.kill('SIGTERM');
    setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 300).unref();
  }
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
}

let dashboardLog = '';
let diagnostic: Record<string, unknown> = {};

try {
  await waitFor(targetUrl);
  const mockProviderUrl = await startMockProvider();
  const dashboardPort = await freePort();
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  const dashboard = spawn('npx', ['tsx', 'src/cli/index.ts', '--data-dir', dataDir, 'dashboard', '--port', String(dashboardPort)], {
    cwd: resolve('.'),
    env: { ...process.env, NODE_ENV: 'test', EVALPILOT_NO_OPEN: '1', EVALPILOT_OPENAI_API_KEY: 'test-only-key', EVALPILOT_TEST_OPENAI_BASE_URL: mockProviderUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(dashboard);
  dashboard.stdout?.on('data', (chunk) => { dashboardLog += chunk.toString(); });
  dashboard.stderr?.on('data', (chunk) => { dashboardLog += chunk.toString(); });
  await waitFor(`${dashboardUrl}/api/health`);

  const project = await api<any>(dashboardUrl, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'AquaGuide Real Acceptance', projectRoot, targetUrl, importSource: 'manual' }),
  });
  if (project.status !== 'ready') throw new Error(`AquaGuide project was not ready: ${JSON.stringify(project)}`);

  const created = await api<any>(dashboardUrl, '/api/evaluations', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.projectId, depth: 'core', capabilityIds: [], allowRemoteModel: true, allowScreenshot: false }),
  });
  let session = created;
  const deadline = Date.now() + acceptanceDeadlineMs;
  while (Date.now() < deadline && session.status !== 'completed' && session.status !== 'failed') {
    await new Promise((wait) => setTimeout(wait, 1_000));
    const snapshot = await safeApi<any>(dashboardUrl, `/api/evaluations/${encodeURIComponent(created.evaluationId)}`);
    if (!snapshot?.session) continue;
    session = snapshot.session;
    const currentStage = session.stages?.find((stage: any) => stage.name === session.currentStage);
    sessionSnapshots.push({ at: new Date().toISOString(), status: session.status, stage: session.currentStage, message: currentStage?.message ?? null, runIds: [...(session.runIds ?? [])] });
  }

  const timedOut = session.status !== 'completed' && session.status !== 'failed';
  const adaptiveRuns = await safeApi<any[]>(dashboardUrl, `/api/projects/${encodeURIComponent(project.projectId)}/adaptive-runs`) ?? [];
  const nextAction = await safeApi<any>(dashboardUrl, `/api/evaluations/${encodeURIComponent(created.evaluationId)}/next-action?projectId=${encodeURIComponent(project.projectId)}`);
  const evaluationDirectory = resolve(project.outputDir, 'evaluations', created.evaluationId);
  let gate: Awaited<ReturnType<typeof evaluateRealProductAcceptanceFromArtifacts>> | null = null;
  let gateError: string | null = null;
  try { gate = await evaluateRealProductAcceptanceFromArtifacts({ manifestPath, evaluationDirectory }); }
  catch (error) { gateError = error instanceof Error ? error.message : String(error); }

  diagnostic = { project, session, timedOut, adaptiveRuns, nextAction, gate, gateError, evaluationDirectory, providerCalls, sessionSnapshots };
  await writeFile(resolve(outputDir, 'aquaguide-real-acceptance.json'), JSON.stringify(diagnostic, null, 2));
  await writeFile(resolve(outputDir, 'provider-calls.json'), JSON.stringify(providerCalls, null, 2));
  await writeFile(resolve(outputDir, 'session-snapshots.json'), JSON.stringify(sessionSnapshots, null, 2));
  await writeFile(resolve(outputDir, 'dashboard.log'), dashboardLog);

  if (gate) {
    process.stdout.write(`AquaGuide Real Acceptance: ${gate.counts.passed}/${gate.counts.planned} (${Math.round(gate.taskCompletionRate * 100)}%)\n`);
    for (const task of gate.tasks) process.stdout.write(`- [${task.status}] ${task.name}: ${task.reason}\n`);
  } else {
    process.stdout.write(`AquaGuide Real Acceptance did not reach the gate: ${gateError ?? 'unknown error'}\n`);
  }
  process.stdout.write(`Session: ${session.status} / ${session.currentStage}; provider calls=${providerCalls.length}; timedOut=${timedOut}\n`);
  process.stdout.write(`Next Action: ${nextAction?.type ?? 'unavailable'}\n`);
  if (timedOut || !gate?.passed) process.exitCode = 1;
} catch (error) {
  diagnostic = { error: error instanceof Error ? error.message : String(error), providerCalls, sessionSnapshots };
  await writeFile(resolve(outputDir, 'aquaguide-real-acceptance.json'), JSON.stringify(diagnostic, null, 2));
  await writeFile(resolve(outputDir, 'provider-calls.json'), JSON.stringify(providerCalls, null, 2));
  await writeFile(resolve(outputDir, 'session-snapshots.json'), JSON.stringify(sessionSnapshots, null, 2));
  await writeFile(resolve(outputDir, 'dashboard.log'), dashboardLog);
  throw error;
} finally {
  await stopInfrastructure();
}
