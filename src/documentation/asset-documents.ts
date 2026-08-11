import { resolve } from 'node:path';
import type { Badcase, EvalCase, EvalSetManifest, EvaluatorBadcase } from '../../types.js';
import { writeTextAtomic } from '../utils/file-system.js';

const setLabels: Record<string, string> = { baseline: '基础案例', regression: '回归案例', challenge: '加强检查', exploratory: '探索案例' };
const caseStatusLabels: Record<string, string> = { candidate: '待审核', active: '可运行', stable: '稳定', retired: '已退役' };
const fixStatusLabels: Record<string, string> = { open: '待处理', in_progress: '处理中', fixed: '已修复', wont_fix: '不处理' };

function text(value: unknown): string {
  return String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', ' ');
}

function cell(value: unknown): string {
  return text(value).replaceAll('|', '\\|');
}

function list(values: string[], empty: string): string {
  return values.length ? values.map((value) => `- ${text(value)}`).join('\n') : `- ${text(empty)}`;
}

export function evalSetDocumentPath(outputDir: string): string {
  return resolve(outputDir, 'eval-sets', 'EVAL_SET.md');
}

export function productBadcaseDocumentPath(outputDir: string): string {
  return resolve(outputDir, 'badcases', 'BADCASES.md');
}

export function evaluatorBadcaseDocumentPath(outputDir: string): string {
  return resolve(outputDir, 'evaluator-badcases', 'EVALUATOR_BADCASES.md');
}

export async function writeEvalSetDocument(outputDir: string, manifest: EvalSetManifest, cases: EvalCase[]): Promise<void> {
  const counts = { baseline: 0, regression: 0, challenge: 0, exploratory: 0 };
  for (const item of cases) counts[item.setType] += 1;
  const rows = [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId)).map((item) =>
    `| ${cell(item.caseId)} | ${cell(setLabels[item.setType] ?? item.setType)} | ${cell(caseStatusLabels[item.status] ?? item.status)} | ${cell(item.riskLevel)} | ${cell(item.title)} | ${cell(item.goal)} |`,
  );
  const details = [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId)).map((item) => `## ${text(item.title)}

- Case ID：\`${item.caseId}\`
- 类型：${setLabels[item.setType] ?? item.setType}
- 状态：${caseStatusLabels[item.status] ?? item.status}
- 风险：${item.riskLevel}
- 用户目标：${text(item.goal)}
- 评测假设：${text(item.hypothesis)}
- 需要人工审核：${item.needsHumanReview ? '是' : '否'}

### 通过标准

${list(item.oracle.expectedOutcome, '尚未定义')}

### 无法判断条件

${list(item.oracle.inconclusiveWhen, '尚未定义')}

### 覆盖维度

${list(item.coverageDimensions.map((dimension) => `${dimension.dimension}: ${dimension.value}`), '尚未定义')}
${item.regressionMetadata ? `
### 回归来源

- Product Badcase：\`${item.regressionMetadata.badcaseId}\`
- 首次失败运行：\`${item.regressionMetadata.sourceRunId}\`
` : ''}`).join('\n\n');

  await writeTextAtomic(evalSetDocumentPath(outputDir), `# Eval Set

> 由 EvalPilot 从 JSON 事实源自动生成，请勿手工修改。项目证据默认只保存在本机。

- 项目：\`${manifest.projectId}\`
- 版本：${manifest.version}
- 更新时间：${manifest.updatedAt}
- 总案例：${cases.length}
- 基础 ${counts.baseline} · 回归 ${counts.regression} · 加强 ${counts.challenge} · 探索 ${counts.exploratory}

| Case ID | 集合 | 状态 | 风险 | 名称 | 用户目标 |
|---|---|---|---|---|---|
${rows.length ? rows.join('\n') : '| — | — | — | — | 暂无案例 | — |'}

${details || '当前还没有评测案例。'}
`);
}

export async function writeProductBadcaseDocument(outputDir: string, badcases: Badcase[]): Promise<void> {
  const rows = [...badcases].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map((item) =>
    `| ${cell(item.badcaseId)} | ${cell(item.severity)} | ${cell(item.category)} | ${cell(fixStatusLabels[item.fixStatus] ?? item.fixStatus)} | ${cell(item.title)} | ${cell(item.caseId)} |`,
  );
  const details = badcases.map((item) => `## ${text(item.title)}

- Badcase ID：\`${item.badcaseId}\`
- 来源案例：\`${item.caseId}\`
- 来源运行：\`${item.runId}\`
- 用户影响：${text(item.userImpact)}
- 实际失败：${text(item.observedFailure)}
- 修复状态：${fixStatusLabels[item.fixStatus] ?? item.fixStatus}
- 回归案例：${item.regressionCaseId ? `\`${item.regressionCaseId}\`` : '尚未建立'}

### 已确认事实

${list(item.confirmedFacts, '尚无')}

### 仍不确定

${list(item.unknowns, '当前没有额外未知项')}
`).join('\n\n');
  await writeTextAtomic(productBadcaseDocumentPath(outputDir), `# Product Badcases

> 由已确认的产品失败自动生成。Candidate Finding 和 Evaluator Failure 不会进入本清单。

| Badcase ID | 严重度 | 分类 | 状态 | 问题 | 来源案例 |
|---|---|---|---|---|---|
${rows.length ? rows.join('\n') : '| — | — | — | — | 暂无已确认产品问题 | — |'}

${details || '当前还没有已确认的 Product Badcase。'}
`);
}

export async function writeEvaluatorBadcaseDocument(outputDir: string, badcases: EvaluatorBadcase[]): Promise<void> {
  const rows = [...badcases].sort((left, right) => left.evaluatorBadcaseId.localeCompare(right.evaluatorBadcaseId)).map((item) =>
    `| ${cell(item.evaluatorBadcaseId)} | ${cell(item.category)} | ${item.resolved ? '已解决' : '待处理'} | ${cell(item.caseId)} | ${cell(item.runId)} |`,
  );
  const details = badcases.map((item) => `## ${item.evaluatorBadcaseId}

- 分类：${item.category}
- 来源案例：\`${item.caseId}\`
- 来源运行：\`${item.runId}\`
- 观察状态：${text(item.observedState)}
- 回归夹具：${item.regressionFixtureId ? `\`${item.regressionFixtureId}\`` : '尚未建立'}

### 已尝试动作

${list(item.attemptedActions, '没有形成可执行动作')}
`).join('\n\n');
  await writeTextAtomic(evaluatorBadcaseDocumentPath(outputDir), `# Evaluator Badcases

> 记录 EvalPilot 自身没有完成的评测步骤；它们不属于产品问题，也不会进入 Product Regression。

| Evaluator Badcase ID | 分类 | 状态 | 案例 | 运行 |
|---|---|---|---|---|
${rows.length ? rows.join('\n') : '| — | — | — | — | 暂无评测器问题 |'}

${details || '当前还没有 Evaluator Badcase。'}
`);
}
