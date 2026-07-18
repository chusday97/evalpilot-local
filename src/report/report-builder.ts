import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CoverageReport, EvalPilotConfig, Issue, RegressionCase, RunResult, Scenario, Severity } from '../../types.js';
import { scenarioSchema } from '../schemas/scenario.js';
import { EvalPilotError } from '../utils/errors.js';
import { readJsonLinesFile, writeJsonAtomic, writeJsonLinesAtomic, writeTextAtomic } from '../utils/file-system.js';
import { buildIssue } from './issue-builder.js';

interface RunSummary {
  targetUrl: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notApplicable?: number;
  results: RunResult[];
  completedAt: string;
}

export interface ReportResult {
  issues: Issue[];
  recommendation: '可以上线' | '有条件上线' | '不建议上线';
  confirmedFailuresAdded: number;
  runDirectory: string;
}

async function latestRunDirectory(outputDir: string): Promise<string> {
  const runsDir = resolve(outputDir, 'runs');
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    throw new EvalPilotError(`无法读取运行记录：${String(error)}`, 'RUN_RESULTS_REQUIRED');
  }
  const latest = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
  if (!latest) throw new EvalPilotError('没有浏览器运行记录，请先运行 evalpilot run。', 'RUN_RESULTS_REQUIRED');
  return resolve(runsDir, latest);
}

function severityCounts(issues: Issue[]): Record<Severity, number> {
  return {
    P0: issues.filter((issue) => issue.severity === 'P0').length,
    P1: issues.filter((issue) => issue.severity === 'P1').length,
    P2: issues.filter((issue) => issue.severity === 'P2').length,
    P3: issues.filter((issue) => issue.severity === 'P3').length,
  };
}

