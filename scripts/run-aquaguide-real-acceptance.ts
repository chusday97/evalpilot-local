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
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Child process can still be starting.
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function api<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
  });
  const payload = await response.json() as { success?: boolean; data?: T; error?: unknown };
  if (!response.ok || !payload.success) throw new Error(`${path} failed: ${JSON.stringify(payload)}`);
  return payload.data as T;
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
  return {
    capabilities: [
      { capabilityId: 'cap-create-aquarium', name: '创建鱼缸', description: '从首次使用入口创建并完善一个可用鱼缸。', routes: ['/welcome', '/aquarium'], entryPoints: ['/aquarium?action=create'], userGoals: ['创建一个可用淡水鱼缸'], importance: 'critical', ...taskEvidence },
      { capabilityId: 'cap-record-livestock', name: '记录已有生物', description: '把真实已有生物记录到当前鱼缸。', routes: ['/aquarium'], entryPoints: ['/aquarium?action=record-existing'], userGoals: ['记录已有生物到当前鱼缸'], importance: 'critical', ...taskEvidence },
      { capabilityId: 'cap-daily-check', name: '每日检查', description: '完成鱼缸每日检查并获得风险分级。', routes: ['/aquarium'], entryPoints: ['/aquarium?action=daily-check'], userGoals: ['完成每日检查并查看风险分级'], importance: 'critical', ...taskEvidence },
    ],
    userTasks: [
      {
        taskId: 'task-create-usable-aquarium', capabilityId: 'cap-create-aquarium', name: '创建一个可用淡水鱼缸', goal: '创建一个可用淡水鱼缸',
        preconditions: ['项目页面已打开'], successConditions: ['显示 60×30×30cm 尺寸', '水体为淡水'],
        successSignals: [
          { signalId: 'signal-create-size', kind: 'text_visible', target: '60×30×30cm', description: '鱼缸页面显示已保存的 60×30×30cm 尺寸', ...taskEvidence },
          { signalId: 'signal-create-water', kind: 'text_visible', target: '淡水', description: '鱼缸页面显示淡水水体', ...taskEvidence },
        ], businessRuleIds: [], ...taskEvidence,
      },
      {
        taskId: 'task-record-existing-livestock', capabilityId: 'cap-record-livestock', name: '向已有鱼缸记录生物', goal: '记录已有生物到当前鱼缸',
        preconditions: ['已有鱼缸'], successConditions: ['已有生物记录保存成功'],
        successSignals: [
          { signalId: 'signal-record-livestock', kind: 'text_visible', target: '已记录缸内生物', description: '页面明确显示已有生物记录成功', ...taskEvidence },
        ], businessRuleIds: [], ...taskEvidence,
      },
      {
        taskId: 'task-daily-check-risk', capabilityId: 'cap-daily-check', name: '完成每日检查并得到风险分级', goal: '完成每日检查并查看风险分级',
        preconditions: ['已有鱼缸', '已有生物记录'], successConditions: ['经常浮头时显示高风险结果'],
        successSignals: [
          { signalId: 'signal-daily-high-risk', kind: 'text_visible', target: '高风险', description: '每日检查结果显示高风险', ...taskEvidence },
        ], businessRuleIds: ['rule-daily-high-risk'], ...taskEvidence,
      },
    ],
    objectLifecycles: [{
      lifecycleId: 'lifecycle-aquarium', objectName: '鱼缸', states: ['empty', 'usable', 'stocked', 'checked'],
      transitions: [
        { transitionId: 'transition-create', fromState: 'empty', toState: 'usable', trigger: '保存尺寸和淡水水体', successSignalIds: ['signal-create-size', 'signal-create-water'] },
        { transitionId: 'transition-stock', fromState: 'usable', toState: 'stocked', trigger: '记录已有生物', successSignalIds: ['signal-record-livestock'] },
        { transitionId: 'transition-check', fromState: 'stocked', toState: 'checked', trigger: '完成每日检查', successSignalIds: ['signal-daily-high-risk'] },
      ], ...taskEvidence,
    }],
    crossPageJourneys: [{
      journeyId: 'journey-aquarium-core', name: '从建缸到每日检查',
      taskIds: ['task-create-usable-aquarium', 'task-record-existing-livestock', 'task-daily-check-risk'],
      routes: ['/welcome', '/aquarium'], successConditions: ['可用鱼缸已建立', '已有生物已记录', '每日检查已完成'], ...taskEvidence,
    }],
    businessRules: [{ ruleId: 'rule-daily-high-risk', statement: '经常浮头必须至少保持高风险，AI 不得降低确定性风险。', ...taskEvidence }],
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

function safeClick(input: any, predicate: (item: any) => boolean, intent: string, expectedResult: string) {
  const target = (input.observation?.interactableElements ?? []).find((item: any) => !item.disabled && predicate(item));
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

  if (goal.includes('创建') && goal.includes('鱼缸')) {
    if (String(observation.pageUrl ?? '').includes('/welcome')) {
      return safeClick(input, (item) => labelIncludes(item, '建立第一个鱼缸'), '沿真实 onboarding 建立第一个鱼缸', '进入鱼缸页面') ?? { intentSummary: '欢迎页没有建缸入口', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
    }
    const dialogText = (observation.interactableElements ?? []).map((item: any) => String(item.label ?? '')).join(' ');
    const settingsOpen = dialogText.includes('鱼缸设置') && dialogText.includes('保存设置');
    if (!settingsOpen) {
      return safeClick(input, (item) => labelIncludes(item, '建立或完善鱼缸') || labelIncludes(item, '鱼缸设置'), '打开鱼缸设置', '显示尺寸和水体设置')
        ?? { intentSummary: '没有找到鱼缸设置入口', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
    }

    const numberFields = (observation.formFields ?? []).filter((field: any) => field.inputType === 'number' && !field.disabled);
    const emptyNumbers = numberFields.filter((field: any) => !field.currentValuePresent);
    if (emptyNumbers.length > 0 && numberFields.length >= 3) {
      const filledCount = numberFields.length - emptyNumbers.length;
      const value = filledCount === 0 ? '60' : '30';
      return { intentSummary: `填写第 ${filledCount + 1} 个尺寸字段`, action: 'fill', targetElementId: emptyNumbers[0].elementId, value, expectedResult: '尺寸字段保存当前输入值', confidence: 1 };
    }

    if (!visible.includes('淡水') || visible.includes('水体未记录')) {
      const openParameters = safeClick(input, (item) => labelIncludes(item, '参数') && labelIncludes(item, '水体未记录'), '打开水体参数', '显示淡水/海水选项');
      if (openParameters) return openParameters;
      const chooseFreshwater = safeClick(input, (item) => labelIncludes(item, '淡水') && labelIncludes(item, '常见观赏鱼'), '选择淡水', '水体参数变为淡水');
      if (chooseFreshwater) return chooseFreshwater;
    }

    const chooseFreshwater = safeClick(input, (item) => labelIncludes(item, '淡水') && labelIncludes(item, '常见观赏鱼'), '选择淡水', '水体参数变为淡水');
    if (chooseFreshwater && visible.includes('水体未记录')) return chooseFreshwater;
    const save = safeClick(input, (item) => String(item.label ?? '') === '保存设置', '保存鱼缸设置', '鱼缸页面显示已保存尺寸和淡水');
    if (save) return save;
  }

  if (goal.includes('记录') && goal.includes('生物')) {
    const search = (observation.formFields ?? []).find((field: any) => String(field.placeholder ?? field.label ?? '').includes('搜索鱼、虾、螺'));
    if (search && !search.currentValuePresent) return { intentSummary: '搜索一只真实测试生物', action: 'fill', targetElementId: search.elementId, value: '咖啡鼠', expectedResult: '候选列表显示咖啡鼠', confidence: 1 };
    const confirm = safeClick(input, (item) => labelIncludes(item, '确认添加') && !item.disabled, '确认记录已有生物', '页面显示记录成功');
    if (confirm && (observation.interactableElements ?? []).some((item: any) => labelIncludes(item, '咖啡鼠'))) {
      const selected = visible.includes('已选择') || visible.includes('数量') || visible.includes('入缸');
      if (selected) return confirm;
    }
    const fish = safeClick(input, (item) => labelIncludes(item, '咖啡鼠') && item.tagName === 'button', '选择咖啡鼠', '确认添加按钮可用');
    if (fish) return fish;
    if (confirm) return confirm;
  }

  if (goal.includes('每日') && goal.includes('检查')) {
    const choices = ['经常浮头', '清澈', '没有泡沫或油膜', '没有异味', '正常游动和进食', '没有特别操作'];
    for (const label of choices) {
      const target = (observation.interactableElements ?? []).find((item: any) => !item.disabled && String(item.label ?? '') === label);
      const alreadyClicked = (input.recentDecisions ?? []).some((decision: any) => decision.targetElementId === target?.elementId);
      if (target && !alreadyClicked) return { intentSummary: `回答每日检查：${label}`, action: 'click', targetElementId: target.elementId, value: null, expectedResult: '完成一项检查回答', confidence: 1 };
    }
    const generate = safeClick(input, (item) => labelIncludes(item, '生成检查结果') && !item.disabled, '生成每日检查风险结果', '页面显示风险分级');
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
    if (deterministic.hardFailure) return { verdict: 'fail', taskCompletion: 'failed', summary: '确定性断言已确认真实任务失败。', whatWorked: ['运行证据已保存'], whatFailed: ['验收成功信号未全部成立'], whyItMatters: ['真实用户任务没有完成'], confirmedFacts: ['确定性断言失败'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95 };
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
        const schemaName = body.text?.format?.name;
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
  let dashboardLog = '';
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
  for (let attempt = 0; attempt < 360 && session.status !== 'completed' && session.status !== 'failed'; attempt += 1) {
    await new Promise((wait) => setTimeout(wait, 500));
    session = (await api<any>(dashboardUrl, `/api/evaluations/${encodeURIComponent(created.evaluationId)}`)).session;
  }

  const adaptiveRuns = await api<any[]>(dashboardUrl, `/api/projects/${encodeURIComponent(project.projectId)}/adaptive-runs`);
  const nextAction = await api<any>(dashboardUrl, `/api/evaluations/${encodeURIComponent(created.evaluationId)}/next-action?projectId=${encodeURIComponent(project.projectId)}`);
  const evaluationDirectory = resolve(project.outputDir, 'evaluations', created.evaluationId);
  const gate = await evaluateRealProductAcceptanceFromArtifacts({ manifestPath, evaluationDirectory });
  const summary = { project, session, adaptiveRuns, nextAction, gate, evaluationDirectory };
  await writeFile(resolve(outputDir, 'aquaguide-real-acceptance.json'), JSON.stringify(summary, null, 2));
  await writeFile(resolve(outputDir, 'dashboard.log'), dashboardLog);

  process.stdout.write(`AquaGuide Real Acceptance: ${gate.counts.passed}/${gate.counts.planned} (${Math.round(gate.taskCompletionRate * 100)}%)\n`);
  for (const task of gate.tasks) process.stdout.write(`- [${task.status}] ${task.name}: ${task.reason}\n`);
  process.stdout.write(`Next Action: ${nextAction.type}\n`);
  if (!gate.passed) process.exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  for (const server of servers) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
