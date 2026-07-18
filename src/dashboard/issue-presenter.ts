import type { IssueEvidenceItem, UxIssue } from '../../types.js';

function evidenceType(path: string): IssueEvidenceItem['type'] {
  if (/\.(png|jpe?g|webp)$/i.test(path)) return 'screenshot';
  if (/trace\.zip$/i.test(path)) return 'trace';
  if (/console/i.test(path)) return 'console';
  if (/network/i.test(path)) return 'network';
  if (/interaction/i.test(path)) return 'interaction';
  return 'file';
}

function evidenceTitle(type: IssueEvidenceItem['type']): string {
  return ({ screenshot: '页面截图', trace: '完整操作轨迹', console: '控制台记录', network: '网络记录', interaction: '分步操作记录', file: '辅助证据' })[type];
}

export function evidenceItemsFromPaths(paths: string[], stepIndex: number | null, legacy = false): IssueEvidenceItem[] {
  return paths.map((sourcePath, index) => {
    const type = evidenceType(sourcePath);
    return {
      evidenceId: `evidence-${index + 1}`,
      type,
      title: evidenceTitle(type),
      observation: legacy
        ? '旧记录只保存了此证据文件，未记录它对应的具体操作步骤。'
        : type === 'screenshot'
          ? '截图记录了用户执行到该步骤时实际看到的页面。'
          : type === 'trace'
            ? '轨迹可回放本次浏览器操作、页面变化和失败位置。'
            : '该记录用于核对页面在此步骤发生的真实变化。',
      sourcePath,
      relatedStepIndex: stepIndex,
    };
  });
}

export function presentIssue(issue: UxIssue): UxIssue {
  const structured = Boolean(issue.location || issue.evidenceItems?.length || issue.resolutionSteps?.length);
  return {
    ...issue,
    location: issue.location ?? null,
    evidenceItems: issue.evidenceItems?.length ? issue.evidenceItems : evidenceItemsFromPaths(issue.evidence ?? [], null, true),
    causeHypothesis: issue.causeHypothesis ?? null,
    resolutionSteps: issue.resolutionSteps?.length ? issue.resolutionSteps : [issue.recommendation],
    verificationSteps: issue.verificationSteps?.length ? issue.verificationSteps : ['复跑同一个用户任务，确认原卡点消失。', '确认用户目标、下一步和安全确认没有退化。'],
    needsHumanReview: issue.needsHumanReview || !structured,
  };
}
