# EvalPilot Local 数据契约

版本：0.5.0；来源：用户提供的 EvalPilot Local MVP/v0.2 规格、v0.3 四步工作台方案、v0.4.1 小白引导方案，以及 2026-07-18 对 GitHub Public Alpha、npm CLI、MIT 许可和真实能力收口方案的确认。后续字段变化必须先更新本文件和 `types.ts`。

## 1. 项目描述与边界

EvalPilot Local 读取本地 Web 项目及其测试网址，将可追溯证据、评测定义、真实 Chromium 执行结果、模拟用户轨迹和 UX 判断保存为本地 YAML/JSON/JSONL/Markdown。Public Alpha 默认把产品数据保存在 `~/.evalpilot-local`，不在目标项目内写评测产物；显式 `--data-dir` / `EVALPILOT_DATA_DIR` 可覆盖。产品不使用数据库；Dashboard API 仅监听 loopback，不提供远程业务 API。

## 2. 核心实体

| 实体 | 必填核心字段 | 说明 |
|---|---|---|
| `EvalPilotConfig` | `version, projectRoot, targetUrl, outputDir, browser, createdAt` | `.evalpilot/config.yaml` |
| `EvidenceClaim` | `claim, sourceType, source, status` | 带来源和事实等级的证据 |
| `RepositoryEvidence` | `projectRoot, files, packageJson, envVariableNames, claims, scannedAt` | 仓库扫描事实 |
| `RouteEvidence` | `routes, sourceFiles, scannedAt` | 静态路由事实 |
| `ApiEvidence` | `apis, sourceFiles, claims, scannedAt` | 由源码中明确 URL/路由声明提取的 API 事实 |
| `TestEvidence` | `files, scripts, frameworks, claims, scannedAt` | 测试文件、package scripts 与测试框架事实 |
| `DocumentEvidence` | `documents, claims, scannedAt` | README/产品文档事实 |
| `GitEvidence` | `available, branch, commits, changedFiles, scannedAt` | Git 事实 |
| `PageEvidence` | `url, title, visibleText, links, buttons, inputs, forms, dialogs, accessibility, screenshot, consoleErrors, networkErrors, exploredAt` | 浏览器真实证据 |
| `Capability` | `id, name, description, status, routes, evidence, dependencies, risks` | 背景中的核心能力 |
| `ProjectBackground` | 产品、用户、任务、页面、路径、职责、依赖、风险、假设、未知项、`fieldStatuses`、`fieldEvidence` | 每个背景字段均有事实等级和来源 |
| `BlueprintCapability` | `id, name, importance, userGoals, entryPoints, successConditions, hardConstraints, failureConditions, dependencies, requiredPersonas, requiredInputQualities, requiredSystemStates, graders` | 评测蓝图能力 |
| `EvalBlueprint` | 范围、能力、场景维度、评分、覆盖、门槛、审批状态 | 蓝图 YAML/Markdown |
| `Persona` | 用户给定的行为字段，能力关联使用 `supportedCapabilities` | Persona JSONL |
| `Scenario` | 用户给定的 20 个案例字段 | 静态/自动/回归案例 |
| `RunResult` | 案例、步骤、最终 URL、证据、耗时、预期/实际、状态 | 浏览器执行结果 |
| `Issue` | ID、严重度、模块、Persona、案例、复现、预期/实际、影响、截图、Trace、控制台/网络错误、原因、位置、回归状态 | 问题 JSONL/报告 |
| `RegressionCase` | 原始 Issue、复现、修复版本/文件、预期、断言、最近结果 | 回归集 |
| `CompletionDefinition` | `technical, interface, userGoal, followUp` | 技术、界面、用户目标、后续行动四层完成定义 |
| `JourneyStepDefinition` | `stepId, label, type, evidence, approvalStatus` | 必要、安全、解释、可合并、可自动化、冗余步骤 |
| `FeatureJourneyGraph` | 功能、目标、入口、主/备选/恢复路径、终态、步骤、完成定义 | `.evalpilot/journeys/*.yaml` |
| `ExploratoryScenario` | 目标、Persona、起始页、已知信息、允许/禁止动作、成功/失败/放弃条件 | 与固定 `Scenario` 隔离，禁止包含标准路径和选择器 |
| `InteractionAction` | 动作、相对时间、页面、目标、输入摘要、结果、证据 | `.evalpilot/runs/*/interactions.jsonl` |
| `SimulatedUserMetrics` | 时间、动作、回退、重试、重复输入、错误、恢复、完成与放弃指标 | `.evalpilot/runs/*/ux-metrics.json` |
| `JourneyComparison` | 理想/实际/最短合理路径指标及闭环结果 | `.evalpilot/runs/*/journey-comparison.json` |
| `FrictionEvent` | 摩擦类型、页面、步骤、Persona、行为、推测原因、证据、严重度、置信度 | `.evalpilot/runs/*/frictions.jsonl` |
| `JourneyBreakpoint` | 旅程阶段、实际/预期、用户影响、证据、严重度、置信度 | `.evalpilot/runs/*/breakpoints.jsonl` |
| `UxEvaluationResult` | 四层完成状态、功能状态、12 项 UX 分、判定、真实性声明 | `.evalpilot/runs/*/ux-evaluation.json` |
| `UxIssue` | 用户目标、三类路径、失败/放弃点、行为指标、结构化位置/证据、事实边界、解决和复测步骤 | `.evalpilot/reports/ux-issues.jsonl` |
| `BeforeAfterComparison` | 前后两次运行的闭环、路径指标、安全约束和新问题 | `.evalpilot/comparisons/*.json` |
| `AgentConnection` | Agent 安装、登录、执行模式、版本和阻塞原因 | 实时检测，不保存凭证 |
| `WorkspaceCandidate` | 近期工作区路径、来源 Agent、技术栈、时间和置信度 | 仅授权后读取路径元数据 |
| `EvaluationDepthOption` | 三级评测的真实覆盖、适用场景、案例数和时间估计 | Dashboard 深度卡片 |
| `EvaluationRecordSummary` | 语义化名称、功能、深度、结论、问题和耗时 | 历史评测卡片视图 |
| `GuidedFlowState` | 四步状态、唯一当前任务、真实动作、目标路由与定位锚点 | 首页与各页共享引导 |
| `DashboardHealth` | 契约版本和当前服务支持能力 | 前端启动与版本兼容检查 |
| `RuntimeReadiness` | 包版本、数据目录、Node/Chromium/Git/Agent 检查、阻塞与恢复动作 | CLI doctor 与 Dashboard 健康检查共享 |
| `CompetitorCandidate` | GitHub、Apple App Store 或公开链接的规划中搜索结果 | v0.5 不属于已支持能力，不计入评分 |
| `CompetitorSnapshot` | 规划中的用户确认竞品事实、观察和真实性边界 | v0.5 不提供公开 API |

