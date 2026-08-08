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

Phase 5 在确定性步骤验证之后增加 Semantic Verifier，并用失败关闭规则合并：执行硬失败优先，确定性与高置信度语义冲突时为 Inconclusive，低置信度语义不能独立确认，未授权截图时不能确认纯视觉结果。动作后的固定延时已替换为目标文字、路由/DOM、加载标记和网络空闲的有界等待。Reflector 使用 Persona 的显式耐心、重试、隐私和退出策略；可选语义建议不能覆盖安全门禁、确认后的 finish 或固定最大步数。

Finding Triage 位于 Hybrid Judge 与 Badcase 之间。单次 Semantic Fail 默认只保存到 `findings/v1/`，运行结果保持 Inconclusive；只有确定性硬失败、双类型强证据、stable Case 的重复同类失败或人工明确确认，才能转为 `confirmed_product_failure`。Badcase Store 会重新读取已持久化 Finding 校验谱系，原始模型输出不能直接写入回归资产。

设计取舍：生成器在 MVP 使用证据驱动的确定性规则和模板，不接入模型供应商。这样能完成可测试闭环，并避免同一模型生成、执行和自评。开放式 Rubric 交给人工审核。
