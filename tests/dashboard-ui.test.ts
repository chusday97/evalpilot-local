import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dashboard UI contract', () => {
  it('contains the project-first product loop, explicit evaluation modes, and mandatory feedback surfaces', async () => {
    const source = [
      await readFile(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8'),
      await readFile(new URL('../dashboard/src/GuidedPages.tsx', import.meta.url), 'utf8'),
      await readFile(new URL('../dashboard/src/CaseEvaluationModePage.tsx', import.meta.url), 'utf8'),
      await readFile(new URL('../dashboard/src/IssueDetail.tsx', import.meta.url), 'utf8'),
    ].join('\n');
    for (const label of ['使用说明', '跟着当前任务往下做', '上一次评测', '添加与切换', '先选你想验证什么', '运行', '发现', 'Agent 与复测', '回归', '快速检查', '核心评测', '完整评测']) {
      expect(source).toContain(label);
    }
    for (const label of ['选择评测方式', '你想知道这个项目的什么？', '检查核心流程', '验证一个具体任务', '模拟新用户体验', '开始核心流程评测', '运行功能验证', '检查并开始 Blind Experience']) {
      expect(source).toContain(label);
    }
    expect(source).toContain("evaluationMode === 'functional' || evaluationMode === 'blind'");
    expect(source).toContain("window.location.assign('/evaluate')");
    expect(source).toContain("window.location.assign('/evaluate?mode=core')");
    expect(source).toContain('Blind Actor 不会看到 Oracle');
    expect(source).toContain('前置状态尚未验证，目标 Actor 不会启动');
    expect(source).toContain('Skeleton');
    expect(source).toContain('EmptyState');
    expect(source).toContain('ErrorPanel');
    expect(source).toContain('不代表真实用户满意度');
    expect(source).toContain('生成 Codex 修复任务');
    expect(source).toContain('EvalPilot 当前不会自动修改你的代码');
    expect(source).toContain('准备 Codex 交接');
    expect(source).toContain('复测修复结果');
    expect(source).toContain("codex?.capabilities?.directFix === true");
    expect(source).toContain('应用这次已验证修复');
    expect(source).toContain('卡片名称、时间和结果会一起切换');
    expect(source).toContain('EvalPilot 不会偷偷退回旧评测，也不会生成假的完成结果');
    expect(source).toContain('type="password"');
    expect(source).toContain('正在检查连接…');
    expect(source).toContain("'/ai-provider/connect'");
    expect(source).not.toContain('localStorage.setItem');
    expect(source).toContain('我同意本次使用已配置 AI 模型');
    expect(source).toContain('帮我找到最近项目');
    expect(source).toContain('打开 Mac 文件夹选择器');
    expect(source).toContain('已选择项目');
    expect(source).toContain('系统现在在做什么');
    expect(source).toContain('留在这里');
    expect(source).toContain('现在查看结果');
    expect(source).toContain('如何读懂结果');
    for (const label of ['功能覆盖证据', '发现功能', '本轮计划', '浏览器到达', '实际运行', '运行通过', '未运行']) expect(source).toContain(label);
    expect(source).toContain('“发现”不等于“测过”');
    expect(source).toContain('没有严重问题不等于已经测完');
    expect(source).toContain('技术过程与原始日志');
    expect(source).toContain('问题发生在这里');
    expect(source).toContain('尚未定位到具体代码文件');
    for (const label of ['可以读取近期项目路径', '不读取会话文件，请使用 Mac 文件夹选择器']) expect(source).toContain(label);
  });

  it('makes AI task understanding an explicit, privacy-described, recoverable choice', async () => {
    const source = await readFile(new URL('../dashboard/src/AdaptivePages.tsx', import.meta.url), 'utf8');
    expect(source).toContain('让 AI 深入理解用户任务（可选）');
    expect(source).toContain('不发送源码、截图、Trace、密钥或完整页面正文');
    expect(source).toContain('allowRemoteModel: useAiUnderstanding');
    expect(source).toContain('disabled={generating}');
    expect(source).toContain('AI 理解未完成，已安全使用本地规则生成评测集');
  });
});
