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
| 文档持久化、Failure taxonomy、可见元素与报告谱系专项测试 | 12 项通过 |
| `npm test` | 200 项通过，28 项按既有条件跳过 |
| `npm run test:real-benchmark` | 10 个真实 Chromium 夹具各运行 3 次；Recall / Precision / Failure Source Accuracy / Consistency = 1.00，FPR = 0 |
| `npm run test:public-example` | 全新 tarball 安装后项目 ready，1 个计划功能已执行，评测 completed，对应报告 ready |
| `npm run build` | 通过 |
| `npm run audit:package` | 173 个文件，压缩后 271,512 bytes，敏感命中 0 |
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

## 本轮实时收集的 Evaluator Badcases

| Badcase | 直接证据 | 修复与回归标准 |
|---|---|---|
| `hidden-element-index-mismatch` | Observer 只为可见的 `Reload view` 生成 `E001`，Executor 却从全部 DOM 元素取第 1 个，实际命中隐藏的 `Save profile` 并超时 | Observer 与 Executor 使用同一可见元素集合；隐藏元素在前时仍能点击 `E001` 对应的可见按钮 |
| `no-next-action-overrides-hard-failure` | `unclear-next-step` 的 Oracle 已确定性确认缺少 `Continue`，但 `no_next_action` 把完整 Product hard failure 改成 Evaluator Inconclusive | Evidence Packet 完整且确定性 hard failure 时保留 Product Failure；只有证据不足时才归为 Evaluator Failure |
| `public-example-stale-evaluation-contract` | 修复前的 GitHub run `31481657580` 已通过准确率、Browser、Runner 和 Dashboard，却在公开示例用旧请求创建评测时返回 `EVALUATION_INVALID` | 公开 tarball 验收显式携带本次 AI 授权，并在 test + loopback 限制下使用 Mock Responses API；禁止读取真实 Key，仍完成真实 Chromium 与报告闭环 |
| `adaptive-report-missing-evaluation-lineage` | 公开 tarball 本机复跑已完成评测，但对应 `report.json` 顶层没有 `evaluationId`，无法直接核对报告属于刚创建的评测 | 新报告顶层保存真实 `evaluationId`，测试断言与 Session 一致；旧报告字段保持可选以兼容读取，不原地补写 |
| `public-example-stale-dist` | 单独执行 `test:public-example` 时，`npm pack --ignore-scripts` 会复用旧 `dist`，造成源码已修复但 tarball 仍失败的假象 | 公开示例测试先执行生产构建，再打包并从仓库外安装；独立运行和 CI 使用同一顺序 |
| `public-example-legacy-coverage-shape` | 公开示例仍读取旧 `report.coverage.executedCount`，而 Adaptive 报告已使用功能 × 维度的 Coverage Matrix，导致完成评测后误报覆盖缺失 | 分别从报告格子与 Session 提取“实际运行的唯一功能 ID”并精确比较，禁止把多维格子数当成功能数 |

这两条来自失败的 GitHub run `31480487263`，并在本机同一基准复现；它们是 EvalPilot 自身 Badcase，不是任何被测产品的 Bug。本机修复后 30 次真实浏览器基准已恢复全部准确率门禁，最终远端运行结果在推送后补充。
