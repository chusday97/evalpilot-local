import type {
  BlueprintCapability,
  CapabilityExecutionStatus,
  EvaluationCapabilityCoverage,
  EvaluationCoverageSummary,
  EvaluationDepth,
  ExploratoryScenario,
} from '../../types.js';

const statusPriority: Record<CapabilityExecutionStatus, number> = {
  not_run: 0,
  not_applicable: 1,
  passed: 2,
  blocked: 3,
  failed: 4,
};

function routeMatches(entryPoint: string | null, visitedPath: string): boolean {
  if (!entryPoint) return false;
  const pattern = entryPoint
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${pattern}/?$`).test(visitedPath);
}

function summarize(capabilities: EvaluationCapabilityCoverage[]): EvaluationCoverageSummary {
  const planned = capabilities.filter((item) => item.reason !== '本轮未选择');
  const executed = planned.filter((item) => item.executionStatus !== 'not_run');
  return {
    discoveredCount: capabilities.filter((item) => item.discovered).length,
    plannedCount: planned.length,
    browserVisitedCount: planned.filter((item) => item.browserVisited).length,
    executedCount: executed.length,
    passedCount: planned.filter((item) => item.executionStatus === 'passed').length,
    failedCount: planned.filter((item) => item.executionStatus === 'failed').length,
    blockedCount: planned.filter((item) => item.executionStatus === 'blocked').length,
    notApplicableCount: planned.filter((item) => item.executionStatus === 'not_applicable').length,
    notRunCount: planned.filter((item) => item.executionStatus === 'not_run').length,
    complete: planned.length > 0 && executed.length === planned.length,
    capabilities,
  };
}

export function planCapabilities(
  capabilities: BlueprintCapability[],
  requestedIds: string[],
  depth: EvaluationDepth,
): BlueprintCapability[] {
  const requested = requestedIds.length
    ? capabilities.filter((item) => requestedIds.includes(item.id))
    : capabilities.filter((item) => depth === 'quick'
      ? item.importance === 'critical'
      : depth === 'core'
        ? item.importance === 'critical' || item.importance === 'high'
        : true);
  const limit = depth === 'quick' ? 1 : depth === 'core' ? 3 : requested.length;
  return requested.slice(0, limit);
}

export function selectExploratoryScenarios(
  scenarios: ExploratoryScenario[],
  plannedIds: string[],
  depth: EvaluationDepth,
): ExploratoryScenario[] {
  const matching = scenarios.filter((item) => plannedIds.includes(item.capability));
  if (depth === 'full') return matching;
  return plannedIds.flatMap((capabilityId) => matching.find((item) => item.capability === capabilityId) ?? []);
}

export function buildEvaluationCoverage(
  allCapabilities: BlueprintCapability[],
  planned: BlueprintCapability[],
  visitedPaths: string[],
): EvaluationCoverageSummary {
  const plannedIds = new Set(planned.map((item) => item.id));
  return summarize(allCapabilities.map((item) => {
    const selected = plannedIds.has(item.id);
    return {
      capabilityId: item.id,
      capabilityName: item.name,
      entryPoint: item.entryPoints[0] ?? null,
      discovered: true,
      browserVisited: item.entryPoints.some((entry) => visitedPaths.some((path) => routeMatches(entry, path))),
      executionStatus: 'not_run',
      runIds: [],
      reason: selected ? '等待执行' : '本轮未选择',
    };
  }));
}

export function recordCapabilityRun(
  summary: EvaluationCoverageSummary,
  capabilityId: string,
  runId: string,
  status: Exclude<CapabilityExecutionStatus, 'not_run'>,
  browserVisited = true,
): EvaluationCoverageSummary {
  return summarize(summary.capabilities.map((item) => {
    if (item.capabilityId !== capabilityId) return item;
    const executionStatus = statusPriority[status] > statusPriority[item.executionStatus] ? status : item.executionStatus;
    return {
      ...item,
      browserVisited: item.browserVisited || browserVisited,
      executionStatus,
      runIds: [...new Set([...item.runIds, runId])],
      reason: executionStatus === 'passed'
        ? '用户任务和完整闭环已通过'
        : executionStatus === 'not_applicable'
          ? '项目没有对应能力，本次跳过'
          : executionStatus === 'blocked'
            ? '缺少执行前提，尚不能下结论'
            : '真实运行发现失败',
    };
  }));
}