完整字段、联合类型和可选性以同版本 `types.ts` 为机器可读权威定义；Zod Schema 必须与其一致。

## 3. 数据库表结构

不适用。v0.5 继续禁止数据库，新安装的数据默认写入 `~/.evalpilot-local`，旧项目内 `.evalpilot/` 只用于兼容读取或显式迁移。因此没有建表 SQL、索引、外键或数据库迁移。文件写入必须先通过 Schema，再进行原子替换。

## 4. 远程 API 接口

CLI 公共接口继续保留：

| 命令 | 输入 | 输出 | 主要错误 |
|---|---|---|---|
| `init` | `--project`, `--url` | 配置和目录结构 | 路径不存在、URL 非 HTTP(S)、已初始化 |
| `status` | 工作目录 | 状态摘要 | 未初始化、配置损坏 |
| `scan` | 配置 | evidence 文件 | 目标不可访问、扫描失败 |
| `generate-background` | evidence | 背景 YAML/Markdown | 证据缺失/非法 |
| `generate-blueprint` | background | 蓝图 YAML/Markdown | 背景缺失/非法 |
| `generate-cases` | blueprint | Persona/案例/覆盖 | 蓝图缺失/非法 |
| `run` | 可选 `--case`/`--regression` | run 证据 | 浏览器/案例/目标阻塞 |
| `report` | runs/scenarios | 报告/覆盖/issues | 运行结果缺失/非法 |
| `dashboard` | 可选 `--port`，默认 `4173` | 启动本地 Dashboard 与 API | 端口占用、未初始化、服务启动失败 |
| `doctor` | 可选 `--json` / `--data-dir` | `RuntimeReadiness` 或人话检查摘要 | 运行环境阻塞 |
| `setup` | `--install-chromium --confirmed` | 显式安装 Chromium 并复检 | 未确认、下载/安装失败 |
| `migrate` | `--confirmed`，在旧项目目录运行 | 把旧 `.evalpilot` 复制到用户级目录，源目录不变 | 未确认、源不存在、目标已存在 |

CLI 错误写入标准错误并使用非零退出码；异步失败不得静默吞掉。

### 4.1 本地 Dashboard API

