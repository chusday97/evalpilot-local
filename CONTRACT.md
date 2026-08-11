# EvalPilot Local 数据契约

版本：0.6.0-alpha.0；来源：用户提供的 EvalPilot Local MVP/v0.2 规格、v0.3 四步工作台方案、v0.4.1 小白引导方案、2026-07-18 对 GitHub Public Alpha、npm CLI、MIT 许可和真实能力收口方案的确认、2026-08-01 确认的自适应 Eval Set 与 Evaluator Accuracy Sprint 方案，以及 2026-08-09 确认的 One Evaluation Path Reset。后续字段变化必须先更新本文件和 `types.ts`。

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
| `ProductModel` | 项目、版本、产品信息、用户、能力、任务、业务规则、风险、未知项和证据 | 面向任务的产品模型；与旧 `ProjectBackground` 并存 |
| `EvalCase` | 集合类型、资产状态、来源、能力/任务、Persona、目标、Oracle、覆盖维度、风险和版本 | 新 Eval Set 的案例资产；不替换旧 `Scenario` |
| `EvalOracle` | 预期、必须/禁止观察、业务规则、语义 Rubric、确定性断言和无法判定条件 | 稳定 Baseline/Regression 的必备判定契约 |
| `EvalSetManifest` | 项目、版本、时间和案例引用 | 四类 Eval Set 的索引，不复制案例正文 |
| `EvalCaseResult` | 运行、案例、三态结论、失败来源、严重度、双 Judge 结果、证据路径和时间 | 运行结果；与案例资产生命周期严格分离 |
| `Badcase` | 项目、案例、运行、分类、失败、用户影响、事实、原因假设、证据、修复状态和回归关联 | 已确认失败的长期资产 |
| `CoverageMatrix` | 项目、时间、功能级覆盖单元、资产/执行/验证覆盖率和缺口 | 多维覆盖快照，不把案例存在或单次执行表述为功能已验证 |
| `RegressionMetadata` | Badcase/Issue、首次失败、修复时间、原始失败、来源运行和修复任务 | 回归案例的可追溯来源 |

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
| POST/GET | `/api/evaluations` | POST `{ projectId, depth, capabilityIds, allowRemoteModel: true, allowScreenshot?: false }`；GET 按项目读取 | `EvaluationSession / EvaluationSession[]`；未配置 Provider 返回 `AI_PROVIDER_NOT_CONFIGURED`，不得静默回退 Legacy |
| POST | `/api/evaluations/:id/retry` | `{ confirmed: true }` | 从失败阶段恢复的 `EvaluationSession` |
| GET | `/api/evaluations/:id/events` | 无 | SSE `EvaluationEvent` |
| GET | `/api/issues` | `projectId/evaluationId` query | `UxIssue[]` |
| POST | `/api/issues/:id/dismiss` | `{ confirmed: true }` | `UxIssue` |
| POST/GET | `/api/fix-tasks` | Legacy 问题 `{ projectId, evaluationId, issueId, confirmed: true }`；Adaptive Finding `{ projectId, findingId, confirmed: true }`；Badcase `{ projectId, badcaseId, confirmed: true }` | `FixTask / FixTask[]` |
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
- `EvaluationSession`：增加 `runtime`、`selectedCaseIds`、`coverageMatrix`、`findingIds`、`badcaseIds`、远程模型授权和截图授权；深度、请求/计划/实际执行能力、兼容覆盖摘要、流水线阶段、运行 ID、状态、错误和时间继续保留。旧记录缺少新字段时只按 `runtime=legacy` 兼容读取，不改写、不根据名称反推 Adaptive 证据。
- `EvaluationOrchestratorInput`：`projectId`、`evaluationId`、`depth`、`capabilityIds`、`allowRemoteModel=true`、`allowScreenshot`；内部 `legacyFallback` 默认 `false`，普通 Dashboard 不可设置。
- `EvaluationOrchestratorResult`：`evaluationId`、`selectedCaseIds`、`runIds`、真实 `EvalCaseResult[]`、`CandidateFinding[]`、`Badcase[]` 和 `CoverageMatrix`。默认路径固定为 Product Model → Eval Set → AI Test Agent → Hybrid Judge → Finding Triage；不得调用 Legacy Explorer。
- `EvaluationFoundationState`：本地保存 `sourceFingerprint`、Product Model/Eval Set 版本和生成时间。扫描证据未变化时复用最新资产；指纹变化时才重新生成，不上传指纹或原始本地文件。
- `EvaluationCapabilityCoverage`：每个功能保存入口、是否静态发现、是否有浏览器到达证据、执行状态、关联运行 ID 和未覆盖原因。
- `EvaluationCoverageSummary`：汇总发现、计划、浏览器到达、已执行、通过、失败、阻塞、不适用和未运行数量；只有计划功能全部产生可信执行结果时 `complete=true`。
- `capabilityNames` 是实际执行功能名称的兼容快照；`plannedCapabilityNames` 表示本轮原计划。评测名称、历史卡片和上线判断不得用计划范围冒充实际范围。
- `FixSourceSnapshot`：创建修复任务时从 `evaluations/<evaluationId>/issues.jsonl`、已确认 Finding 或 Badcase 捕获的不可变来源；保存来源类型、精确身份、捕获时间和完整原始载荷。
- `FixTask`：不可变来源快照路径、问题身份、任务包、基线提交、允许范围、验收命令和复测案例；创建后不得重新解析全局 `reports/ux-issues.jsonl`。旧分支/worktree/verification 字段仅兼容读取。
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

## 8. EvalPilot Next Phase 0 文件契约

Phase 0 只增加数据基础，不改变现有 Dashboard、Explorer、评测流水线或 Provider 能力。新增文件全部位于项目独立 `outputDir` 内：

