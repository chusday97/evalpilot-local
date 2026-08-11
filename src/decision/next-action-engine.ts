import { resolve } from 'node:path';
import type { EvaluationNextAction } from '../../types.js';
import { badcasePath, loadBadcase } from '../badcase/badcase-store.js';
import { loadEvalSetCases } from '../eval-set/eval-set-store.js';
import { findingPath, loadFinding } from '../findings/finding-store.js';
import { evalCaseResultPath, loadEvalCaseResult } from '../judge/eval-result-store.js';
import { configForProject } from '../projects/project-registry.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { EvalPilotError } from '../utils/errors.js';
import { pathExists } from '../utils/file-system.js';
import { readSchemaJson } from '../utils/schema-file.js';
import { evaluationNextActionSchema } from './schemas.js';
import type { EvaluationDecisionInput } from './types.js';

const unique = (values: string[]): string[] => [...new Set(values)];
const detailRoute = (path: string, key: string, id: string): string => `${path}?${key}=${encodeURIComponent(id)}`;

function action(value: EvaluationNextAction): EvaluationNextAction {
  return evaluationNextActionSchema.parse({
    ...value,
    targetCaseIds: unique(value.targetCaseIds),
    targetFindingIds: unique(value.targetFindingIds),
    targetBadcaseIds: unique(value.targetBadcaseIds),
  });
}

function pendingCaseIds(input: EvaluationDecisionInput): string[] {
  const packetIds = input.evidencePackets
    .filter((packet) => packet.stepEvidence.some((step) => step.taskState?.state === 'pending' || step.taskState?.state === 'progressing'))
    .map((packet) => packet.caseId);
  return unique(packetIds.length ? packetIds : input.selectedCases.filter((item) => !input.results.some((result) => result.caseId === item.caseId)).map((item) => item.caseId));
}

function confirmedLineage(input: EvaluationDecisionInput): {
  findings: EvaluationDecisionInput['findings'];
  badcases: EvaluationDecisionInput['badcases'];
  fixTasks: EvaluationDecisionInput['fixTasks'];
} {
  const findings = input.findings.filter((item) => item.status === 'confirmed_product_failure');
  const confirmedCaseIds = new Set([...findings.map((item) => item.caseId), ...input.badcases.map((item) => item.caseId)]);
  const badcases = input.badcases.filter((item) => confirmedCaseIds.has(item.caseId));
  const findingIds = new Set(findings.map((item) => item.findingId));
  const badcaseIds = new Set(badcases.map((item) => item.badcaseId));
  const fixTasks = input.fixTasks.filter((item) =>
    (item.sourceType === 'confirmed_finding' && item.findingId !== null && findingIds.has(item.findingId))
    || (item.sourceType === 'badcase' && item.badcaseId !== null && badcaseIds.has(item.badcaseId)));
  return { findings, badcases, fixTasks };
}