- Base URL：`http://127.0.0.1:4173/api`
- 内容类型：`application/json`；Live Run 事件使用 SSE。
- 认证：无远程账号；服务仅绑定 loopback。非 loopback Host 请求必须拒绝。
- 成功响应：`{ "success": true, "data": ... }`。
- 失败响应：`{ "success": false, "error": { "code": string, "message": string, "fields"?: Record<string,string> } }`。

| Method | Path | Request | Response data | Error codes |
|---|---|---|---|---|
| GET | `/api/status` | 无 | 环境、配置、阶段和活动运行状态 | `NOT_INITIALIZED` |
| POST | `/api/connect/check` | `{ projectRoot, targetUrl }` | 路径与目标可用性，不写配置 | `INVALID_PATH`, `INVALID_URL`, `TARGET_UNREACHABLE` |
| POST | `/api/connect` | `{ projectRoot, targetUrl }` | `EvalPilotConfig` | `ALREADY_INITIALIZED`, `WRITE_FAILED` |
| GET/PATCH | `/api/background` | PATCH 为 `Partial<ProjectBackground>` | `ProjectBackground` | `BACKGROUND_INVALID`, `WRITE_FAILED` |
| GET/PATCH | `/api/blueprint` | PATCH 为 `Partial<EvalBlueprint>` | `EvalBlueprint` | `BLUEPRINT_INVALID`, `WRITE_FAILED` |
| GET/PATCH | `/api/personas/:id` | PATCH 为 `Partial<Persona>` | `Persona` | `PERSONA_NOT_FOUND`, `PERSONA_INVALID` |
| GET/POST/PATCH/DELETE | `/api/cases` | 创建/修改使用 `Scenario` 或 `ExploratoryScenario` | 案例或案例列表 | `CASE_INVALID`, `CASE_NOT_FOUND` |
| GET/PATCH | `/api/journeys/:featureId` | PATCH 为 `Partial<FeatureJourneyGraph>` | `FeatureJourneyGraph` | `JOURNEY_NOT_FOUND`, `JOURNEY_INVALID` |
| POST | `/api/runs` | `{ caseId, mode }` | `{ runId, status }` | `RUN_CONFLICT`, `CASE_NOT_FOUND`, `BROWSER_BLOCKED` |
| POST | `/api/runs/:id/pause` | 无 | `{ runId, status: "paused" }` | `RUN_NOT_ACTIVE` |
| POST | `/api/runs/:id/resume` | 无 | `{ runId, status: "running" }` | `RUN_NOT_PAUSED` |
| POST | `/api/runs/:id/stop` | `{ confirmed: true }` | 已保存的部分运行摘要 | `CONFIRMATION_REQUIRED`, `RUN_NOT_ACTIVE` |
| GET | `/api/runs/:id/events` | 无 | SSE `RunEvent` | `RUN_NOT_FOUND` |
| GET | `/api/reports/latest` | 无 | 功能报告与 UX 报告 | `REPORT_NOT_FOUND` |
| POST | `/api/issues/:id/confirm` | `{ confirmed: true }` | `UxIssue` | `CONFIRMATION_REQUIRED`, `ISSUE_NOT_FOUND` |
| GET | `/api/comparisons/:id` | 无 | `BeforeAfterComparison` | `COMPARISON_NOT_FOUND` |

Dashboard 不得直接读写 YAML/JSONL；所有写操作经 Core 校验并原子落盘。每个异步接口必须向页面返回可显示的错误，不得只写日志。

### 4.2 v0.3 多项目与修复 API

| 方法 | 路径 | 请求 | 返回 |
|---|---|---|---|
| GET/POST | `/api/projects` | POST `CreateProjectInput` | `ProjectProfile[] / ProjectProfile` |
| POST | `/api/projects/discover` | `{ projectRoot }` | `ProjectReadiness` |
| POST | `/api/projects/:id/activate` | `{ confirmed: true }` | `ProjectProfile` |
| POST | `/api/projects/:id/start` | `{ confirmed: true, command? }` | `ProjectReadiness` |
| GET | `/api/projects/:id/readiness` | 无 | `ProjectReadiness` |
| POST/GET | `/api/evaluations` | `{ projectId, depth, capabilityIds }` | `EvaluationSession / EvaluationSession[]` |
| POST | `/api/evaluations/:id/retry` | `{ confirmed: true }` | 从失败阶段恢复的 `EvaluationSession` |
| GET | `/api/evaluations/:id/events` | 无 | SSE `EvaluationEvent` |
| GET | `/api/issues` | `projectId/evaluationId` query | `UxIssue[]` |
| POST | `/api/issues/:id/dismiss` | `{ confirmed: true }` | `UxIssue` |
| POST/GET | `/api/fix-tasks` | `{ projectId, issueId, confirmed: true }` | `FixTask / FixTask[]` |
| POST | `/api/fix-tasks/:id/run` | `{ confirmed: true, adapter }` | `AgentRun` |
| GET | `/api/fix-tasks/:id/agent-runs` | 无 | `AgentRun[]` |
| GET | `/api/agent-runs/:id/events` | 无 | SSE `AgentEvent` |
| POST | `/api/fix-tasks/:id/apply` | `{ confirmed: true, agentRunId }` | `FixTask` |

