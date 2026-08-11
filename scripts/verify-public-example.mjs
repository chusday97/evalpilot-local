import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exampleRoot = resolve(root, 'examples/static-no-api');
const temporary = mkdtempSync(join(tmpdir(), 'evalpilot-public-example-'));
const cache = join(temporary, 'npm-cache');
const dataRoot = join(temporary, 'data');
const processes = [];
const servers = [];

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function mockStructuredOutput(schemaName, userPrompt) {
  let input = {};
  try { input = JSON.parse(userPrompt); } catch { /* Invalid prompt input should produce an invalid schema response. */ }
  if (schemaName === 'agent_decision') {
    const observation = input.observation ?? {};
    const visible = String(observation.visibleStateSummary ?? '');
    const expected = input.oracleSummary?.mustObserve ?? [];
    if (expected.length > 0 && expected.every((item) => visible.includes(item))) return { intentSummary: '目标结果已经可见', action: 'finish', targetElementId: null, value: null, expectedResult: expected.join('；'), confidence: 1 };
    const emptyField = (observation.formFields ?? []).find((field) => !field.currentValuePresent && !field.disabled);
    if (emptyField) return { intentSummary: '填写公开示例任务', action: 'fill', targetElementId: emptyField.elementId, value: '公开示例任务', expectedResult: '输入值出现在表单中', confidence: 1 };
    const recentTargets = new Set((input.recentDecisions ?? []).map((item) => item.targetElementId).filter(Boolean));
    const target = (observation.interactableElements ?? []).find((item) => !item.disabled && !recentTargets.has(item.elementId));
    if (target) return { intentSummary: '执行可见的安全操作', action: 'click', targetElementId: target.elementId, value: null, expectedResult: expected[0] ?? '页面出现明确结果', confidence: 1 };
    return { intentSummary: '没有安全的下一步', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
  }
  if (schemaName === 'semantic_step_verification') {
    const changed = input.before?.summary !== input.after?.summary || (input.networkDelta ?? []).length > 0 || (input.consoleDelta ?? []).length > 0;
    return { status: changed || input.action?.action === 'finish' ? 'confirmed' : 'not_confirmed', observed: changed ? '动作后页面出现稳定变化。' : '动作前后没有稳定变化。', confirmedFacts: changed ? ['页面状态已变化'] : ['页面状态未变化'], unknowns: [], evidenceRefs: [], confidence: 0.95 };
  }
  if (schemaName === 'semantic_judge_result') {
    const deterministic = input.deterministic ?? {};
    if (deterministic.hardFailure) return { verdict: 'fail', taskCompletion: 'failed', summary: '确定性断言已确认任务失败。', whatWorked: ['运行证据已保存'], whatFailed: ['目标结果未出现'], whyItMatters: ['用户无法完成任务'], confirmedFacts: ['确定性断言失败'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95 };
    const passed = (deterministic.checks ?? []).length > 0 && deterministic.checks.every((check) => check.verdict === 'pass');
    return passed
      ? { verdict: 'pass', taskCompletion: 'complete', summary: '公开示例任务已完成。', whatWorked: ['目标结果可见'], whatFailed: [], whyItMatters: [], confirmedFacts: ['目标结果可见'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95 }
      : { verdict: 'inconclusive', taskCompletion: 'unknown', summary: '当前证据不足以确认完成。', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: ['缺少确定性完成信号'], evidenceRefs: [], confidence: 0.4 };
  }
  if (schemaName === 'reflection_decision') return { nextStep: 'continue', summary: '继续寻找目标结果。', confidence: 0.9 };
  return {};
}

async function startMockProvider() {
  const port = await freePort();
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const schemaName = body.text?.format?.name;
        const userPrompt = body.input?.[0]?.content?.find((item) => item.type === 'input_text')?.text ?? '{}';
        const output = mockStructuredOutput(schemaName, userPrompt);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ output_text: JSON.stringify(output) }));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
      }
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  servers.push(server);
  return `http://127.0.0.1:${port}/v1`;
}

async function waitFor(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* The child process is still starting. */ }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`服务没有按时就绪：${url}`);
}

async function api(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(`${path} 请求失败：${JSON.stringify(payload)}`);
  return payload.data;
}

