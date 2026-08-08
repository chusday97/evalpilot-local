import type { Badcase, CandidateFinding, EvalCase, EvalCaseResult, EvidencePacket, FindingStatus } from '../../types.js';
import { createAndSaveBadcase } from '../badcase/badcase-service.js';
import { loadEvalSetCases } from '../eval-set/eval-set-store.js';
import { loadEvalCaseResult, saveEvalCaseResult } from '../judge/eval-result-store.js';
import { evalCaseResultSchema } from '../judge/schemas.js';
import { calculateEvidenceCompleteness } from '../test-agent/evidence-packet.js';
import { candidateFindingSchema } from './schemas.js';
import { listFindings, loadFinding, saveFinding } from './finding-store.js';

export interface FindingTriageOutcome {
  result: EvalCaseResult;
  finding: CandidateFinding | null;
  badcase: Badcase | null;
}

function normalizedFailure(value: string): string {
  return value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

function normalizedCategory(value: string): string {
  if (/network|request|api|接口|请求/i.test(value)) return 'api';
  if (/navigate|route|link|导航|路由|返回/i.test(value)) return 'navigation';
  if (/click|button|feedback|交互|按钮|反馈/i.test(value)) return 'interaction';
  if (/state|persist|refresh|状态|保存|刷新/i.test(value)) return 'state';
  if (/slow|timeout|performance|超时|性能/i.test(value)) return 'performance';
  return 'functional';
}

function matchingReference(candidate: string, reference: string): boolean {
  return candidate === reference || candidate.endsWith(reference) || reference.endsWith(candidate);
}

function validSemanticEvidence(packet: EvidencePacket, result: EvalCaseResult): { refs: string[]; types: string[] } {
  const byType = new Map<string, string[]>([
    ['network', packet.networkEvidence],
    ['console', packet.consoleEvidence],
    ['trace', packet.tracePath ? [packet.tracePath] : []],
    ['screenshot', packet.screenshots],
    ['deterministic_assertion', result.deterministic.evidenceRefs],
    ['interaction', packet.actions.flatMap((item) => item.evidence)],
    ['step_verification', packet.stepVerifications.flatMap((item) => item.evidenceRefs)],
  ]);
  const refs = [...new Set(result.semantic.evidenceRefs.filter((candidate) => [...byType.values()].some((references) => references.some((reference) => matchingReference(candidate, reference)))))];
  const types = [...new Set(refs.map((candidate) => [...byType.entries()].find(([, references]) => references.some((reference) => matchingReference(candidate, reference)))?.[0]).filter((type): type is string => Boolean(type)))];
  return { refs, types };
}

function asProductFailure(result: EvalCaseResult, evalCase: EvalCase): EvalCaseResult {
  return evalCaseResultSchema.parse({ ...result, verdict: 'fail', failureSource: 'product', severity: result.deterministic.severity ?? evalCase.riskLevel });
}

function findingFrom(input: { evalCase: EvalCase; result: EvalCaseResult; status: FindingStatus; evidenceRefs: string[]; evidenceTypes: string[]; now: string }): CandidateFinding {
  return candidateFindingSchema.parse({
    findingId: `finding-${input.result.runId}`,
    projectId: input.evalCase.projectId,
    caseId: input.evalCase.caseId,
    runId: input.result.runId,
    title: input.status === 'confirmed_product_failure' ? input.result.semantic.summary : `可疑问题：${input.evalCase.title}`,
    summary: input.result.semantic.summary,
    status: input.status,
    semanticConfidence: input.result.semantic.confidence,
    deterministicSupport: input.result.deterministic.hardFailure,
    independentEvidenceTypes: input.evidenceTypes,
    confirmedFacts: input.result.semantic.confirmedFacts,
    hypotheses: input.result.semantic.hypotheses,
    unknowns: input.result.semantic.unknowns,
    evidenceRefs: input.evidenceRefs,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function hasRepeatedStableFailure(outputDir: string, evalCase: EvalCase, result: EvalCaseResult): Promise<boolean> {
  if (evalCase.status !== 'stable') return false;
  const category = normalizedCategory(result.semantic.summary);
  const observed = normalizedFailure(result.semantic.summary);
  return (await listFindings(outputDir)).some((finding) => finding.caseId === evalCase.caseId
    && finding.runId !== result.runId
    && ['candidate', 'confirmed_product_failure'].includes(finding.status)
    && normalizedCategory(finding.summary) === category
    && normalizedFailure(finding.summary) === observed);
}

export async function triageEvalCaseFinding(input: { outputDir: string; evalCase: EvalCase; result: EvalCaseResult; packet: EvidencePacket; createdAt?: string }): Promise<FindingTriageOutcome> {
  const now = input.createdAt ?? new Date().toISOString();
  const complete = calculateEvidenceCompleteness(input.packet).complete;
  const evidence = validSemanticEvidence(input.packet, input.result);
  let status: FindingStatus | null = null;
  let result = input.result;

  if (result.failureSource === 'evaluator') status = 'evaluator_failure';
  else if (complete && result.deterministic.hardFailure) status = 'confirmed_product_failure';
  else if (complete && result.semantic.verdict === 'fail') {
    if (input.evalCase.needsHumanReview) status = 'needs_human_review';
    else if (result.semantic.confidence >= 0.8 && evidence.refs.length >= 2 && evidence.types.length >= 2) status = 'confirmed_product_failure';
    else if (await hasRepeatedStableFailure(input.outputDir, input.evalCase, result)) status = 'confirmed_product_failure';
    else status = 'candidate';
  }

  if (!status) return { result, finding: null, badcase: null };
  if (status === 'confirmed_product_failure') result = asProductFailure(result, input.evalCase);
  else if (result.semantic.verdict === 'fail' && result.failureSource !== 'evaluator') result = evalCaseResultSchema.parse({ ...result, verdict: 'inconclusive', failureSource: 'unknown', severity: null });

  const finding = findingFrom({ evalCase: input.evalCase, result, status, evidenceRefs: evidence.refs, evidenceTypes: evidence.types, now });
  await saveEvalCaseResult(input.outputDir, result);
  await saveFinding(input.outputDir, finding);
  const badcase = status === 'confirmed_product_failure'
    ? await createAndSaveBadcase(input.outputDir, { evalCase: input.evalCase, result, finding, createdAt: now })
    : null;
  return { result, finding, badcase };
}

async function caseForFinding(outputDir: string, finding: CandidateFinding): Promise<EvalCase> {
  const evalCase = (await loadEvalSetCases(outputDir)).find((item) => item.caseId === finding.caseId);
  if (!evalCase || evalCase.projectId !== finding.projectId) throw new Error(`没有找到 Finding 对应的评测案例：${finding.caseId}`);
  return evalCase;
}

function transitionAllowed(finding: CandidateFinding): void {
  if (!['candidate', 'needs_human_review'].includes(finding.status)) throw new Error(`Finding 当前状态为 ${finding.status}，不能再次变更。`);
}

export async function confirmProductFailure(outputDir: string, findingId: string, updatedAt = new Date().toISOString()): Promise<{ finding: CandidateFinding; badcase: Badcase }> {
  const finding = await loadFinding(outputDir, findingId);
  if (finding.status !== 'confirmed_product_failure') transitionAllowed(finding);
  const [evalCase, originalResult] = await Promise.all([caseForFinding(outputDir, finding), loadEvalCaseResult(outputDir, finding.runId)]);
  const result = asProductFailure(originalResult, evalCase);
  const confirmed = finding.status === 'confirmed_product_failure' ? finding : candidateFindingSchema.parse({ ...finding, status: 'confirmed_product_failure', title: originalResult.semantic.summary, updatedAt });
  await saveEvalCaseResult(outputDir, result);
  await saveFinding(outputDir, confirmed);
  const badcase = await createAndSaveBadcase(outputDir, { evalCase, result, finding: confirmed, createdAt: updatedAt });
  return { finding: confirmed, badcase };
}

export async function markEvaluatorFailure(outputDir: string, findingId: string, updatedAt = new Date().toISOString()): Promise<CandidateFinding> {
  const finding = await loadFinding(outputDir, findingId); if (finding.status === 'evaluator_failure') return finding; transitionAllowed(finding);
  const result = await loadEvalCaseResult(outputDir, finding.runId);
  await saveEvalCaseResult(outputDir, evalCaseResultSchema.parse({ ...result, verdict: 'inconclusive', failureSource: 'evaluator', severity: null }));
  return saveFinding(outputDir, candidateFindingSchema.parse({ ...finding, status: 'evaluator_failure', updatedAt }));
}

export async function dismissFinding(outputDir: string, findingId: string, updatedAt = new Date().toISOString()): Promise<CandidateFinding> {
  const finding = await loadFinding(outputDir, findingId); if (finding.status === 'dismissed') return finding; transitionAllowed(finding);
  return saveFinding(outputDir, candidateFindingSchema.parse({ ...finding, status: 'dismissed', updatedAt }));
}