```text
product-model/product-model.v<version>.json
eval-sets/manifest.json
eval-sets/<baseline|regression|challenge|exploratory>/<case-id>.json
runs/<run-id>/result.json
findings/<finding-id>.json
badcases/<badcase-id>.json
coverage/latest.json
coverage/history/<timestamp>.json
```

- 新 JSON 必须先通过对应 Zod Schema，再使用临时文件 + 原子重命名写入。
- 读取时同样执行 Schema 校验；非法内容必须返回带文件路径的明确错误，不静默修正。
- `EvalCase.status` 仅表示案例资产生命周期：`candidate | active | stable | retired`；执行结果只写入 `EvalCaseResult.verdict`：`pass | fail | inconclusive`。
- `EvalSetManifest` 只保存案例引用和版本摘要；案例正文以各集合目录下的 JSON 为唯一事实来源。
- Stable Baseline 和 Regression 案例必须拥有非空 Oracle；Phase 0 Schema 对所有案例要求 Oracle，以避免后续出现不可判定案例。
- `RegressionMetadata` 仅在回归案例中使用；退役必须保留明确 `retirementReason`。
- Product Model、Eval Set、结果、Badcase 和 Coverage 均为新旁路数据。旧 `project-background.yaml`、`scenarios.jsonl`、`runs/*/summary.json`、评测会话和问题记录继续按原路径读取，Phase 0 不移动、不覆盖、不回填。
- Phase 0 不新增公开 Dashboard API；后续 Phase 1 接入实验路径前必须再次更新契约。

## 9. EvalPilot Next Phase 1 AI Test Agent 契约

Phase 1 新增实验性 AI Test Agent，不替换 Public Alpha 的固定/确定性探索路径。

- `AiProvider` 只提供经过 Zod 校验的结构化输出；输出非法时最多按调用配置重试，耗尽后返回明确 Provider 错误，不进行字段补写或静默纠正。
- `OpenAiProvider` 使用 Responses API 的 Structured Outputs。只有调用者显式允许时才发送截图；默认只发送最小化可见页面摘要和 DOM grounding，不发送源码、Trace、环境变量、任意本地文件或隐藏推理。
- `PageObservation` 只包含当前 URL、可见状态摘要、可交互元素、表单字段、公开页面问题和证据引用。每次观察生成 `E001` 起的稳定元素 ID；Actor 只能引用这些 ID，不能生成 CSS/XPath 或坐标。
- `AgentDecision` 每次只允许一个动作。`ActionExecutor` 必须重新校验元素是否存在、是否禁用及风险等级；删除、支付、发布、外部发送、凭证和其他高风险动作即使模型要求也返回 `blocked_by_safety`。
- 安全输入按 `known_fixture | synthetic_generated` 记录来源；敏感或高风险字段返回 `blocked_by_safety`，不生成真实个人信息、凭证或秘密。
- 每个动作必须保存带稳定 ID 的前后 `PageObservation`、独立的 before/after 截图、单步 Decision、执行结果、`TaskStateObservation` 和带稳定 ID 的 `StepVerification`；`StepEvidence` 按 `stepIndex` 连接这些引用。模型输出损坏、DOM 目标消失、页面证据不足或工具失败时结果为 `inconclusive/evaluator_failure`，不能生成产品失败。
- `TaskStateObservation` 必须在 Action 与 Verification 之间根据页面、加载、进度、完成、失败和网络信号记录 `ready | interacting | pending | progressing | completed | failed | blocked | stalled`。`pending` 和 `progressing` 表示任务仍在等待或有进展，只能将本步验证门禁为 `inconclusive`，不得判为 Verification Failure。
- 加载信号至少识别 `aria-busy`、`progressbar`、spinner 以及 loading/generating/processing/uploading/thinking/searching 文案；进度、完成和失败必须分别记录可复核信号及证据引用。只有显式错误、核心请求 4xx/5xx、未捕获错误、失败状态或动作执行失败可直接形成 `failed` 状态。
- Phase 3 使用 `OperationType = navigation | form_submit | ai_generation | file_processing | unknown_async | synchronous` 为每个动作选择 `WaitPolicy`。分类只使用当前 Grounded Element、期望结果、可见邻近文字、Product Task/Eval Case 元数据和已检测能力；无法证明时使用 `unknown_async`，不得猜测为更短的同步操作。
- 默认软/硬超时固定为：导航 3s/8s、表单提交 5s/15s、AI 生成 10s/60s、文件处理 15s/90s、未知异步 8s/30s。轮询间隔为 1–2 秒；测试可显式收紧策略，但生产默认值不能因 Persona 耐心降低。
- Progress-aware Wait 在软超时前观察任务状态；出现新进度时按 `progressExtensionMs` 延长，但始终受 `hardTimeoutMs` 和 `maxProgressExtensions` 限制。到达等待上限且未完成、未明确失败或阻止时才记录 `stalled`；不得无限等待。
- `TaskWaitEvidence` 保存操作类型、实际策略、轻量状态观察时间线、扩展次数、结束原因和是否消耗 Persona 失败尝试。轮询不创建新的 Agent Decision、InteractionAction 或用户动作；轻量状态写入同一步证据和 `task-state-observations.jsonl`。
- Persona 失败尝试只在 `state=failed`，或 `state=stalled && verification=not_confirmed` 时增加。`pending/progressing` 不增加 `failedAttempts`、不消耗 `retryTolerance`、不触发 abandon，也不能生成 Product Finding。
- 只保存简短 `intentSummary`、动作、期望、验证和置信度，不保存或请求隐藏 chain-of-thought。
- Evidence Packet 位于 `runs/<run-id>/evidence-packet.json`；Observation、Decision、Verification 同时以 JSONL 保存。每个执行动作保存 `step-NNN-before.png` 与 `step-NNN-after.png`；`finish/abandon` 也必须保存并关联最终截图。截图只保存在本地运行目录。
- `EvidenceCompleteness` 分别记录初始观察、最终观察、前后截图、逐步验证和本地 Trace 是否齐全，并列出缺失项。所有引用必须能在当前 Evidence Packet 中解析；不能只相信历史记录自报的 `complete=true`。
- Adaptive 报告的每条旅程携带同一份 `evidenceCompleteness`，导出报告与 Dashboard 必须用人话展示证据是否足够及缺失原因。
- Adaptive AI 运行使用 Playwright Trace，固定 `screenshots=true`、`snapshots=true`、`sources=false`。Trace 仅保存在 `runs/<run-id>/trace.zip`，不得发送给远程模型；写入失败时运行记录仍可读取，但结论必须降级为 Evaluator Inconclusive。
- Phase 1 实验入口必须显式启用；现有评测 API、Dashboard 导航和默认流水线保持兼容。

