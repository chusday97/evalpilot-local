# Badcase 与 Eval Set 文档化验收

日期：2026-08-11

## 范围

- Eval Case 保存后自动重建 `eval-sets/EVAL_SET.md`。
- 已确认 Product Badcase 保存后自动重建 `badcases/BADCASES.md`。
- Evaluator Badcase 保存后自动重建 `evaluator-badcases/EVALUATOR_BADCASES.md`。
- Candidate Finding 与 Evaluator Failure 不污染 Product Badcase 和 Product Regression。
- 运行时文档与证据继续留在本地数据目录，不进入公开源码或 npm 包。

## 自动验证

| 门禁 | 结果 |
|---|---|
| `npm run check` | 通过 |
| 文档持久化与 Failure taxonomy 专项测试 | 9 项通过 |
| `npm test` | 199 项通过，27 项按既有条件跳过 |
| `npm run build` | 通过 |
| `npm run audit:package` | 173 个文件，压缩后 270,942 bytes，敏感命中 0 |
| `git diff --check` | 通过 |

本次没有修改 Dashboard UI、API 或浏览器运行路径，因此没有新增浏览器交互验收。文档生成器会把动态文本中的 HTML 边界符转义，避免本地项目文案被当作 Markdown HTML。

## 人工可复核点

1. 在任一测试输出目录打开三份 Markdown，确认内容来自对应 JSON，而不是手工副本。
2. Product 文档只允许出现已确认 Badcase；评测器错误只能出现在 Evaluator 文档。
3. 检查 npm tarball 清单和 Git diff，确认没有 `.evalpilot`、截图、Trace 或真实目标项目信息。

## 已知边界

- Markdown 是派生视图，没有独立编辑入口；需要修改内容时应修改事实源并重新保存。
- 现有存储调用按评测流程顺序执行；本轮没有新增跨进程文件锁。
- 本轮未能启动独立 Critic/Evaluator 线程，验收证据来自 Builder 的自动化门禁；该审查缺口必须在交付中披露。
