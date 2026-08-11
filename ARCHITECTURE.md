# EvalPilot Local 架构

```text
CLI
 ├─ Config：配置解析、目录与 URL 校验
 ├─ Scanner：代码、文档、路由、API、测试、Git 事实
 ├─ Browser：Chromium 探索、页面/网络证据、异常注入
 ├─ Generation：背景、蓝图、Persona、场景
 ├─ Evaluation：硬断言、Rubric 清单、覆盖、严重度
 ├─ Runner：单案例、批量、回归执行
 └─ Report：问题、覆盖和上线建议
```

所有模块通过 `types.ts` 与 Zod Schema 共享文件数据契约。背景文件使用 `fieldStatuses` 和 `fieldEvidence` 为顶层业务字段保留事实等级与来源；能力项继续保存自己的状态和证据。CLI 只编排模块，不承载业务实现。目标项目文件只读；新安装默认输出到用户目录 `~/.evalpilot-local`，旧工作目录 `.evalpilot` 仅兼容读取或显式迁移。

Dashboard 静态资源从 npm 安装包本身定位，不依赖启动目录。CLI、Dashboard `/api/health` 和 npm manifest 共用同一包版本；`RuntimeReadiness` 为 Node、Chromium、Git、数据目录和 Agent 能力的单一事实源。

Adaptive Coverage 按 `capabilityId + dimension + value` 建立功能级单元，并分开计算评测资产、实际运行和已验证覆盖。只有 stable Case 的最新 PASS 结果与有效 Evidence Packet 同时存在时，单元才进入 Verified Coverage；旧覆盖文件仍可读取，但不会被补推为已验证。

Adaptive AI 运行按动作保存独立 before/after Observation 与截图，并使用 `StepEvidence` 连接 Decision、Verification 和动作状态。Playwright Trace 仅保存到本机且关闭源码采集；Evidence Completeness Gate 会重新核对初始/最终观察、截图、验证和 Trace，任一缺失都只能产生 Evaluator Inconclusive。旧 Evidence Packet 通过内存兼容视图保持可读，但不会被改写或补推为可信结论。

One Evaluation Path Phase 2 在 Action 与 Verification 之间增加 Task State Monitor。信号采集层读取可见加载标记、状态文字、进度数值、DOM 增量、预期结果、完成标记、核心请求和页面未捕获错误；判定层输出 `ready | interacting | pending | progressing | completed | failed | blocked | stalled`。每步状态写入 `StepEvidence.taskState` 与独立 JSONL。`pending/progressing` 会把本步验证门禁为 Inconclusive，避免把尚未结束的任务误报为产品失败。

Phase 3 由 Operation Classifier 在导航、表单提交、AI 生成、文件处理、未知异步和同步操作之间选择 Wait Policy。Progress-aware Wait 以 1 秒生产轮询观察轻量 Task State；新进度可以延长软截止时间，但扩展次数和硬截止时间始终固定。轮询历史保存在同一 `StepEvidence.taskWait`，不会制造额外用户动作。Persona 失败尝试只由明确 `failed`，或 `stalled + not_confirmed` 增加；等待和推进中的状态不消耗耐心或重试额度。

Phase 4 在 Hybrid Judge 与 Finding Triage 之间增加 Evaluator Failure Classifier。分类器只使用当前 Agent Run、Evidence Packet 和 Judge Result，将无法选出下一步、不支持的控件、模型输出损坏、上下文不足、状态歧义、无结论的等待耗尽、证据缺失、导航不匹配和工具错误保存为独立 `evaluator-badcases/v1/` 记录。对应结果统一降级为 `inconclusive/evaluator`，用小白可理解的说明代替内部错误文案；Evaluator Badcase 不进入 Product Badcase、Product Regression 或 Verified Coverage。已有低置信度产品失败线索仍由 Candidate Finding 管理，不会仅因等待到期而被吞掉。

Phase 5 在确定性步骤验证之后增加 Semantic Verifier，并用失败关闭规则合并：执行硬失败优先，确定性与高置信度语义冲突时为 Inconclusive，低置信度语义不能独立确认，未授权截图时不能确认纯视觉结果。动作后的固定延时已替换为目标文字、路由/DOM、加载标记和网络空闲的有界等待。Reflector 使用 Persona 的显式耐心、重试、隐私和退出策略；可选语义建议不能覆盖安全门禁、确认后的 finish 或固定最大步数。

