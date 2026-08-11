# One Evaluation Path Phase 9 验证记录

## 范围

Phase 9 只建立评测器回归门禁并修复由该门禁复现的错误，不进入 Phase 10 Legacy 隔离，也不扩展 Agent 或竞品功能。

## 契约与实现

- `tests/evaluator-regression/fixtures.ts` 固定记录 10 个脱敏历史 badcase、真实产品时长和预期结论。
- `tests/evaluator-regression/evaluator-regression.test.ts` 直接调用生产任务状态观测、进展感知等待、Persona 消耗判断、不可变 FixSourceSnapshot 和下一动作引擎。
- CI 使用 0.04 时间比例运行浏览器夹具，同时断言生产 `ai_generation` 策略仍是 10 秒软上限、60 秒硬上限。可通过 `EVALPILOT_REGRESSION_REAL_TIME=1` 执行原始时长。
- Phase 9 没有新增持久化实体、API 字段或 Schema；`types.ts` 和现有 Zod Schema 不变。

## 本阶段发现并修复的问题

20 秒流式输出在首次真实 Chromium 运行中错误进入 `stalled`。原因是每次进展都把截止时间替换为“当前时刻 + 延长量”，导致有限延长次数在任务前段耗尽。修复后，合格进展在已有截止时间上累加延长窗口，并继续受硬上限约束；永久不变的加载仍会按软等待窗口停滞。

下一动作引擎的已确认产品问题按钮仍使用旧文案“创建修复任务”。它已与 Phase 8 交接体验统一为“生成 Codex 修复任务”，浏览器测试也改为验证这一用户可见文案。

## 验证证据

- `npm run check`：通过。
- `npm run test:evaluator-regression`：11 项通过，其中 10 项对应固定 badcase，1 项验证清单完整且 ID 唯一。
- `npm test`：205 项通过，34 项按环境跳过。
- `npm run test:dashboard`：10 项通过，包含真实 Chromium 桌面与 390px 流程。
- `npm run build`：通过。
- `npm run audit:package`：173 个文件，压缩包 272271 bytes，敏感命中 0。
- `npm run test:consumer`：仓库外临时目录安装通过，Dashboard 与健康接口就绪，npm audit 0 漏洞。

## 已知边界

- CI 加速只影响测试页面计时，不改变生产等待策略；原始 10/15/20 秒模式可选择性运行，未作为每次本机默认门禁，以控制反馈时间。
- 本轮没有可用的独立 Critic/Evaluator 线程。以上为 Builder 的自动化和实际运行证据，不能冒充独立审查结论。
- Phase 10 尚未开始。
