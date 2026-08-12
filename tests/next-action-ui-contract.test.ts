import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('result page next action contract', () => {
  it('uses the authoritative evaluation next-action endpoint before coverage details', async () => {
    const source = await readFile(new URL('../dashboard/src/GuidedPages.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import { presentNextAction } from './next-action-presenter.js'");
    expect(source).toContain('useApi<EvaluationNextAction>');
    expect(source).toContain('/next-action?projectId=');
    expect(source).toContain('id="evaluation-next-action"');
    expect(source.indexOf('<NextActionPanel action={nextAction.data} go={go}/>')).toBeLessThan(source.indexOf('<CoveragePanel coverage={selectedRecord?.coverage}/>'));
  });

  it('keeps the first /runs result screen on the same authoritative next action', async () => {
    const source = await readFile(new URL('../dashboard/src/AdaptivePages.tsx', import.meta.url), 'utf8');
    expect(source).toContain('/next-action?projectId=');
    expect(source).toContain('04 / 你现在应该做什么');
    expect(source).toContain('nextAction.data?.title');
    expect(source).toContain('nextAction.data?.explanation');
  });

  it('does not let generic coverage or empty-state copy override the decision engine', async () => {
    const source = await readFile(new URL('../dashboard/src/GuidedPages.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('还有未运行、失败或阻塞的功能，本次不能给出整体通过结论。');
    expect(source).not.toContain('继续评测功能');
    expect(source).toContain('具体阻塞原因和下一步以上方决策卡为准');
    expect(source).toContain('如果还有前置条件、评测器失败或未运行任务，请按上方唯一下一步处理');
  });

  it('keeps legacy issue evidence out of the fix execution path', async () => {
    const presenter = await readFile(new URL('../dashboard/src/next-action-presenter.ts', import.meta.url), 'utf8');
    const issuesPage = await readFile(new URL('../dashboard/src/GuidedPages.tsx', import.meta.url), 'utf8');
    const issueDetail = await readFile(new URL('../dashboard/src/IssueDetail.tsx', import.meta.url), 'utf8');
    const engine = await readFile(new URL('../src/decision/next-action-engine.ts', import.meta.url), 'utf8');

    expect(presenter).toContain("['create_fix_task', 'retest_fix', 'add_to_regression']");
    expect(presenter).toContain('当前不要生成代码修复任务');
    expect(presenter).toContain('确认之前不要创建代码修复任务');

    expect(issuesPage).not.toContain('issueId: fix.issueId');
    expect(issuesPage).not.toContain('setFix(');
    expect(issuesPage).not.toContain('生成 Codex 修复任务');
    expect(issueDetail).not.toContain('生成 Codex 修复任务');
    expect(issueDetail).toContain('只有已确认 Product Failure 才会通过上方 Next Action 进入修复');

    expect(engine).toContain("type: 'create_fix_task'");
    expect(engine).toContain("route: detailRoute('/findings'");
  });

  it('reads blocked prerequisite summaries from the redacted preflight snapshot', async () => {
    const engine = await readFile(new URL('../src/decision/next-action-engine.ts', import.meta.url), 'utf8');
    expect(engine).toContain("'scenario-preflight.json'");
    expect(engine).toContain('prerequisiteBlockersFromPreflight');
    expect(engine).toContain("plan.status !== 'blocked'");
    expect(engine).toContain('prerequisiteBlockers');
  });
});