### 4.4 v0.4 智能接入与历史 API

| 方法 | 路径 | 请求 | 返回 |
|---|---|---|---|
| GET | `/api/agents` | 无 | `AgentConnection[]` |
| POST | `/api/agents/:provider/check` | `{ confirmed: true }` | `AgentConnection` |
| POST | `/api/workspace-candidates` | `{ confirmed: true, providers }` | `WorkspaceCandidate[]` |
| GET | `/api/evaluation-depths` | `projectId` query | `EvaluationDepthOption[]` |
| GET | `/api/evaluation-records` | `projectId` query | `EvaluationRecordSummary[]` |
| PATCH | `/api/evaluations/:id` | `{ customName }` | `EvaluationSession` |
| POST | `/api/fix-tasks/:id/run` | `{ confirmed: true, adapter }` | `AgentRun` |
| POST | `/api/fix-tasks/:id/apply` | `{ confirmed: true, agentRunId }` | `FixTask` |

### 4.5 v0.4.1 小白引导、健康检查与证据定位 API

| 方法 | 路径 | 请求 | 返回 |
|---|---|---|---|
| GET | `/api/health` | 无 | `DashboardHealth` |
| GET | `/api/guidance` | 可选 `projectId` query | `GuidedFlowState` |
| GET | `/api/issues` | `projectId/evaluationId` query | 含兼容转换后的结构化 `UxIssue[]` |

- `RunStatus` 为 `passed | failed | blocked | not_applicable`；`not_applicable` 只用于目标能力客观不存在的案例，不生成问题、不加入回归、不降低评分。
- API 异常案例仅在静态 API 证据和页面网络证据均为空时自动标记 `not_applicable`；已声明 API 但请求未出现仍为 `blocked`。
- `GuidedFlowState` 的状态、原因和下一动作必须由同一决策生成；目标路由允许携带 `evaluationId`、`issueId` 或 `fixTaskId`。
- 新问题优先写入 `location/evidenceItems/causeHypothesis/resolutionSteps/verificationSteps`；旧问题只在 API 读取层兼容转换，不覆盖原 JSONL。

- Agent Provider 为 `codex | claude_code | antigravity`；适配器另允许 `task_package`。Provider 检测与直接执行能力必须分开：`0.5.0-alpha.1` 尚未完成真实 before/after 验收，所有 Provider 只允许任务包交接，不得自动执行，也不得静默改用 Codex。
- 每个 `AgentRun` 自带独立分支、worktree、执行模式、阶段和验证；同一任务同时只允许一个活动运行。
- 旧 `/api/evaluations` 与 FixTask 单 worktree 字段继续兼容读取；应用新修复必须指定 `agentRunId`，不再接受不带运行 ID 的旧写操作。
- 竞品实体只保留为规划类型，不出现在 `/api/health.capabilities`、公开 API 或主界面；恢复实现时必须重新走契约确认。

### 4.6 v0.5 公开发行与运行环境 API

| 方法 | 路径 | 请求 | 返回 |
|---|---|---|---|
| GET | `/api/health` | 无 | `DashboardHealth`，包含包版本、契约版本、真实能力与 `RuntimeReadiness` |
| POST | `/api/fix-tasks/:id/apply` | `{ confirmed: true, agentRunId }` | 只应用该次已验证且安全的 `AgentRun` |

- `RuntimeReadiness` 不读取或返回密钥、Prompt、对话正文；工作区发现只能读取明确的路径元数据。
- npm 发布物使用显式文件白名单，禁止包含 `.evalpilot`、worktree、截图、Trace、目标项目、`.project-journal` 或内部交接材料。
- Dashboard 静态资源从已安装包定位；数据根目录与包目录分离。默认启动不得选择或写入旧工作目录 `.evalpilot`；用户可通过显式 `--data-dir` 读取，或通过 `evalpilot migrate --confirmed` 复制到用户级目录，且不得覆盖源目录或已有目标。
- Public Alpha 支持能力以 `/api/health.capabilities` 为唯一事实来源；契约中规划但未实现的实体不得被 UI 推断为可用。