/** Returns exactly one report-level recommendation using the precedence defined in CONTRACT.md. */
export function decideEvaluationNextAction(input: EvaluationDecisionInput): EvaluationNextAction {
  if (input.evaluationStatus === 'queued' || input.evaluationStatus === 'running'
    || input.evidencePackets.some((packet) => packet.stepEvidence.some((step) => step.taskState?.state === 'pending' || step.taskState?.state === 'progressing'))) {
    const caseIds = pendingCaseIds(input);
    return action({
      type: 'wait_and_resume', title: '等待当前任务完成', explanation: '页面仍在处理任务。EvalPilot 会保留进度，完成后再继续判断，不会把等待误报为失败。',
      targetCaseIds: caseIds, targetFindingIds: [], targetBadcaseIds: [],
      primaryCta: { label: '查看当前进度', route: detailRoute('/evaluate', 'evaluationId', input.evaluationId) }, secondaryCtas: [],
    });
  }

  const confirmed = confirmedLineage(input);
  if (confirmed.findings.length || confirmed.badcases.length) {
    const fixed = confirmed.badcases.filter((item) => item.fixStatus === 'fixed' && item.regressionCaseId === null
      && input.results.some((result) => result.caseId === item.caseId && result.verdict === 'pass'));
    if (fixed.length) {
      return action({
        type: 'add_to_regression', title: '把已修好的问题加入回归', explanation: '这个已确认问题已经修复并通过复测。加入回归后，后续版本会继续检查它。',
        targetCaseIds: fixed.map((item) => item.caseId), targetFindingIds: confirmed.findings.map((item) => item.findingId), targetBadcaseIds: fixed.map((item) => item.badcaseId),
        primaryCta: { label: '加入回归检查', route: detailRoute('/regression', 'badcaseId', fixed[0]!.badcaseId) }, secondaryCtas: [],
      });
    }
    const fixExists = confirmed.fixTasks.length > 0 || confirmed.badcases.some((item) => item.fixStatus === 'in_progress' || item.fixStatus === 'fixed');
    if (fixExists) {
      const task = confirmed.fixTasks[0]; const badcase = confirmed.badcases[0];
      return action({
        type: 'retest_fix', title: '复测这次修复', explanation: '已有针对确认问题的修复任务，但还没有形成“同一案例已通过”的闭环证据。',
        targetCaseIds: unique([...confirmed.findings.map((item) => item.caseId), ...confirmed.badcases.map((item) => item.caseId)]), targetFindingIds: confirmed.findings.map((item) => item.findingId), targetBadcaseIds: confirmed.badcases.map((item) => item.badcaseId),
        primaryCta: task
          ? { label: '查看并复测修复', route: detailRoute('/fixes', 'fixTaskId', task.fixTaskId) }
          : { label: '查看并复测修复', route: detailRoute('/findings', 'badcaseId', badcase!.badcaseId) }, secondaryCtas: [],
      });
    }
    const firstFinding = confirmed.findings[0]; const firstBadcase = confirmed.badcases[0];
    return action({
      type: 'create_fix_task', title: '为已确认问题创建修复任务', explanation: '这不是单次模型猜测：产品失败已经确认，现在可以安全地进入隔离修复流程。',
      targetCaseIds: unique([...confirmed.findings.map((item) => item.caseId), ...confirmed.badcases.map((item) => item.caseId)]), targetFindingIds: confirmed.findings.map((item) => item.findingId), targetBadcaseIds: confirmed.badcases.map((item) => item.badcaseId),
      primaryCta: firstFinding
        ? { label: '生成 Codex 修复任务', route: detailRoute('/findings', 'findingId', firstFinding.findingId) }
        : { label: '生成 Codex 修复任务', route: detailRoute('/findings', 'badcaseId', firstBadcase!.badcaseId) }, secondaryCtas: [],
    });
  }

  const reviewRequired = input.findings.filter((item) => item.status === 'needs_human_review');
  if (reviewRequired.length) {
    return action({
      type: 'confirm_product_failure', title: '请确认这是不是产品问题', explanation: '现有证据需要你补充业务判断。确认前不会创建修复任务，也不会把它写入产品回归集。',
      targetCaseIds: reviewRequired.map((item) => item.caseId), targetFindingIds: reviewRequired.map((item) => item.findingId), targetBadcaseIds: [],
      primaryCta: { label: '查看证据并确认', route: detailRoute('/findings', 'findingId', reviewRequired[0]!.findingId) }, secondaryCtas: [],
    });
  }

  const candidates = input.findings.filter((item) => item.status === 'candidate');
  if (candidates.length) {
    return action({
      type: 'review_candidate_finding', title: '先复核候选发现', explanation: '评测发现了可疑现象，但证据还不足以认定为产品失败。请先查看事实和不确定项。',
      targetCaseIds: candidates.map((item) => item.caseId), targetFindingIds: candidates.map((item) => item.findingId), targetBadcaseIds: [],
      primaryCta: { label: '复核候选发现', route: detailRoute('/findings', 'findingId', candidates[0]!.findingId) }, secondaryCtas: [],
    });
  }

  const humanInputCases = input.selectedCases.filter((evalCase) => evalCase.needsHumanReview && (!input.results.some((result) => result.caseId === evalCase.caseId) || input.results.some((result) => result.caseId === evalCase.caseId && result.verdict === 'inconclusive')));
  if (humanInputCases.length) {
    return action({
      type: 'provide_human_input', title: '补充一项业务判断', explanation: '这个案例依赖尚未确认的业务规则。补充真实期望后才能继续，系统不会自行猜测。',
      targetCaseIds: humanInputCases.map((item) => item.caseId), targetFindingIds: [], targetBadcaseIds: [],
      primaryCta: { label: '查看待确认内容', route: detailRoute('/eval-set', 'caseId', humanInputCases[0]!.caseId) }, secondaryCtas: [],
    });
  }

  const evaluatorCaseIds = unique([
    ...input.results.filter((item) => item.failureSource === 'evaluator').map((item) => item.caseId),
    ...input.findings.filter((item) => item.status === 'evaluator_failure').map((item) => item.caseId),
    ...(input.evaluationStatus === 'failed' ? input.selectedCases.map((item) => item.caseId) : []),
  ]);
  if (evaluatorCaseIds.length) {
    return action({
      type: 'rerun_case', title: '重新运行评测案例', explanation: '这次失败来自评测器或证据采集，不代表产品失败。先重跑同一案例再判断。',
      targetCaseIds: evaluatorCaseIds, targetFindingIds: input.findings.filter((item) => item.status === 'evaluator_failure').map((item) => item.findingId), targetBadcaseIds: [],
      primaryCta: input.evaluationStatus === 'failed'
        ? { label: '重新评测', route: detailRoute('/evaluate', 'evaluationId', input.evaluationId) }
        : { label: '重新评测', route: detailRoute('/eval-set', 'caseId', evaluatorCaseIds[0]!) }, secondaryCtas: [],
    });
  }

  const completedCaseIds = new Set(input.results.map((item) => item.caseId));
  const remaining = input.selectedCases.filter((item) => !completedCaseIds.has(item.caseId));
  if (remaining.length) {
    return action({
      type: 'run_remaining_cases', title: '运行剩余案例', explanation: `还有 ${remaining.length} 个已选择案例没有真实运行；完成后才能形成完整结论。`,
      targetCaseIds: remaining.map((item) => item.caseId), targetFindingIds: [], targetBadcaseIds: [],
      primaryCta: { label: '运行剩余案例', route: detailRoute('/evaluate', 'evaluationId', input.evaluationId) }, secondaryCtas: [],
    });
  }

  const critical = input.selectedCases.filter((item) => item.riskLevel === 'P0' || item.riskLevel === 'P1');
  const allCriticalPass = critical.length > 0 && critical.every((evalCase) => input.results.some((result) => result.caseId === evalCase.caseId && result.verdict === 'pass'));
  return action({
    type: 'no_action', title: allCriticalPass ? '当前无需处理' : '没有可安全推荐的动作',
    explanation: allCriticalPass ? '所有已选择的关键案例都已通过，且没有待确认的产品失败。' : '当前证据没有形成可执行结论；系统不会为了给出建议而猜测。',
    targetCaseIds: [], targetFindingIds: [], targetBadcaseIds: [], primaryCta: null,
    secondaryCtas: [{ label: '查看评测集', route: '/eval-set' }],
  });
}