try {
  let tarball = process.argv[2] ? resolve(root, process.argv[2]) : null;
  if (!tarball) {
    const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cache },
    });
    const [packed] = JSON.parse(output);
    tarball = join(temporary, packed.filename);
  }

  const consumer = join(temporary, 'consumer');
  execFileSync('mkdir', ['-p', consumer]);
  execFileSync('npm', ['init', '-y'], { cwd: consumer, stdio: 'ignore', env: { ...process.env, npm_config_cache: cache } });
  execFileSync('npm', ['install', '--ignore-scripts', tarball], { cwd: consumer, stdio: 'inherit', env: { ...process.env, npm_config_cache: cache } });

  const examplePort = await freePort();
  const exampleUrl = `http://127.0.0.1:${examplePort}`;
  const example = spawn(process.execPath, ['server.mjs'], { cwd: exampleRoot, env: { ...process.env, PORT: String(examplePort) }, stdio: 'ignore' });
  processes.push(example);
  const exampleHtml = await (await waitFor(exampleUrl)).text();
  if (!exampleHtml.includes('evalpilot-static-no-api-example')) throw new Error('公开示例缺少可验证的项目身份标记。');

  const mockProviderUrl = await startMockProvider();
  const dashboardPort = await freePort();
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  const bin = join(consumer, 'node_modules', '.bin', 'evalpilot');
  const dashboard = spawn(bin, ['--data-dir', dataRoot, 'dashboard', '--port', String(dashboardPort)], {
    cwd: consumer,
    env: { ...process.env, NODE_ENV: 'test', EVALPILOT_NO_OPEN: '1', EVALPILOT_OPENAI_API_KEY: 'test-only-key', EVALPILOT_TEST_OPENAI_BASE_URL: mockProviderUrl },
    stdio: 'ignore',
  });
  processes.push(dashboard);
  await waitFor(`${dashboardUrl}/api/health`);

  const project = await api(dashboardUrl, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Static No API Example', projectRoot: exampleRoot, targetUrl: exampleUrl, importSource: 'manual' }),
  });
  if (project.status !== 'ready') throw new Error(`公开示例添加后未就绪：${JSON.stringify(project)}`);

  const created = await api(dashboardUrl, '/api/evaluations', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.projectId, depth: 'core', capabilityIds: [], allowRemoteModel: true, allowScreenshot: false }),
  });
  let session = created;
  for (let attempt = 0; attempt < 240 && session.status !== 'completed' && session.status !== 'failed'; attempt += 1) {
    await new Promise((wait) => setTimeout(wait, 500));
    session = (await api(dashboardUrl, `/api/evaluations/${encodeURIComponent(created.evaluationId)}`)).session;
  }
  if (session.status !== 'completed') throw new Error(`公开示例核心评测未完成：${JSON.stringify({ status: session.status, stage: session.currentStage, error: session.error })}`);
  if (!session.coverage || session.coverage.plannedCount < 1) throw new Error('公开示例没有生成功能级覆盖证据。');
  if (!session.coverage.complete || session.coverage.executedCount !== session.coverage.plannedCount || session.coverage.notRunCount !== 0) {
    throw new Error(`公开示例没有实际运行全部计划功能：${JSON.stringify(session.coverage)}`);
  }
  if (new Set(session.executedCapabilityIds).size !== session.coverage.executedCount) throw new Error('实际运行功能数量与覆盖证据不一致。');

  const records = await api(dashboardUrl, `/api/evaluation-records?projectId=${encodeURIComponent(project.projectId)}`);
  const record = records.find((item) => item.evaluationId === session.evaluationId);
  if (!record || record.status !== 'completed') throw new Error('公开示例没有生成可打开的评测记录。');
  if (record.coverage?.executedCount !== session.coverage.executedCount || record.capabilityNames.length !== session.executedCapabilityNames.length) throw new Error('评测卡片没有使用实际运行功能快照。');
  const reportPath = resolve(project.outputDir, 'evaluations', session.evaluationId, 'report.json');
  if (!existsSync(reportPath)) throw new Error('公开示例没有生成对应的 report.json。');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.evaluationId !== session.evaluationId) throw new Error(`公开示例报告与本次评测不匹配：${JSON.stringify({ reportEvaluationId: report.evaluationId ?? null, sessionEvaluationId: session.evaluationId, reportKeys: Object.keys(report) })}`);
  const reportExecutedCapabilities = [...new Set((report.coverage?.cells ?? []).filter((cell) => cell.executionStatus !== 'not_run').map((cell) => cell.capabilityId))].sort();
  const sessionExecutedCapabilities = [...session.executedCapabilityIds].sort();
  if (JSON.stringify(reportExecutedCapabilities) !== JSON.stringify(sessionExecutedCapabilities)) throw new Error(`公开示例报告缺少对应的功能级覆盖证据：${JSON.stringify({ reportExecutedCapabilities, sessionExecutedCapabilities })}`);
  const reportPage = await waitFor(`${dashboardUrl}/issues?evaluationId=${encodeURIComponent(session.evaluationId)}`);
  if (!(await reportPage.text()).includes('<div id="root">')) throw new Error('公开示例报告页面无法打开。');

  process.stdout.write(`${JSON.stringify({ ok: true, projectStatus: project.status, evaluationStatus: session.status, report: 'ready', plannedCapabilities: session.coverage.plannedCount, executedCapabilities: session.coverage.executedCount, evaluationId: session.evaluationId })}\n`);
} finally {
  for (const child of processes.reverse()) child.kill('SIGTERM');
  await Promise.all(servers.reverse().map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  rmSync(temporary, { recursive: true, force: true });
}
