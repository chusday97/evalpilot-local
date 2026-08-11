#!/usr/bin/env node
import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initializeProject } from '../config/initializer.js';
import { loadConfig } from '../config/project-config.js';
import { getProjectStatus } from '../config/status.js';
import { scanProject } from '../scanner/scan-project.js';
import { generateBackground } from '../generation/background-builder.js';
import { generateBlueprint } from '../generation/blueprint-builder.js';
import { generateCases } from '../generation/scenario-builder.js';
import { runScenarios } from '../runner/scenario-runner.js';
import { runRegression } from '../runner/regression-runner.js';
import { buildReport } from '../report/report-builder.js';
import { startDashboardServer } from '../dashboard/server.js';
import { EvalPilotError } from '../utils/errors.js';
import { dashboardAssetsRoot, isLegacyDataRoot, migrateLegacyData, packageVersion, resolveDataRoot } from '../runtime/paths.js';
import { inspectRuntime } from '../runtime/runtime-readiness.js';
import { runBuiltinBenchmark } from '../benchmark/runner.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export function createProgram(cwd = process.cwd()): Command {
  const program = new Command();
  program
    .name('evalpilot')
    .description('本地 Web 产品上线前评测 CLI')
    .version(packageVersion())
    .option('--data-dir <path>', '评测数据目录（默认 ~/.evalpilot-local）');
  program.hook('preAction', (_command, actionCommand) => {
    const dataDir = actionCommand.optsWithGlobals().dataDir;
    if (typeof dataDir === 'string' && dataDir.trim()) process.env.EVALPILOT_DATA_DIR = resolve(dataDir);
    if (isLegacyDataRoot(cwd, resolveDataRoot(cwd, typeof dataDir === 'string' ? dataDir : undefined)) && !['doctor', 'status', 'dashboard', 'migrate'].includes(actionCommand.name())) {
      throw new EvalPilotError('旧 .evalpilot 当前为只读兼容模式；请先运行 evalpilot migrate --confirmed。', 'LEGACY_DATA_READ_ONLY');
    }
  });

  program
    .command('doctor')
    .description('检查 Node、Chromium、Git、数据目录和 Agent 能力')
    .option('--json', '输出可供自动化读取的 JSON')
    .action(async ({ json }: { json?: boolean }) => {
      const readiness = await inspectRuntime(cwd, program.opts().dataDir as string | undefined);
      if (json) {
        process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
        return;
      }
      const checks = Object.values(readiness.checks).map((item) => `- ${item.label}：${item.status === 'ready' ? '可用' : item.status === 'missing' ? '缺少' : '阻塞'}。${item.detail}`).join('\n');
      const recovery = readiness.recoveryActions.length ? `\n恢复建议：\n${readiness.recoveryActions.map((item) => `- ${item}`).join('\n')}` : '';
      process.stdout.write(`EvalPilot ${readiness.packageVersion} 运行检查\n数据目录：${readiness.dataRoot}\n${checks}${recovery}\n`);
    });

  program
    .command('setup')
    .description('安装显式授权的本地运行依赖')
    .option('--install-chromium', '安装评测所需 Chromium')
    .option('--confirmed', '确认允许下载 Chromium')
    .action(async ({ installChromium, confirmed }: { installChromium?: boolean; confirmed?: boolean }) => {
      if (!installChromium) throw new EvalPilotError('请指定 --install-chromium。', 'SETUP_ACTION_REQUIRED');
      if (!confirmed) throw new EvalPilotError('安装 Chromium 前需要添加 --confirmed 明确确认。', 'CONFIRMATION_REQUIRED');
      const playwrightPackage = require.resolve('playwright/package.json');
      const cliPath = resolve(dirname(playwrightPackage), 'cli.js');
      try {
        await execFileAsync(process.execPath, [cliPath, 'install', 'chromium'], { timeout: 10 * 60_000, maxBuffer: 4_000_000 });
      } catch (error) {
        throw new EvalPilotError(`Chromium 安装失败：${error instanceof Error ? error.message : String(error)}`, 'CHROMIUM_INSTALL_FAILED');
      }
      process.stdout.write('Chromium 安装完成。下一步：evalpilot doctor\n');
    });

  program
    .command('migrate')
    .description('把当前目录的旧 .evalpilot 数据复制到新的用户级数据目录')
    .option('--confirmed', '确认复制旧数据且不覆盖目标目录')
    .action(async ({ confirmed }: { confirmed?: boolean }) => {
      if (!confirmed) throw new EvalPilotError('迁移旧数据前需要添加 --confirmed 明确确认。', 'CONFIRMATION_REQUIRED');
      try {
        const destination = await migrateLegacyData(cwd);
        process.stdout.write(`旧数据已复制到 ${destination}。原目录保持不变。\n`);
      } catch (error) {
        throw new EvalPilotError(error instanceof Error ? error.message : String(error), 'LEGACY_MIGRATION_FAILED');
      }
    });

  program
    .command('benchmark')
    .description('运行 20 个已知失败与 20 个干净行为的本地自基准')
    .option('--json', '输出完整 JSON 指标与逐夹具预测')
    .action(({ json }: { json?: boolean }) => {
      const report = runBuiltinBenchmark();
      if (json) { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); return; }
      const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
      process.stdout.write([
        `EvalPilot 内置自基准 v${report.benchmarkVersion}`,
        `已知失败：${report.metrics.knownFailures}；干净行为：${report.metrics.cleanBehaviors}`,
        `Bug Detection Recall：${percent(report.metrics.bugDetectionRecall)}`,
        `Precision：${percent(report.metrics.precision)}`,
        `False Positive Rate：${percent(report.metrics.falsePositiveRate)}`,
        `Classification Accuracy：${percent(report.metrics.classificationAccuracy)}`,
        `Evaluator Failure Rate：${percent(report.metrics.evaluatorFailureRate)}`,
        `边界：${report.limitation}`,
      ].join('\n') + '\n');
    });

  program
    .command('init')
    .description('初始化 EvalPilot 工作目录')
    .requiredOption('--project <path>', '被测项目绝对或相对路径')
    .requiredOption('--url <url>', 'localhost 或测试环境 URL')
    .action(async ({ project, url }: { project: string; url: string }) => {
      const config = await initializeProject({ cwd, project, url });
      process.stdout.write(
        `初始化完成。\n被测项目：${config.projectRoot}\n目标网址：${config.targetUrl}\n配置文件：${config.outputDir}/config.yaml\n下一步：evalpilot scan\n`,
      );
    });

  program
    .command('status')
    .description('查看当前 EvalPilot 状态')
    .action(async () => {
      const status = await getProjectStatus(await loadConfig(cwd));
      const stageLines = Object.entries(status.stages)
        .map(([name, complete]) => `- ${name}: ${complete ? '已就绪' : '未完成'}`)
        .join('\n');
      process.stdout.write(
        `EvalPilot 状态\n被测项目：${status.config.projectRoot}\n目标网址：${status.config.targetUrl}\n${stageLines}\n`,
      );
    });

  program
    .command('scan')
    .description('扫描目标项目事实并用 Chromium 采集页面证据')
    .action(async () => {
      const result = await scanProject(await loadConfig(cwd));
      process.stdout.write(
        `扫描完成。\n仓库文件：${result.fileCount}\n产品文档：${result.documentCount}\n静态路由：${result.routeCount}\nAPI 证据：${result.apiCount}\n测试文件：${result.testFileCount}\n浏览器页面：${result.pageCount}\n下一步：evalpilot generate-background\n`,
      );
    });

  program
    .command('generate-background')
    .description('基于已保存证据生成带事实等级的产品背景')
    .action(async () => {
      const background = await generateBackground(await loadConfig(cwd));
      process.stdout.write(
        `产品背景已生成。\n项目：${background.projectName}\n核心能力：${background.capabilities.length}\n未知信息：${background.unknowns.length}\n下一步：evalpilot generate-blueprint\n`,
      );
    });

  program
    .command('generate-blueprint')
    .description('基于产品背景生成可审核的项目评测蓝图')
    .action(async () => {
      const blueprint = await generateBlueprint(await loadConfig(cwd));
      process.stdout.write(
        `评测蓝图已生成。\n项目：${blueprint.projectName}\n能力：${blueprint.capabilities.length}\n审批状态：${blueprint.approvalStatus}\n下一步：evalpilot generate-cases\n`,
      );
    });

  program
    .command('generate-cases')
    .description('生成行为型 Persona、分类案例和覆盖率')
    .action(async () => {
      const result = await generateCases(await loadConfig(cwd));
      const automated = result.scenarios.filter((scenario) => scenario.automationStatus === 'automated').length;
      process.stdout.write(
        `评测案例已生成。\nPersona：${result.personas.length}\n静态案例：${result.scenarios.length}\n探索案例：${result.exploratoryScenarios.length}\n功能旅程：${result.journeys.length}\n可自动执行：${automated}\n下一步：evalpilot run\n`,
      );
    });

  program
    .command('run')
    .description('用 Chromium 执行自动评测案例')
    .option('--case <case-id>', '只执行指定案例')
    .option('--regression', '执行已确认失败的回归案例')
    .action(async ({ case: caseId, regression }: { case?: string; regression?: boolean }) => {
      if (regression) {
        const run = await runRegression(await loadConfig(cwd));
        const passed = run.results.filter((result) => result.status === 'passed').length;
        const failed = run.results.filter((result) => result.status === 'failed').length;
        const blocked = run.results.filter((result) => result.status === 'blocked').length;
        const notApplicable = run.results.filter((result) => result.status === 'not_applicable').length;
        process.stdout.write(`回归评测完成。\n执行：${run.results.length}\n通过：${passed}\n失败：${failed}\n阻塞：${blocked}\n不适用：${notApplicable}\n证据目录：${run.runDirectory}\n`);
        return;
      }
      const run = await runScenarios(await loadConfig(cwd), caseId);
      const passed = run.results.filter((result) => result.status === 'passed').length;
      const failed = run.results.filter((result) => result.status === 'failed').length;
      const blocked = run.results.filter((result) => result.status === 'blocked').length;
      const notApplicable = run.results.filter((result) => result.status === 'not_applicable').length;
      process.stdout.write(
        `浏览器评测完成。\n执行：${run.results.length}\n通过：${passed}\n失败：${failed}\n阻塞：${blocked}\n不适用：${notApplicable}\n证据目录：${run.runDirectory}\n下一步：evalpilot report\n`,
      );
    });

  program
    .command('dashboard')
    .description('启动仅限本机访问的 EvalPilot Dashboard 与 API')
    .option('--port <port>', '本地端口', '4173')
    .action(async ({ port }: { port: string }, command: Command) => {
      const parsedPort = Number(port);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
        throw new EvalPilotError(`Dashboard 端口无效：${port}`, 'INVALID_DASHBOARD_PORT');
      }
      const automaticRecovery = command.getOptionValueSource('port') === 'default';
      const requestedUrl = `http://127.0.0.1:${parsedPort}`;
      if (automaticRecovery) {
        try {
          const response = await fetch(`${requestedUrl}/api/projects`, { signal: AbortSignal.timeout(700) });
          const payload = await response.json() as { success?: boolean };
          if (response.ok && payload.success === true) {
            if (process.platform === 'darwin' && process.env.EVALPILOT_NO_OPEN !== '1') execFile('open', [requestedUrl], () => undefined);
            process.stdout.write(`EvalPilot Dashboard 已在运行。\n地址：${requestedUrl}\n已重新打开，无需重复启动。\n`);
            return;
          }
        } catch { /* 该端口不是可复用的 EvalPilot 服务，继续自动恢复。 */ }
      }
      const server = await startDashboardServer(cwd, parsedPort, dashboardAssetsRoot(), automaticRecovery);
      if (process.platform === 'darwin' && process.env.EVALPILOT_NO_OPEN !== '1') execFile('open', [`http://127.0.0.1:${server.port}`], () => undefined);
      process.stdout.write(`EvalPilot Dashboard 已启动。\n地址：http://127.0.0.1:${server.port}\n仅允许本机访问；按 Ctrl+C 停止。\n`);
      await new Promise<void>((resolveStop) => {
        const stop = () => { void server.close().finally(resolveStop); };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    });

  program
    .command('report')
    .description('生成覆盖、问题和上线建议报告')
    .option('--confirm-failures', '将本轮明确 failed 的案例加入回归集')
    .action(async ({ confirmFailures }: { confirmFailures?: boolean }) => {
      const report = await buildReport(await loadConfig(cwd), Boolean(confirmFailures));
      process.stdout.write(
        `评测报告已生成。\n问题/阻塞：${report.issues.length}\n上线建议：${report.recommendation}\n新增回归：${report.confirmedFailuresAdded}\n报告：${resolve((await loadConfig(cwd)).outputDir, 'reports', 'LATEST_REPORT.md')}\n`,
      );
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof EvalPilotError) {
      process.stderr.write(`EvalPilot 无法完成操作：${error.message}\n错误代码：${error.code}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function isCliEntry(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isCliEntry()) {
  await runCli();
}