目标服务启动、Agent 修改和修复应用必须分别确认。Public Alpha 只生成任务包；后续恢复 Codex 直修时仍必须在独立 Git worktree 中以 `workspace-write` 运行，禁止无沙箱执行。

### 4.3 v0.3 核心实体与迁移

- `ProjectRegistry`：`version, activeProjectId, projects`，位于 `.evalpilot/projects.json`。
- `ProjectProfile`：项目身份、源码路径、目标 URL、输出目录、启动命令、状态和最近打开时间。项目列表另返回 `ProjectCardSummary`，包含最近评测时间/状态和 P0/P1 问题数。
- `ProjectReadiness`：路径/URL/Git/脏工作区事实、启动建议、端口、目标服务指纹是否匹配、阻塞原因和可评测状态。`urlReachable` 只说明端口有响应，`targetVerified` 才说明响应与所选项目匹配。
- `EvaluationSession`：深度、请求能力范围、计划能力、实际执行能力、四层覆盖摘要、流水线阶段、运行 ID、状态、错误和时间。旧记录缺少覆盖字段时只标记证据不完整，不根据名称反推已执行。
- `EvaluationCapabilityCoverage`：每个功能保存入口、是否静态发现、是否有浏览器到达证据、执行状态、关联运行 ID 和未覆盖原因。
- `EvaluationCoverageSummary`：汇总发现、计划、浏览器到达、已执行、通过、失败、阻塞、不适用和未运行数量；只有计划功能全部产生可信执行结果时 `complete=true`。
- `capabilityNames` 是实际执行功能名称的兼容快照；`plannedCapabilityNames` 表示本轮原计划。评测名称、历史卡片和上线判断不得用计划范围冒充实际范围。
- `FixTask`：问题、任务包、基线提交、允许范围、验收命令和复测案例；旧分支/worktree/verification 字段仅兼容读取。
- `AgentRun`：Agent 适配器、独立分支/worktree、状态、日志、修改文件、验证、退出码和错误。
- `FixVerification`：测试结果、before/after、安全约束、应用门禁和阻塞项。

旧版 `.evalpilot/config.yaml` 不移动、不覆盖；首次加载 v0.3 时注册为 legacy 项目，并继续使用原 `outputDir`。新项目写入 `.evalpilot/projects/<projectId>/`。

## 5. 文件命名与兼容

- TypeScript 和 YAML/JSON 字段统一 `camelCase`；本项目无数据库层，不需要 snake_case 转换。
- JSONL 每行必须是一个完整 JSON 对象；空文件允许表示“当前无记录”。
- 时间使用 ISO 8601 UTC 字符串；持续时间使用毫秒整数。
- ID 前缀：`cap-`、`persona-`、`case-`、`run-`、`issue-`、`journey-`、`friction-`、`breakpoint-`、`comparison-`。
- 配置 `version` 用于未来迁移；MVP 为 `1`。

## 6. 事实与执行状态

- `FactStatus`: `verified | declared | inferred | unknown`。
- `RunStatus`: `passed | failed | blocked | not_applicable`。
- `Severity`: `P0 | P1 | P2 | P3`。
- `ApprovalStatus`: `draft | approved | needs_human_review`。
- `AutomationStatus`: `manual | automated`。

任何无法由代码、页面、测试或 Git 证明的业务硬约束必须保留 `needs_human_review`。

`ProjectBackground.fieldStatuses` 必须覆盖除时间戳和证据映射自身外的所有顶层业务字段；`fieldEvidence` 为相同字段提供来源。能力项继续使用自身的 `status` 与 `evidence`。

## 7. v0.2 隔离、隐私与真实性约束

- 固定流程使用既有 `Scenario`；探索流程使用 `ExploratoryScenario`。探索执行器只能收到目标、Persona、起始页、边界和退出条件，禁止收到 `primaryPath`、CSS/XPath 选择器或隐藏标准答案。
- 输入轨迹默认只保存字段名、长度和不可逆指纹；不得把敏感原文写入运行记录或报告。
- UX 功能状态与 UX 评分分开；技术通过不得自动推出完整闭环通过。
- 安全步骤只能标记为 `safety`，路径优化不得建议删除安全确认或硬约束。
- 所有 UX 原因推测必须带置信度；低置信度或缺乏直接证据的判断设置 `needsHumanReview=true`。
- 所有报告必须附带真实性声明：模拟用户数据不是实际用户满意度、留存、转化或市场需求证据。