## 10. EvalPilot Next Phase 2 Hybrid Judge 契约

- Deterministic Judge 只判断 Evidence Packet 中可直接观察的 URL、可见文本、网络、控制台和状态证据；无法从现有证据证明的断言必须返回 `inconclusive`。
- Semantic Judge 只接收 Eval Case、Oracle、最小化 Evidence Packet 摘要和确定性结果；输出必须区分 `confirmedFacts`、带置信度的 `hypotheses` 和 `unknowns`。
- Verdict Merger 的优先级为：证据完整性门禁 → 确定性硬失败 → 任一无法判断 → 双方通过。单次 Semantic Fail 不再直接生成 Product Failure；必须继续通过 Finding Triage 门禁，否则统一返回 `verdict=inconclusive, failureSource=unknown`。
- 旧 Evidence Packet 继续兼容读取；缺少证据门禁字段时通过兼容转换生成不完整状态，不改写旧文件，也不得补推验证通过。缺少 Task State 或 progress-aware wait 的新架构旧记录将 `StepEvidence.taskState` / `taskWait` 读取为 `null`，不能反向推断当时的运行状态、等待策略或 Persona 成本。
- Provider/Schema/工具失败统一产生 `verdict=inconclusive, failureSource=evaluator, severity=null`，不得创建产品问题或 Product Regression。
- 直接证据支持的产品失败为 `failureSource=product`；无法区分产品与评测器时使用 `unknown`，不得伪造根因。
- Judge 产物写入 `runs/<run-id>/deterministic-judge.json`、`semantic-judge.json` 和 `result.json`，均先过 Schema 后原子落盘。

### 10.1 Accuracy Sprint Phase 3 Finding Triage 契约

- `CandidateFinding.status` 固定为 `candidate | confirmed_product_failure | evaluator_failure | dismissed | needs_human_review`。每个项目的新记录保存在 `findings/<findingId>.json`；旧 `findings/v1/` 继续兼容读取且不原地覆盖，旧 Badcase 不反向伪造 Finding。
- Product Failure 只允许由以下任一门禁确认：
  1. Evidence Gate 完整且 Deterministic Judge 存在硬失败；
  2. Semantic Fail 置信度不低于 `0.80`、至少两个有效证据引用且来自至少两类独立证据、案例不要求人工审核、Actor/Judge 没有评测器错误；
  3. 同一 stable Case 在至少两个独立运行中出现相同归一化失败类别和相同可观察失败，且两次 Evidence Gate 都完整；
  4. 用户通过显式确认接口确认产品失败。
- 未通过确认门禁的 Semantic Fail 保存为 Candidate Finding；运行结果保持 `inconclusive/unknown`，不得创建 Badcase、Regression 或增加已验证覆盖。
- `needsHumanReview=true` 的案例只能生成 `needs_human_review` Finding，不能自动确认 Product Failure。Provider、Schema、Trace 或工具错误保存为 `evaluator_failure`，不得冒充候选产品问题。
- `Badcase` 创建接口必须同时收到状态为 `confirmed_product_failure`、且 `projectId/caseId/runId` 与运行结果一致的 Finding。原始 Semantic Fail 或手工构造的 `fail/product` 结果不能绕过该门禁。
- Finding 状态变更必须原子写入且要求请求体 `{ "confirmed": true }`。确认产品失败会创建对应 Badcase；标记评测器失败或忽略不会创建 Badcase。

### 10.2 Accuracy Sprint Phase 4 AI Agent CI 契约

- 标准 Chromium CI 必须在安装浏览器并完成构建后执行 `npm run test:ai-agent`；该命令固定启用真实 Chromium，并运行 Agent、Evidence Gate 与 Hybrid Judge 测试。
- 标准 CI 只能使用 `MockAiProvider`，不得依赖或读取真实 `EVALPILOT_OPENAI_API_KEY`。Mock 只替代结构化模型输出；Playwright 浏览器、DOM grounding、动作执行、before/after 截图、本地 Trace、Hybrid Judge、Finding、Badcase、Regression 与 Challenge 均使用真实运行代码。
- npm 公开示例的端到端 CI 可在 `NODE_ENV=test` 下通过 `EVALPILOT_TEST_OPENAI_BASE_URL` 连接 loopback Mock Responses API；该地址必须是 `localhost`、`127.0.0.1` 或 `::1`，非测试环境与非 loopback 地址一律忽略或拒绝。测试请求仍必须显式携带 `allowRemoteModel=true`，不得绕过用户授权契约。
- CI 至少覆盖：表单完成 PASS、死点击确认失败、危险动作阻止、模型输出损坏产生 Evaluator Failure、Candidate Challenge 不增加 Verified Coverage、证据缺失不生成 Product Badcase、修复后同案例 PASS 晋升 Regression、PASS 生成 Challenge candidates。
- `test:ai-agent` 任一失败必须使 `chromium-smoke` 失败；不得使用 `continue-on-error`、空 catch 或缺少浏览器时静默跳过。

