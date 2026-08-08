# Roadmap

## Now — Evaluator Accuracy Sprint Phase 0–7

- `0.6.0-alpha.0` 已完成覆盖真值模型、Evidence Gate、Finding 分级、真实 Chromium AI Agent CI、Semantic Verifier 和任务级 Product Understanding/Oracle Builder。
- 区分资产覆盖、运行覆盖和已验证覆盖；候选案例和不完整证据不能增加已验证覆盖。
- 单次语义失败默认进入 Candidate Finding；只有门禁或人工确认后才能生成 Product Badcase。
- GitHub CI 通过 Mock Provider 运行真实 Chromium、DOM grounding、截图、Trace、Hybrid Judge、Finding、Badcase、Regression 与 Challenge 闭环，不读取真实模型密钥。
- 每步结果由确定性与语义信号合并；冲突、低置信度或缺少已授权视觉证据时失败关闭。Persona 使用显式耐心/重试/隐私/退出策略，页面等待为有界信号等待。
- 可选 Product Understanding 从路由、可见 UI 和文档摘要拆分用户任务、对象生命周期与跨页旅程；Oracle 只使用任务关联成功信号和业务规则，推断项必须人工审核。
- Legacy Evaluation 继续作为默认流程；Adaptive Evaluation 保持实验性，不对外宣称“可靠自主评测”。
- 10 个真实浏览器夹具已各运行三次，确定性 Mock Actor 基准达到内部 Recall、Precision、FPR、失败来源与一致性门禁；Ground Truth 与执行输入分离。

## Next — 真实模型与外部准确率验证

- 使用用户明确提供的凭证，单独运行真实模型 Actor 基准；结果不得与 Mock Actor 指标混合。
- 扩展来自独立真实项目的人工标注集，并由独立 Critic/Evaluator 复核 Ground Truth、预测和分类。
- 在真实模型与外部数据达到 Recall ≥ 0.80、Precision ≥ 0.80、FPR ≤ 0.15、失败来源准确率 ≥ 0.85 前，不宣称可靠自主评测。

## Later

- 可选竞品参考（公开 GitHub、应用商店和产品链接）。
- macOS 桌面封装。
- Linux 正式支持与 Windows 评估。

路线图不是交付承诺。Public Alpha 不会为未实现能力显示按钮或健康接口能力声明。
