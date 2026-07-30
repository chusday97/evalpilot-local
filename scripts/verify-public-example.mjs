import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exampleRoot = resolve(root, 'examples/static-no-api');
const temporary = mkdtempSync(join(tmpdir(), 'evalpilot-public-example-'));
const cache = join(temporary, 'npm-cache');
const dataRoot = join(temporary, 'data');
const processes = [];

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
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

  const dashboardPort = await freePort();
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  const bin = join(consumer, 'node_modules', '.bin', 'evalpilot');
  const dashboard = spawn(bin, ['--data-dir', dataRoot, 'dashboard', '--port', String(dashboardPort)], {
    cwd: consumer,
    env: { ...process.env, EVALPILOT_NO_OPEN: '1' },
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
    body: JSON.stringify({ projectId: project.projectId, depth: 'core', capabilityIds: [] }),
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
  if (report.evaluationId !== session.evaluationId) throw new Error('公开示例报告与本次评测不匹配。');
  if (report.coverage?.executedCount !== session.coverage.executedCount) throw new Error('公开示例报告缺少对应的功能级覆盖证据。');
  const reportPage = await waitFor(`${dashboardUrl}/issues?evaluationId=${encodeURIComponent(session.evaluationId)}`);
  if (!(await reportPage.text()).includes('<div id="root">')) throw new Error('公开示例报告页面无法打开。');

  process.stdout.write(`${JSON.stringify({ ok: true, projectStatus: project.status, evaluationStatus: session.status, report: 'ready', plannedCapabilities: session.coverage.plannedCount, executedCapabilities: session.coverage.executedCount, evaluationId: session.evaluationId })}\n`);
} finally {
  for (const child of processes.reverse()) child.kill('SIGTERM');
  rmSync(temporary, { recursive: true, force: true });
}