### 10.3 One Evaluation Path Phase 4 Evaluator Failure 契约

- `EvaluatorFailureCategory` 固定为 `no_next_action | unsupported_control | model_output_invalid | insufficient_context | ambiguous_page_state | wait_policy_exhausted | evidence_missing | navigation_mismatch | tool_execution_error | unknown`。
- 评测器无法选择下一步、不支持当前控件、模型输出损坏、上下文不足、页面状态歧义、等待策略耗尽但没有产品失败证据、证据缺失、导航预期不匹配或工具执行异常时，结果必须为 `inconclusive/evaluator`，严重度为空。
- Evidence Packet 完整且确定性断言已经形成 Product hard failure 时，该结论优先于 `no_next_action` 文案分类；“没有下一步”可能正是产品缺陷，不能被评测器分类静默覆盖。DOM Grounding 的观察和执行必须使用同一可见元素集合，隐藏元素不得占用可执行序号。
- 面向用户的主说明固定为“EvalPilot 暂时无法确定下一步操作。当前没有足够证据判断这是产品问题。”；技术原因只作为可展开信息，并明确可能是页面仍在处理、下一步入口不明显或评测器尚未理解页面。
- 每次分类后的 Evaluator Failure 保存为 `evaluator-badcases/v1/<evaluatorBadcaseId>.json`，内容必须通过 Zod Schema 后原子写入。`observedState`、`attemptedActions` 和 `evidenceRefs` 只能来自当前运行证据，不得补写推测事实。
- `EvaluatorBadcase` 与 Product `Badcase`、Product Regression 使用独立目录和类型；它不得创建 Product Badcase、不得进入 Product Regression，也不得增加 Verified Coverage。
- 旧运行记录保持只读；Phase 4 不根据旧文案反向补建 Evaluator Badcase。

### 10.4 One Evaluation Path Phase 5 不可变修复来源契约

- Legacy 问题修复请求必须包含 `{ projectId, evaluationId, issueId, confirmed: true }`；不再接受只包含 `issueId` 的模糊请求。Adaptive 路径使用 `{ projectId, findingId, confirmed: true }`；内部 Badcase 路径使用 `{ projectId, badcaseId, confirmed: true }`。
- `FixSourceSnapshot` 固定包含 `sourceType`、`evaluationId`、`issueId`、`findingId`、`badcaseId`、`capturedAt` 和完整 `payload`，并在任务创建时原子保存为 `fix-tasks/<fixTaskId>/source-snapshot.json`。
- Legacy 问题只从 `evaluations/<evaluationId>/issues.jsonl` 精确解析；Adaptive Finding 必须已经是 `confirmed_product_failure`；Badcase 必须属于当前项目。任一身份或项目不匹配都必须停止。
- `task.json`、`task.md`、Agent 分支命名和后续复测只使用不可变快照，不得重新解析全局 `reports/ux-issues.jsonl`。旧修复任务仍可列出，但缺少快照时必须要求从原评测重新创建，不能猜测来源。
- Canonical 来源固定为 `evaluations/<evaluationId>/issues.jsonl`、`findings/<findingId>.json` 和 `badcases/<badcaseId>.json`。`reports/ux-issues.jsonl` 与 `findings/v1/` 仅作旧数据兼容读取，不再作为新修复任务的来源。

### 10.5 One Evaluation Path Phase 6 下一动作契约

- `EvaluationNextActionType` 固定为 `no_action | run_remaining_cases | rerun_case | wait_and_resume | provide_human_input | review_candidate_finding | confirm_product_failure | create_fix_task | retest_fix | add_to_regression`。
- 每次评测必须返回且只返回一个 `EvaluationNextAction`，包含人话标题、解释、目标 Case/Finding/Badcase，以及一个可选主动作和若干次动作。路由必须带具体对象 ID，不能退化为泛化“最新结果”。
- 决策优先级固定为：运行中状态 → 已确认产品失败的修复生命周期 → 人工审查/业务信息 → 评测器失败重跑 → 未运行案例 → 无需操作。该顺序用于在多种状态同时存在时保持 exactly one 推荐动作。
- `candidate` 映射为 `review_candidate_finding`，`needs_human_review` 映射为 `confirm_product_failure`；只有 `confirmed_product_failure` 或对应 Product Badcase 可以进入 `create_fix_task/retest_fix/add_to_regression`。
- `pending/progressing` 必须映射为 `wait_and_resume`；`inconclusive/evaluator` 映射为 `rerun_case`；未运行案例映射为 `run_remaining_cases`；需要人工审核且没有 Finding 的业务规则映射为 `provide_human_input`。
- 零个已确认 Product Failure 时，主动作绝不能是创建修复、复测修复或加入回归。旧 Legacy 问题不参与 Adaptive 下一动作推导。
- 新增 `GET /api/evaluations/:id/next-action?projectId=`，从该 Evaluation Session 的 Case、Result、Evidence、Finding、Badcase 和 FixTask 谱系实时重算，不读取泛化最新报告。

### 10.6 One Evaluation Path Phase 7 结果呈现契约