export async function nextActionForEvaluation(cwd: string, evaluationId: string, projectId: string): Promise<EvaluationNextAction> {
  // Keep dashboard and fix services out of the pure decision module's initialization graph.
  const [{ listEvaluations }, { listFixTasks }] = await Promise.all([
    import('../dashboard/evaluation-manager.js'),
    import('../agents/fix-service.js'),
  ]);
  const config = await configForProject(cwd, projectId);
  const session = (await listEvaluations(cwd, projectId)).find((item) => item.evaluationId === evaluationId);
  if (!session) throw new EvalPilotError(`没有找到评测：${evaluationId}`, 'EVALUATION_NOT_FOUND');
  if (session.runtime === 'legacy') {
    return action({ type: 'no_action', title: '旧评测仅供查看', explanation: '旧记录缺少新式 Case、证据和 Finding 谱系，系统不会据此猜测下一步。请新建一次 Adaptive 评测。', targetCaseIds: [], targetFindingIds: [], targetBadcaseIds: [], primaryCta: null, secondaryCtas: [{ label: '新建评测', route: '/evaluate' }] });
  }

  const allCases = await loadEvalSetCases(config.outputDir).catch(() => []);
  const selected = new Set(session.selectedCaseIds);
  const selectedCases = allCases.filter((item) => selected.has(item.caseId));
  const results = [];
  const evidencePackets = [];
  for (const runId of session.runIds) {
    if (await pathExists(evalCaseResultPath(config.outputDir, runId))) results.push(await loadEvalCaseResult(config.outputDir, runId));
    const packetPath = resolve(config.outputDir, 'runs', runId, 'evidence-packet.json');
    if (await pathExists(packetPath)) evidencePackets.push(await readSchemaJson(packetPath, evidencePacketSchema));
  }
  const findings = [];
  for (const findingId of session.findingIds) if (await pathExists(findingPath(config.outputDir, findingId)) || await pathExists(resolve(config.outputDir, 'findings', 'v1', `${findingId}.json`))) findings.push(await loadFinding(config.outputDir, findingId));
  const badcases = [];
  for (const badcaseId of session.badcaseIds) if (await pathExists(badcasePath(config.outputDir, badcaseId))) badcases.push(await loadBadcase(config.outputDir, badcaseId));
  const fixTasks = (await listFixTasks(cwd, projectId)).filter((item) => item.evaluationId === evaluationId || (item.findingId !== null && session.findingIds.includes(item.findingId)) || (item.badcaseId !== null && session.badcaseIds.includes(item.badcaseId)));
  return decideEvaluationNextAction({ evaluationId, evaluationStatus: session.status, selectedCases, results, findings, badcases, fixTasks, evidencePackets });
}
