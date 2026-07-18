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

设计取舍：生成器在 MVP 使用证据驱动的确定性规则和模板，不接入模型供应商。这样能完成可测试闭环，并避免同一模型生成、执行和自评。开放式 Rubric 交给人工审核。