- 结果页必须通过 URL 中的 `evaluationId` 读取指定 Evaluation Session，并只展示其 `runIds`、`findingIds` 和 `badcaseIds` 谱系；不得用项目最新记录替换用户刚完成或主动选择的评测。
- 默认视图固定按“本次结论 → 为什么 → 当前不能确定什么 → 你现在应该做什么 → 证据 → 技术详情”排序。标题先回答发生了什么和是否为产品问题，不得以 `fail`、`inconclusive`、Finding 状态或严重度枚举开头。
- `inconclusive` 面向用户显示“还不能判断”；`failureSource=evaluator` 显示“评测器没有完成这一步”；Candidate Finding 显示为证据尚不足的可疑现象；`pending/progressing` 与 `stalled` 分别解释为仍在处理和长时间没有变化。
- 只有已确认 Finding 或 Product Badcase 计入“确认问题”。Evaluator Failure、未运行案例、Candidate Finding 和进行中任务不得显示为产品 Bug。
- “你现在应该做什么”只显示 Phase 6 `EvaluationNextAction` 的一个主动作；当 `primaryCta=null` 时最多使用第一个安全次动作。所有路由必须保留具体对象 ID。
- 技术枚举、Session/Run ID、失败来源与严重度仅在默认折叠的“技术详情”中展示。证据区使用人话动作、实际结果和证据完整性说明，且 Trace 继续声明为仅本机保存。
- 评测完成入口与 Guidance 必须跳转到 `/runs?evaluationId=<id>`；独立单案例运行可使用 `runId` 兼容查看，但不得冒充完整 Evaluation Session 结论。

### 10.7 One Evaluation Path Phase 8 Codex 修复交接契约

- 未启用直接修复时，问题页的唯一修复入口固定命名为“生成 Codex 修复任务”；确认弹窗必须说明只生成 `task.md` 与 `task.json`，不会自动修改代码。
- 修复任务创建成功后必须进入携带精确 `fixTaskId` 的修复页，并聚焦该任务的交接说明；不得只显示短暂 Toast，也不得退化为泛化的最新任务。
- 交接说明固定展示“修复任务已准备好”“EvalPilot 当前不会自动修改你的代码”，以及打开当前项目、使用任务、由 Codex 修改并测试、返回 EvalPilot、复测修复结果五个步骤。
- Dashboard 只以 `GET /api/agents` 返回的 Codex `capabilities.directFix` 作为直修能力依据。该字段由服务端同时校验 `PUBLIC_ALPHA_DIRECT_FIX_ENABLED === true`、Codex 已安装且认证可用后生成。
- “让 Codex 直接修复”只在上述 `directFix` 为 `true` 时显示；不可用时不得渲染禁用或诱导性按钮。Codex 任务交接继续使用既有 `POST /api/fix-tasks/:id/run`，其 `executionMode` 必须是 `handoff` 且不得修改目标项目。
- Phase 8 不新增持久化实体或请求字段；`FixTask`、`AgentRun`、`AgentConnection` 及其 Zod Schema 保持不变。

### 10.8 One Evaluation Path Phase 9 评测器回归契约

- `tests/evaluator-regression/` 是单一路径评测器的公开回归入口，固定覆盖十类历史 badcase：10 秒 AI 生成、20 秒流式输出、仅有加载提示、永久停滞、评测快照修复交接、陈旧全局问题文件、无产品 Bug 的下一动作、已确认产品 Bug 的下一动作、等待不消耗 Persona 耐心，以及进展重置停滞时钟。
- 回归夹具必须记录真实产品等待时长和预期结论。标准 CI 可以按固定比例加速浏览器时钟，但必须同时断言生产 `ai_generation` 等待策略仍为 10 秒软上限和 60 秒硬上限；不得向生产代码注入假时钟或缩短真实用户等待策略。
- 每个夹具必须调用真实的任务状态观测、进展感知等待、Persona 消耗判断、不可变修复来源或下一动作决策代码；只验证夹具自身文本或复制生产分支逻辑不构成回归证据。
- `pending/progressing` 不能生成 `no_next_action` 或产品失败，且不能消耗 Persona 失败次数；无进展超过等待窗口只能进入 `stalled` 或 Evaluator Failure。每次可观察进展必须更新 `lastProgressAtMs` 并延后停滞判断。
- Legacy 全局 `reports/ux-issues.jsonl` 的后续变化不得改变已从 `evaluations/<evaluationId>/issues.jsonl` 捕获的 `FixSourceSnapshot`。没有已确认 Product Failure 时主动作固定为“重新评测”；已确认 Product Failure 且尚无 FixTask 时主动作固定为“生成 Codex 修复任务”。
- Phase 9 不新增运行时持久化实体、API 字段或 Zod Schema；`types.ts` 与现有 Schema 保持不变。回归夹具清单是测试元数据，不进入用户数据目录。

### 10.4 Accuracy Sprint Phase 5 Semantic Verifier 契约

- `EvalPersonaRef` 新增显式 Agent Policy：知识水平、耐心动作数、允许重试次数、隐私敏感度和退出条件。新案例必须写入全部字段；旧案例只在兼容读取时使用 `medium / 3 / 1 / medium / 证据不足时退出`，不得覆盖原文件。
- 每个 Agent 动作继续先执行确定性验证，再以最小化 before/after Observation、动作结果、控制台/网络增量和获准的截图运行 `SemanticStepVerification`。远程 Provider 未获得截图授权时不得接收截图，也不得确认只能由视觉证据证明的结果。
- 合并规则固定为：动作执行硬失败优先；确定性与高置信度语义结果冲突时为 `inconclusive`；语义置信度低于 `0.8` 不能独立确认；视觉目标缺少获准截图时为 `inconclusive`；其余确定性证据仍可独立确认非视觉结果。
- Reflector 不得再用 `behaviorPolicy.length` 代替耐心。重试和放弃必须使用 `patienceTurns`、`retryTolerance` 与 `exitConditions`；可选 Semantic Reflector 的建议仍受固定最大动作数、危险动作门禁和 Persona 上限约束。
- 固定 `50ms/300ms` 等待替换为有界信号等待：目标文本出现、DOM/URL 变化、加载标记消失或网络空闲；所有路径必须有明确超时，超时只表示当前步骤未确认，不能无限等待或伪造通过。
- 新运行在版本矩阵中记录 `verifierPromptVersion`、可选 `reflectorPromptVersion` 和 `toolSchemaVersion=1.3.0`；旧 Evidence Packet 缺少这些字段时继续兼容读取，不补写原文件。

