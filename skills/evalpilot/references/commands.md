# EvalPilot CLI 命令参考

| 任务 | 命令 | 主要输出 |
|---|---|---|
| 初始化 | `scripts/evalpilot.sh init --project <path> --url <url>` | `.evalpilot/config.yaml` 与目录结构 |
| 状态 | `scripts/evalpilot.sh status` | 各阶段是否就绪 |
| 扫描 | `scripts/evalpilot.sh scan` | `.evalpilot/evidence/` 与截图 |
| 背景 | `scripts/evalpilot.sh generate-background` | `project-background.yaml`、`PRODUCT_BACKGROUND.md` |
| 蓝图 | `scripts/evalpilot.sh generate-blueprint` | `eval-blueprint.yaml`、`EVAL_BLUEPRINT.md` |
| Persona/案例/旅程 | `scripts/evalpilot.sh generate-cases` | 8 Persona、固定/探索案例、`journeys/*.yaml`、taxonomy/rubric/gates/coverage |
| 全部自动案例 | `scripts/evalpilot.sh run` | `.evalpilot/runs/<timestamp>/` |
| 单案例 | `scripts/evalpilot.sh run --case <case-id>` | 单案例结果、截图、Trace |
| 探索型模拟用户 | `scripts/evalpilot.sh run --exploratory [--case <case-id>]` | 动作、截图、Trace、UX 指标、旅程对比、摩擦与 `LATEST_UX_REPORT.md` |
| 本地 Dashboard | `scripts/evalpilot.sh dashboard [--port <port>]` | `127.0.0.1` 四步 UI、API/SSE、评测进度和报告 |
| 报告 | `scripts/evalpilot.sh report` | `reports/LATEST_REPORT.md`、`issues.jsonl` |
| 确认失败入回归 | `scripts/evalpilot.sh report --confirm-failures` | `regression/regression-cases.jsonl` |
| 回归 | `scripts/evalpilot.sh run --regression` | 回归运行与最近结果 |
| UX 修复对比 | Dashboard 确认问题后复跑同功能探索案例 | `comparisons/*.json` 与 Report 中 before/after 结论 |

`blocked` 表示评测前置条件或故障请求未命中，不等于产品已失败。只有 `failed` 且用户明确确认后才进入回归。

探索运行绝不接收标准步骤或 selector。UX 对比同时检查目标完成、完整闭环、安全步骤和新问题；动作减少本身不等于改善。Dashboard 只允许本机访问。
