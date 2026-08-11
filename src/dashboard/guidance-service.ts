import { resolve } from 'node:path';
import type { GuidedFlowState, GuidedFlowStep, UxIssue } from '../../types.js';
import { listFixTasks } from '../agents/fix-service.js';
import { loadProjectRegistry } from '../projects/project-registry.js';
import { pathExists, readJsonLinesFile } from '../utils/file-system.js';
import { listEvaluationRecords, listEvaluations } from './evaluation-manager.js';

function step(id: GuidedFlowStep['id'], title: string, description: string, route: string, anchor: string | null): GuidedFlowStep {
  return { id, title, description, status: 'waiting', actionLabel: null, route, anchor };
}

export async function buildGuidedFlow(cwd: string, requestedProjectId?: string): Promise<GuidedFlowState> {
  const registry = await loadProjectRegistry(cwd);
  const project = registry.projects.find((item) => item.projectId === requestedProjectId)
    ?? registry.projects.find((item) => item.projectId === registry.activeProjectId)
    ?? null;
  const steps: GuidedFlowStep[] = [
    step('project', '连接并启动项目', '选择要检查的本地产品，并确认页面可以打开。', '/projects#project-next-action', 'project-next-action'),
    step('evaluation', '运行推荐评测', '系统会替你选择合适的范围，并真实操作页面。', '/evaluate#recommended-evaluation', 'recommended-evaluation'),
    step('issues', '看懂发现的问题', '查看用户卡在哪里、直接证据和建议改法。', '/issues#evaluation-summary', 'evaluation-summary'),
    step('fix', '选择 AI 修复', '确认后在隔离分支修改、测试和复测。', '/fixes#fix-next-action', 'fix-next-action'),
  ];

  if (!project) {
    steps[0] = { ...steps[0]!, status: 'current', actionLabel: '连接第一个项目' };
    return { projectId: null, currentStep: 'project', steps, updatedAt: new Date().toISOString() };
  }

  steps[0] = project.status === 'ready'
    ? { ...steps[0]!, status: 'completed', actionLabel: null }
    : { ...steps[0]!, status: 'current', actionLabel: '启动当前项目' };
  if (project.status !== 'ready') return { projectId: project.projectId, currentStep: 'project', steps, updatedAt: new Date().toISOString() };

  const records = await listEvaluationRecords(cwd, project.projectId);
  const latest = records[0] ?? null;
  if (!latest || latest.status === 'failed' || latest.status === 'running' || latest.status === 'queued') {
    steps[1] = { ...steps[1]!, status: latest?.status === 'failed' ? 'attention' : 'current', actionLabel: latest?.status === 'failed' ? '继续上次评测' : latest ? '查看评测进度' : '按推荐方案开始' };
    return { projectId: project.projectId, currentStep: 'evaluation', steps, updatedAt: new Date().toISOString() };
  }

  steps[1] = { ...steps[1]!, status: 'completed', actionLabel: null };
  const latestSession = (await listEvaluations(cwd, project.projectId)).find((item) => item.evaluationId === latest.evaluationId) ?? null;
  if (latestSession?.runtime === 'adaptive') {
    steps[2] = {
      ...steps[2]!,
      title: '查看运行与发现',
      description: '先看 AI 用户实际做了什么，再处理候选发现或已确认问题。',
      route: `/runs?evaluationId=${encodeURIComponent(latestSession.evaluationId)}`,
      anchor: null,
      status: latest.issueCount > 0 ? 'current' : 'completed',
      actionLabel: latest.issueCount > 0 ? '查看本次运行和发现' : null,
    };
    if (latest.issueCount === 0) {
      steps[3] = { ...steps[3]!, status: 'completed', description: '本轮没有形成需要修复的确认问题；仍可继续补足覆盖。' };
      return { projectId: project.projectId, currentStep: 'complete', steps, updatedAt: new Date().toISOString() };
    }
    steps[3] = { ...steps[3]!, route: '/findings', description: '先在“发现”中确认问题性质，再生成修复任务。' };
    return { projectId: project.projectId, currentStep: 'issues', steps, updatedAt: new Date().toISOString() };
  }

  const issuePath = resolve(project.outputDir, 'evaluations', latest.evaluationId, 'issues.jsonl');
  const issues = await pathExists(issuePath) ? await readJsonLinesFile<UxIssue>(issuePath) : [];
  const visibleIssues = issues.filter((issue) => issue.severity === 'P0' || issue.severity === 'P1');
  const issueRoute = `/issues?evaluationId=${encodeURIComponent(latest.evaluationId)}#evaluation-summary`;
  steps[2] = { ...steps[2]!, route: issueRoute };
  if (!visibleIssues.length) {
    steps[2] = { ...steps[2]!, status: 'completed', actionLabel: null };
    steps[3] = { ...steps[3]!, status: 'completed', description: '本轮没有必须交给 AI 的严重问题。' };
    return { projectId: project.projectId, currentStep: 'complete', steps, updatedAt: new Date().toISOString() };
  }

  const tasks = await listFixTasks(cwd, project.projectId);
  const related = tasks.find((task) => visibleIssues.some((issue) => issue.issueId === task.issueId));
  if (!related) {
    steps[2] = { ...steps[2]!, status: 'current', actionLabel: '查看最严重问题' };
    return { projectId: project.projectId, currentStep: 'issues', steps, updatedAt: new Date().toISOString() };
  }

  steps[2] = { ...steps[2]!, status: 'completed', actionLabel: null };
  steps[3] = { ...steps[3]!, status: related.status === 'failed' || related.status === 'blocked' ? 'attention' : 'current', actionLabel: related.status === 'ready_to_apply' ? '查看验证结果' : '继续修复', route: `/fixes?fixTaskId=${encodeURIComponent(related.fixTaskId)}#fix-next-action` };
  return { projectId: project.projectId, currentStep: 'fix', steps, updatedAt: new Date().toISOString() };
}