### 10.4 Accuracy Sprint Phase 6 Product Task 与 Oracle 契约

- Product Understanding 只接收已采集的 Background、Blueprint、路由、公开页面可见导航/标题/表单/主按钮、文档摘要和已有未知项。Prompt 使用有界证据目录；输出引用不存在的证据、路由或入口时必须过滤并标记人工审核，不能把模型补全包装成事实。
- `ProductTask.successSignals` 保存任务级成功信号，`businessRuleIds` 只关联当前任务适用的规则；信号类型限定为 `text_visible / text_absent / url_matches / request_observed / console_error_absent / state_persisted / semantic`。`ProductModel.objectLifecycles` 与 `crossPageJourneys` 保存对象状态和跨页任务关系。以上字段对旧 Product Model 可选，新生成模型必须写入。
- Oracle Builder 只允许从任务成功信号生成当前 Verifier 支持的确定性断言；不得生成选择器、隐藏状态或未提供证据支持的业务规则。具体预期、必须出现/禁止出现内容、语义评分和无法判断条件均需通过 Zod Schema。
- 任何 `inferred/unknown` 业务规则、任务、成功信号、对象生命周期或跨页旅程进入案例时，`needsHumanReview=true`；此类案例继续受 Phase 3 门禁约束，不能通过 Semantic Gate B 自动创建 Product Badcase。
- Product Understanding 或 Oracle Provider 失败时返回带警告的确定性兼容结果，不覆盖旧模型，不静默伪造增强结果。旧 Background、Blueprint、Product Model 和 Eval Case 继续原样读取。
- `POST /api/projects/:projectId/eval-set/generate` 继续要求 `confirmed=true`；只有请求同时提供 `allowRemoteModel=true` 且本机已配置 Provider 时，才发送上述最小化证据并启用 Product Understanding/Oracle Builder。默认仍走本地确定性生成，响应返回真实 `generationMode` 与 `warnings`。

### 10.5 Accuracy Sprint Phase 7 Real Evaluator Benchmark 契约

- 现有 40 条 `BenchmarkFixture` 继续称为“规则单元基准”：它读取预计算 Observation，只证明规则实现，不得与真实浏览器准确率混用。
- `RealBenchmarkGroundTruth` 与浏览器 App、Eval Case、Agent/Judge 输入分离；运行器只能在预测完成后读取 Ground Truth 计分，禁止把期望分类或失败来源注入 Actor、Judge 或 Triage。
- 至少 10 个可运行 Chromium 夹具，每个使用全新 Browser Context 独立运行至少 3 次，生产链路固定为 Agent → Evidence Packet → Hybrid Judge → Finding Triage → Ground Truth comparison。第一轮使用确定性 Mock Actor 隔离 Judge；真实模型是需要用户凭证的可选第二基准。夹具协议最多 3 个动作、单步最长 1 秒，必须仍覆盖 900ms 延迟结果，不能用零等待制造假失败。
- `RealBenchmarkReport` 必须保存逐次 `RealBenchmarkRunResult`、逐夹具一致性和九项指标：任务完成率、召回率、精确率、误报率、分类准确率、严重度准确率、失败来源准确率、无法判断率、运行一致性。
- 内部门禁暂定 Recall ≥ 0.80、Precision ≥ 0.80、FPR ≤ 0.15、Failure Source Accuracy ≥ 0.85。任何一项未达标时 `reliabilityGate.met=false` 并列出原因；即使达标也只能记录为内部基准通过，不得自动修改营销文案或宣称“可靠自主评测”。
- Ground Truth、预测、截图和 Trace 保持本地；基准不读取真实 OpenAI Key，不修改旧 Evaluation、Scenario、Issue、Coverage 或 40 条规则单元基准。
- Agent 因安全策略阻止危险操作时，Adaptive Evaluation 必须返回 `inconclusive/evaluator`，不得把未达到危险结果转写为 Product Failure 或 Badcase。

## 11. EvalPilot Next Phase 3 Product Model 与 Baseline 契约

- Product Model 由现有证据化 `ProjectBackground + EvalBlueprint` 生成；Capability 表示用户任务能力，不按路由数量机械拆分。每个 Capability 至少关联一个 `ProductTask`，推断任务必须保留 `needsHumanReview=true`。
- 用户类型、任务、规则、风险和未知项必须保留原始 EvidenceClaim/FactStatus；没有证据的内容不得升级为 verified。
- Baseline 按 ProductTask 生成稳定案例；每个 stable Baseline 必须包含非空 `expectedOutcome`、`semanticRubric` 和 `inconclusiveWhen`。不可靠的业务规则继续标记案例 `needsHumanReview=true`。
- 生成器使用确定性 ID，重复生成相同 Product Model 版本时更新同一案例，不制造重复资产；生成结果通过现有 Eval Set Store 持久化。
- 本阶段不自动运行新 Baseline，也不删除旧 Scenario；实验流水线明确选择新架构时才消费这些资产。

## 12. EvalPilot Next Phase 4 Badcase 与 Regression 契约