function recommendationFor(summary: RunSummary, issues: Issue[]): ReportResult['recommendation'] {
  if (issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1')) return '不建议上线';
  if (summary.blocked > 0 || issues.length > 0) return '有条件上线';
  return '可以上线';
}

function renderIssue(issue: Issue): string {
  return `## ${issue.title}\n\n- Issue ID：${issue.issueId}\n- 严重程度：${issue.severity}\n- 功能模块：${issue.capability}\n- Persona：${issue.persona}\n- 对应案例：${issue.caseId}\n- 复现步骤：${issue.reproductionSteps.join(' → ') || '无自动步骤'}\n- 预期结果：${issue.expectedResult.join('；')}\n- 实际结果：${issue.actualResult}\n- 用户影响：${issue.userImpact}\n- 截图：${issue.screenshots.join('；') || '无'}\n- Trace：${issue.trace ?? '无'}\n- 控制台错误：${issue.consoleErrors.map((item) => item.message).join('；') || '无'}\n- 网络错误：${issue.networkErrors.map((item) => `${item.method ?? ''} ${item.url ?? ''} ${item.message}`.trim()).join('；') || '无'}\n- 可能原因：${issue.possibleCause}\n- 建议排查文件：${issue.suggestedLocation}\n- 是否加入回归：${issue.addedToRegression ? '是' : '否'}\n`;
}

function renderReport(summary: RunSummary, coverage: CoverageReport, issues: Issue[], recommendation: ReportResult['recommendation']): string {
  const counts = severityCounts(issues);
  const coverageLines = Object.entries(coverage.dimensions).map(
    ([name, value]) => `- ${name}：${Math.round(value.ratio * 100)}%（缺失：${value.missing.join(', ') || '无'}）`,
  );
  const blockers = issues.filter((issue) => issue.severity === 'P0' || issue.severity === 'P1' || issue.title.startsWith('评测阻塞'));
  return `# EvalPilot Local 最新评测报告\n\n` +
    `> 运行完成：${summary.completedAt}\n\n## 总体结果\n\n- 生成案例数量：${coverage.totalCases}\n- 自动执行数量：${summary.total}\n- 通过：${summary.passed}\n- 失败：${summary.failed}\n- 阻塞：${summary.blocked}\n- 不适用：${summary.notApplicable ?? 0}\n- P0/P1/P2/P3：${counts.P0}/${counts.P1}/${counts.P2}/${counts.P3}\n\n` +
    `## 覆盖情况\n\n${coverageLines.join('\n')}\n\n` +
    `## 上线建议\n\n**${recommendation}**\n\n` +
    `${blockers.length ? `具体阻断/条件项：\n${blockers.map((issue) => `- ${issue.issueId}：${issue.title}`).join('\n')}` : '当前自动执行未发现阻断项。'}\n\n` +
    `## 漏洞与评测阻塞\n\n${issues.length ? issues.map(renderIssue).join('\n') : '本轮没有生成问题。'}\n`;
}

async function addConfirmedFailures(
  outputDir: string,
  summary: RunSummary,
  scenarioMap: Map<string, Scenario>,
  issues: Issue[],
): Promise<number> {
  const regressionPath = resolve(outputDir, 'regression', 'regression-cases.jsonl');
  let existing: RegressionCase[] = [];
  try {
    existing = await readJsonLinesFile<RegressionCase>(regressionPath);
  } catch (error) {
    throw new EvalPilotError(`无法读取回归集：${String(error)}`, 'REGRESSION_READ_FAILED');
  }
  const ids = new Set(existing.map((item) => item.originalIssueId));
  let added = 0;
  for (const result of summary.results.filter((item) => item.status === 'failed')) {
    const scenario = scenarioMap.get(result.caseId);
    const issue = issues.find((item) => item.caseId === result.caseId);
    if (!scenario || !issue || ids.has(issue.issueId)) continue;
    issue.addedToRegression = true;
    existing.push({
      originalIssueId: issue.issueId,
      scenario,
      fixVersion: null,
      fixFiles: [],
      expectedResult: scenario.expectedBehavior,
      automatedAssertions: scenario.hardAssertions,
      lastRunResult: result.status,
    });
    ids.add(issue.issueId);
    added += 1;
  }
  await writeJsonLinesAtomic(regressionPath, existing);
  return added;
}

export async function buildReport(config: EvalPilotConfig, confirmFailures = false): Promise<ReportResult> {
  const runDirectory = await latestRunDirectory(config.outputDir);
  let summary: RunSummary;
  let scenarios: Scenario[];
  let coverage: CoverageReport;
  try {
    summary = JSON.parse(await readFile(resolve(runDirectory, 'summary.json'), 'utf8')) as RunSummary;
    scenarios = (await readJsonLinesFile<Scenario>(resolve(config.outputDir, 'scenarios.jsonl'))).map((item) => scenarioSchema.parse(item));
    coverage = JSON.parse(await readFile(resolve(config.outputDir, 'reports', 'coverage.json'), 'utf8')) as CoverageReport;
  } catch (error) {
    throw new EvalPilotError(`报告所需文件缺失或损坏：${String(error)}`, 'REPORT_INPUT_INVALID');
  }
  const scenarioMap = new Map(scenarios.map((scenario) => [scenario.caseId, scenario]));
  const issues = summary.results.flatMap((result) => {
    const scenario = scenarioMap.get(result.caseId);
    if (!scenario) return [];
    const issue = buildIssue(result, scenario);
    return issue ? [issue] : [];
  });
  const confirmedFailuresAdded = confirmFailures
    ? await addConfirmedFailures(config.outputDir, summary, scenarioMap, issues)
    : 0;
  const recommendation = recommendationFor(summary, issues);
  await Promise.all([
    writeJsonLinesAtomic(resolve(config.outputDir, 'reports', 'issues.jsonl'), issues),
    writeTextAtomic(resolve(config.outputDir, 'reports', 'LATEST_REPORT.md'), renderReport(summary, coverage, issues, recommendation)),
    writeJsonAtomic(resolve(config.outputDir, 'reports', 'report-metadata.json'), {
      sourceRun: runDirectory,
      recommendation,
      issueCount: issues.length,
      confirmedFailuresAdded,
      generatedAt: new Date().toISOString(),
    }),
  ]);
  return { issues, recommendation, confirmedFailuresAdded, runDirectory };
}
