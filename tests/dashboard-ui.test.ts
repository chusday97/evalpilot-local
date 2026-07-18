import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dashboard UI contract', () => {
  it('contains the guided home, four-step product loop, and mandatory feedback surfaces', async () => {
    const source = [
      await readFile(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8'),
      await readFile(new URL('../dashboard/src/GuidedPages.tsx', import.meta.url), 'utf8'),
      await readFile(new URL('../dashboard/src/IssueDetail.tsx', import.meta.url), 'utf8'),
    ].join('\n');
    for (const label of ['使用说明', '跟着当前任务往下做', '上一次评测', '添加与切换', '选择并运行', '结论与证据', 'Agent 与复测', '快速检查', '核心评测', '完整评测']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('Skeleton');
    expect(source).toContain('EmptyState');
    expect(source).toContain('ErrorPanel');
    expect(source).toContain('不代表真实用户满意度');
    expect(source).toContain('选择 AI 修复');
    expect(source).toContain('应用这次已验证修复');
    expect(source).toContain('卡片名称、时间和结果会一起切换');
    expect(source).toContain('项目没有业务 API 时，相关异常检查会标为“不适用”并继续');
    expect(source).toContain('问题发生在这里');
    expect(source).toContain('尚未定位到具体代码文件');
    for (const label of ['可以直接帮你修改', '会打开工具继续', '现在不能用']) expect(source).toContain(label);
  });
});