- 只有 `EvalCaseResult.verdict=fail && failureSource=product` 可创建 Product Badcase。Evaluator Failure、unknown 和 inconclusive 不得进入产品回归。
- Badcase 的 `confirmedFacts` 只复制 Judge 已确认事实；根因保持为带置信度、支持/反证和验证方法的 Hypothesis，不生成唯一确定根因。
- 修复状态必须显式更新为 `fixed`；随后使用同一个原始 `caseId` 的 PASS 结果复测，才可晋升 Regression。
- Regression 使用新案例 ID，保留 Badcase、Issue、首次失败运行、修复时间、原始失败、复测来源和 FixTask 谱系；状态固定为 stable。
- 晋升操作先验证全部门禁，再写 Regression Case，最后更新 Badcase 的 `regressionCaseId`，避免失败路径污染现有回归集。

## 13. EvalPilot Next Phase 5 PASS、Coverage Gap 与 Challenge 契约

- PASS 只确认当前案例覆盖维度中的具体条件，不等于整个功能已验证；每次 PASS 都必须重新计算 Coverage Matrix。
- Coverage 目标由 Product Model 和固定最小变体集合生成，至少覆盖 capability、persona、input quality、system state、journey、risk、recovery 与 interaction pattern；没有 AI 输出能力时不伪造 AI-output 覆盖。
- `PassAnalysis` 返回本次确认条件、仍存在的 Coverage Gap 和候选 Challenge；候选默认只存在内存中，用户/流水线显式保存后才进入 Eval Set。
- 第一版 Challenge 必须支持 boundary、journey mutation 和 persona mutation。每个候选保留来源案例和 Gap ID，继承 Oracle 并明确新的假设与覆盖维度。
- Challenge 不得自动成为 permanent/stable；初始状态固定为 candidate。Repeated PASS 的稳定/退役策略在后续演进服务中执行。

### 13.1 Truthful Coverage（v0.5 Accuracy Sprint）

- 覆盖单元按 `capabilityId + dimension + value` 建立。一个功能的证据不能补足另一个功能的输入、状态、旅程或恢复覆盖。
- `assetCoverageRatio` 只表示目标单元存在非退役案例；candidate/active 只记为候选资产，stable 记为稳定资产。
- `executionCoverageRatio` 表示对应单元至少有一次 `pass/fail/inconclusive` 运行结果；失败属于已执行，不属于已验证。
- `verifiedCoverageRatio` 仅在 stable Case 的最新结果为 PASS，且对应 Evidence Packet 通过当前 Evidence Gate 时增加。
- `coverageRatio` 暂时保留为 `verifiedCoverageRatio` 的废弃别名；新增代码不得把它解释为案例资产覆盖。
- 缺口必须区分 `missing_asset/not_executed/not_verified/inconclusive/failed`，并说明缺少案例、尚未运行、证据不足、无法判断或产品失败。
- 旧 Coverage 文件继续兼容读取但不原地覆盖：旧 `coverageRatio` 只解释为历史资产覆盖；因缺少运行与 Evidence Packet 关联，其执行覆盖和已验证覆盖均为 0。

## 14. EvalPilot Next Phase 6 自由探索契约

- Exploration Planner 只接收 Product Model、Coverage Gap 和用户确认的公开范围，由 Agent 提出可验证假设；禁止把固定步骤、选择器或隐藏标准答案注入探索上下文。
- 每个 `ExplorationHypothesis` 必须关联一个能力、可观察目标、覆盖维度和安全动作边界。支付、删除、发布、外部发送、凭证与其他不可逆动作在规划阶段直接拒绝。
- 探索执行复用 Phase 1 的 grounding、动作门禁、逐步验证和 Evidence Packet，并以 `mode=exploration` 标识；模型或工具失败仍归类为 evaluator/inconclusive。
- `ExplorationFinding` 只有在证据可复核、贡献新覆盖且结果可复用时才具备晋升资格；晋升仍需显式调用，生成的案例固定为 `setType=exploratory,status=candidate`，不得自动进入稳定集或回归集。

## 15. EvalPilot Next Phase 7 Dashboard 读取与生成接口

