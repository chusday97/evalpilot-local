# One Evaluation Path Phase 6 验证记录

## 范围

本阶段只实现“评测结果 → 唯一下一步”，不改 Phase 7 页面，不自动创建 FixTask、Badcase 或 Regression Case。

## 已实现

- `EvaluationNextAction` 契约、TypeScript 类型与 Zod Schema。
- 固定优先级的纯函数 Next Action Engine，覆盖 10 种动作类型。
- Adaptive Report 同时保存结构化 `nextAction`；旧的 `recommendedNextActions` 保留为兼容说明。
- `GET /api/evaluations/:id/next-action?projectId=` 从指定评测的独立谱系实时重算。
- Legacy Evaluation 返回“旧评测仅供查看”，不会从缺失的新式证据猜测动作。
- 没有 confirmed Product Failure 时，禁止推荐创建修复、复测修复或加入回归。
- `add_to_regression` 同时要求 Badcase 已明确标记 fixed、存在同案例 PASS，且尚未关联 Regression Case。

## 非专家验收方法

1. 完成关键案例且全部 PASS：应看到“当前无需处理”，没有主按钮。
2. 留一个已选案例不运行：应看到“运行剩余案例”，按钮带当前 `evaluationId`。
3. 让评测器失败：应看到“重新运行评测案例”，不能看到修复代码。
4. 保留 Candidate Finding：应先看到“复核候选发现”。
5. 将 Finding 确认为 Product Failure：此时才允许看到“创建修复任务”。
6. 修复后同案例 PASS：应先建议复测/加入回归，不能跳过闭环。
7. 在 API 中分别请求一条旧评测和最新评测：两者动作必须跟随各自数据，不得同时显示最新结果。

## 自动验证

- `npm run check`
- `npx vitest run tests/next-action-engine.test.ts tests/adaptive-report.test.ts tests/dashboard-api.test.ts`
- `npm test`
- `npm run build`
- `npm run audit:package`

## 最终结果

- 类型检查：通过。
- Phase 6 专项：25 项通过。
- 全量默认测试：196 项通过、27 项按环境条件跳过。
- Dashboard/浏览器/端口恢复：10 项通过。首次受沙箱回环端口限制出现 `EPERM`，在获准只监听本机回环端口后复跑通过。
- 生产构建：通过。
- npm 包审计：172 个文件，压缩后 266,677 bytes，敏感命中 0。

浏览器中的 Phase 7 结果页重写尚未开始，本记录不把 API 和报告契约通过描述成页面已经交付。
