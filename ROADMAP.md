# Roadmap

## Now — Evaluator Accuracy Sprint Phase 0–4

- `0.6.0-alpha.0` 已完成覆盖真值模型、Evidence Gate、Finding 分级和真实 Chromium AI Agent CI。
- 区分资产覆盖、运行覆盖和已验证覆盖；候选案例和不完整证据不能增加已验证覆盖。
- 单次语义失败默认进入 Candidate Finding；只有门禁或人工确认后才能生成 Product Badcase。
- GitHub CI 通过 Mock Provider 运行真实 Chromium、DOM grounding、截图、Trace、Hybrid Judge、Finding、Badcase、Regression 与 Challenge 闭环，不读取真实模型密钥。
- Legacy Evaluation 继续作为默认流程；Adaptive Evaluation 保持实验性，不对外宣称“可靠自主评测”。

## Next — Phase 5–7（尚未开始）

- Phase 5：语义步骤验证、确定性与语义合并规则，以及有界等待策略。
- Phase 6：任务级 Product Model 与 Oracle Builder，推断业务规则必须人工审核。
- Phase 7：至少 10 个真实浏览器夹具、每个运行三次，测量 Recall、Precision、FPR、失败来源准确率与一致性。
- 指标达到 Recall ≥ 0.80、Precision ≥ 0.80、FPR ≤ 0.15、失败来源准确率 ≥ 0.85 前，不宣称可靠自主评测。

## Later

- 可选竞品参考（公开 GitHub、应用商店和产品链接）。
- macOS 桌面封装。
- Linux 正式支持与 Windows 评估。

路线图不是交付承诺。Public Alpha 不会为未实现能力显示按钮或健康接口能力声明。