主导航迁移为 `Projects → Eval Set → Runs → Findings → Fixes → Regression`。首页仍从品牌入口访问，旧 `/evaluate`、`/issues` 与现有 API 保持兼容。

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/projects/:id/product-model` | 读取最新 Product Model；未生成时返回 `null`。 |
| GET | `/api/projects/:id/eval-set` | 返回 Manifest、四类计数、退役数和模型版本。 |
| POST | `/api/projects/:id/eval-set/generate` | 明确确认后从现有背景/蓝图生成并原子保存 Product Model、Baseline 与 Coverage。 |
| GET | `/api/projects/:id/eval-cases` | 读取项目全部新架构案例。 |
| GET | `/api/eval-cases/:caseId?projectId=` | 读取单案例；项目隔离以查询参数或当前项目为准。 |
| GET | `/api/projects/:id/adaptive-runs` | 返回新架构运行摘要，不混入旧运行推断。 |
| GET | `/api/projects/:id/coverage` | 读取最新 Coverage；尚未生成时返回 `null`。 |
| GET | `/api/projects/:id/badcases` | 返回已确认产品失败的 Badcase。 |
| GET | `/api/projects/:id/findings` | 返回候选、待人工审核、评测器失败、已忽略和已确认发现。 |
| GET | `/api/findings/:findingId?projectId=` | 返回单条 Finding。 |
| POST | `/api/findings/:findingId/confirm-product-failure?projectId=` | `{ confirmed: true }` 后确认产品失败并创建 Badcase。 |
| POST | `/api/findings/:findingId/mark-evaluator-failure?projectId=` | `{ confirmed: true }` 后标记为评测器失败，不创建 Badcase。 |
| POST | `/api/findings/:findingId/dismiss?projectId=` | `{ confirmed: true }` 后忽略发现，不创建 Badcase。 |
| GET | `/api/badcases/:badcaseId?projectId=` | 返回 Badcase 详情。 |
| GET | `/api/projects/:id/regression` | 返回 Regression 案例与谱系。 |
| GET | `/api/runs/:runId/evidence?projectId=` | 返回对应 Evidence Packet；缺失时为 404。 |
| GET | `/api/runs/:runId/result?projectId=` | 返回经 Schema 校验的 Hybrid Judge 结果。 |

- 所有列表在资产不存在时返回空数组或 `null`，不把“尚未生成”显示为服务错误。
- 生成接口必须要求 `confirmed=true`；部分生成失败不得伪装成功，原子存储继续由各 Store 保证。
- Dashboard 中“已测试”只来自 `EvalCaseResult`，案例存在但无结果统一计为 `NOT RUN`；Coverage Gap 存在时禁止展示“完全验证”。

## 16. EvalPilot Next Phase 8 自基准契约

- 内置基准第一版固定包含 20 个已知失败和 20 个干净/预期行为，覆盖死点击、无反馈、状态丢失、API 500、重复提交、超时、下一步缺失、AI 输出不相关和危险动作门禁。
- `BenchmarkGroundTruth` 与原始 Observation 分离；评测器不得读取 `expectedIssues` 决定预测，只能读取可观察信号。
- 报告计算 Bug Detection Recall、Precision、False Positive Rate、Classification Accuracy 与 Evaluator Failure Rate，并保存逐夹具预测。
- CLI `evalpilot benchmark [--json]` 运行本地确定性基准，不访问网络、不调用远程模型。该成绩只说明内置直接证据规则在已知夹具上的表现，不能作为真实世界“可靠自动测试”声明。

## 17. 跨阶段运行版本与 AI 输出 Oracle

- 每个新架构 Evidence Packet 必须包含 `RunVersionMetadata`：目标 Git SHA、Product Model/Eval Set/Case/EvalPilot 版本、Actor/Judge 模型、两类 Prompt 版本、工具 Schema 版本和运行时间。缺少这些字段的旧证据可兼容查看，但不能用于严格回归对比。
- `EvalOracle.aiOutputCriteria` 仅在产品能力确实包含 AI 输出时使用，支持 relevance、factuality、consistency、instruction following、uncertainty expression、citation quality、hallucination、safety 和 format correctness。
- 领域关键事实不得只由 LLM-as-Judge 决定；对应 Criterion 必须设置 `humanReviewRequired=true`，可选参考答案只作为证据之一。

## 18. 下一轮 Eval Set 选择契约

- 快速检查选择所选功能中的 P0/P1 Baseline 与 P0/P1 Regression；核心评测选择 P0–P2 Baseline、全部相关 Regression 和最多 3 条 Challenge；完整评测选择所选功能的全部 Baseline、Regression、Challenge 与 Exploratory。
- 任何深度都必须先按用户所选 `capabilityId` 过滤，完整评测不得运行无关功能。Regression 在同一功能内优先于 Challenge，确保历史失败进入下一轮。
- `EvalSetSelection.counts` 必须与实际返回案例一致，Dashboard/报告不得用 Manifest 总数冒充本轮运行数。

## 19. 新架构报告契约

- `AdaptiveEvaluationReport` 固定保存 16 个语义区块：执行结论、已测、未测、覆盖矩阵、案例结果、AI 用户旅程、失败、无法判断、已确认事实、根因假设、新 Badcase、新 Regression、PASS 后缺口、新 Challenge、建议下一步、真实性/不确定性声明。
- 新生成的 `AdaptiveEvaluationReport` 必须在顶层保存当前 `evaluationId`，确保评测记录、报告与下一动作属于同一谱系；旧报告缺少该字段时继续兼容读取，不得伪造补写。
- `executiveVerdict` 只有在没有产品失败、没有无法判断、没有未运行且没有高优先级 Coverage Gap 时才可为 `can_continue`；否则分别使用 `needs_attention` 或 `insufficient_evidence`。
- JSON 与 Markdown 同源生成并原子保存到 `reports/latest-evaluation.json|md`；版本元数据从每个 Evidence Packet 复制，不重新推断。

## 20. Eval Set 与 Badcase 可读文档契约

- Eval Set、Product Badcase 与 Evaluator Badcase 的 JSON 仍是机器可读事实源；Markdown 只是可随时重建的只读派生产物，不增加或反向修改业务数据。
- 每次成功保存 `EvalCase` 后，必须同步重建 `eval-sets/EVAL_SET.md`；内容至少包含集合、状态、风险、用户目标、Oracle 通过标准、无法判断条件、覆盖维度和 Regression 来源。
- 每次成功保存已确认的 Product `Badcase` 后，必须同步重建 `badcases/BADCASES.md`。Candidate Finding、Evaluator Failure 和未确认语义失败不得进入该文档。
- 每次保存 `EvaluatorBadcase` 后，必须同步重建 `evaluator-badcases/EVALUATOR_BADCASES.md`；该文档必须明确这些记录属于评测器自身问题，不是产品 Bug，也不进入 Product Regression。
- 派生文档写入失败必须向调用方返回错误，不能静默吞掉；已经完成原子写入的 JSON 事实源保持可恢复，下一次保存可重新生成文档。
- 上述运行时文档保存在项目独立的本地数据目录，受 `.evalpilot` / 用户数据目录边界保护，不进入 npm 包或 GitHub。公开仓库只保存文档规则、脱敏测试夹具和可复现验证方法。
