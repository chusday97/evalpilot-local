# One Evaluation Path Phase 8 验证记录

## 范围

本阶段只澄清 Fix Task → Codex 的交接体验，不进入 Evaluator Regression Suite，不启用 Public Alpha 直接修复，也不修改 Agent 执行与应用修复的数据谱系。

## 用户可见变化

- 问题入口统一为“生成 Codex 修复任务”。
- 创建前明确说明只生成 `task.md` 与 `task.json`，不会自动修改代码。
- 创建成功后携带精确 `fixTaskId` 进入五步 Codex 交接说明并自动定位。
- “复测修复结果”返回原 `evaluationId` 的结果与下一动作，不直接把任务标记为已修复。
- “让 Codex 直接修复”只在服务端确认 `codex.capabilities.directFix=true` 时出现；当前 Public Alpha 开关为关闭，因此默认不显示。

## 数据契约

Phase 8 不新增持久化实体或请求字段。界面复用 `FixTask`、`AgentRun` 和 `AgentConnection.capabilities.directFix`；服务端 `/api/agents` 会执行认证能力检查后返回直修能力。

## 验证门禁

- `npm run check`
- Phase 8 Dashboard UI/API/Agent 专项
- `npm run build`
- Dashboard Chromium 桌面与 390px 流程
- 全量测试、包审计与仓库外消费验证

验证结果：200 项默认测试通过、28 项按环境跳过；Phase 8 Dashboard UI/API/Agent 专项 15 项通过；Dashboard Chromium 桌面与 390px 1 项通过；TypeScript check、生产构建、仓库外消费者安装均通过；npm 包 173 个文件、272207 bytes、敏感命中 0。真实 Codex 修改不属于本阶段，且当前直接修复门禁保持关闭。