Phase 6 Product Understanding 使用 Background、Blueprint 和有界的路由/可见页面/文档证据目录生成任务级 Product Model。输出中的证据引用、路由、任务—能力关系、规则关系和成功信号会再次本地校验；无效引用被过滤并触发人工审核。Oracle Builder 只把任务明确关联的成功信号转换为受支持的确定性断言，推断规则不会进入自动产品失败路径。Dashboard 默认继续本地确定性生成，只有用户勾选并配置 Provider 后才启用远程理解。

Phase 7 Real Evaluator Benchmark 将 10 个独立本地 Web 应用与单独保存的 Ground Truth 配对。运行器先生成案例并执行生产链路 AI Test Agent → Evidence Gate → Hybrid Judge → Finding Triage，预测完成后才读取 Ground Truth 计算指标，避免把标准答案泄露给 Actor 或 Judge。每个应用使用新的浏览器上下文重复 3 次；首轮固定为确定性 Mock Actor，以隔离 Judge 与分级链路的准确率。安全门禁阻止的危险任务记为 Evaluator Inconclusive，不能生成 Product Badcase。

普通 Dashboard 的 `/evaluate` 现由 Evaluation Orchestrator 统一编排：复用扫描、Background 与 Blueprint，按需建立或读取 Product Model/Eval Set，依据 Quick/Core/Full 和所选功能选择案例，再顺序执行 AI Test Agent → Hybrid Judge → Finding Triage。每个 Evaluation Session 保存 selected Case、真实 run、Finding、Badcase、Coverage Matrix 与评测报告快照；没有配置 Provider 或没有逐次远程模型授权时，在创建 Session 前返回可恢复错误，不调用 Legacy Explorer。Legacy runtime 仅保留给旧记录、CLI 兼容和内部诊断。

Finding Triage 位于 Hybrid Judge 与 Badcase 之间。单次 Semantic Fail 默认只保存到 `findings/<findingId>.json`，运行结果保持 Inconclusive；旧 `findings/v1/` 只读兼容。只有确定性硬失败、双类型强证据、stable Case 的重复同类失败或人工明确确认，才能转为 `confirmed_product_failure`。Badcase Store 会重新读取已持久化 Finding 校验谱系，原始模型输出不能直接写入回归资产。

Eval Set、Product Badcase 和 Evaluator Badcase Store 在完成 Schema 校验与 JSON 原子写入后，会分别重建 `EVAL_SET.md`、`BADCASES.md` 和 `EVALUATOR_BADCASES.md`。这些 Markdown 只提供人类可读视图，不是第二事实源；Product 与 Evaluator 谱系保持物理和语义隔离。运行时文档属于本地项目数据，不进入公开源码或 npm 包。

One Evaluation Path Phase 5 将问题列表与修复服务统一到同一来源身份。Legacy 问题必须通过 `evaluationId + issueId` 从该次评测快照解析；Adaptive 路径使用已确认 Finding 或 Badcase。创建任务时完整来源会原子保存到任务目录的 `source-snapshot.json`，之后任务包、Agent 分支和复测都只使用这份快照。全局最新报告仅保留旧界面兼容，不能再改变已经创建的修复目标；缺少快照的旧任务会停止并要求从原评测重新创建。

One Evaluation Path Phase 6 增加纯函数 Next Action Engine。它只接收指定 Evaluation Session 的 Case、Result、Evidence Packet、Finding、Badcase 和 FixTask 谱系，并按照“运行中 → 已确认失败的修复生命周期 → 人工判断 → 评测器重跑 → 未运行案例 → 无动作”的固定优先级返回 exactly one `EvaluationNextAction`。报告快照保存当时的推荐，`GET /api/evaluations/:id/next-action` 则按指定评测实时重算；零个 confirmed Product Failure 时，决策引擎不会推荐创建修复、复测修复或加入回归。

设计取舍：Legacy 生成器继续使用证据驱动的确定性规则。Experimental Adaptive Evaluation 可在逐次授权后调用 Product Understanding 与 Oracle Builder，但模型输出必须经过本地 Schema、证据白名单和人工审核门禁；开放式 Rubric 仍不能替代独立证据或人工判断。Phase 7 的内部阈值只约束受控基准，真实模型、外部项目与独立审查未通过前不升级对外可靠性承诺。
