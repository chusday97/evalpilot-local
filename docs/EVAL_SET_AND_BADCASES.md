# Eval Set 与 Badcase 维护规则

EvalPilot 会在评测运行期间持续收集两类不同的问题，并把评测案例与问题清单生成成人可以直接阅读的 Markdown。JSON 是事实源，Markdown 是自动生成的视图，请勿手工修改生成文件。

## 本地会生成什么

| 内容 | 机器事实源 | 自动生成文档 | 进入产品回归集 |
|---|---|---|---|
| Eval Case | `eval-sets/<setType>/<caseId>.json` | `eval-sets/EVAL_SET.md` | 仅 stable Regression Case |
| Candidate Finding | `findings/<findingId>.json` | 不进入 Badcase 文档 | 否 |
| 已确认 Product Badcase | `badcases/<badcaseId>.json` | `badcases/BADCASES.md` | 修复并用同案例复测 PASS 后才可进入 |
| Evaluator Badcase | `evaluator-badcases/v1/<id>.json` | `evaluator-badcases/EVALUATOR_BADCASES.md` | 否，只用于改进评测器 |

每次保存案例或 Badcase 后，对应 Markdown 会立即重建。生成失败会作为错误返回，不会被静默忽略；已原子保存的 JSON 仍可在下次写入时恢复文档。

## 两条独立生命周期

```text
产品疑似问题
  → Candidate Finding
  → 证据门禁或人工确认
  → Product Badcase
  → 修复
  → 同案例 PASS
  → Product Regression

评测器没有完成任务
  → Evaluator Failure
  → Evaluator Badcase
  → 脱敏复现夹具
  → 评测器回归测试
```

单次低置信度语义失败不能直接成为 Product Badcase。模型输出损坏、找不到安全下一步、证据缺失、工具执行错误等评测器问题，也不能被包装成产品 Bug。

## 如何检查是否记录正确

1. 运行一次评测后，打开项目数据目录下的 `eval-sets/EVAL_SET.md`，确认案例名称、目标和通过标准与本次评测一致。
2. 如果发现只是可疑，确认它只出现在 Finding 中；只有证据门禁或人工确认后，才应出现在 `badcases/BADCASES.md`。
3. 如果是 EvalPilot 自己没完成任务，确认它出现在 `evaluator-badcases/EVALUATOR_BADCASES.md`，并明确标注“不是产品问题”。
4. 修复后复跑同一案例；只有稳定 PASS 且证据完整时，才能创建 Regression Case。

## GitHub 与隐私边界

运行时生成的 Eval Set、Badcase、截图、Trace、日志和目标项目信息只保存在本机，不提交到 GitHub，也不进入 npm 包。可以贡献到公开仓库的只有：

- 不含真实项目身份和用户数据的最小复现夹具；
- 对应的预期分类与回归断言；
- 评测规则、文档和测试代码。

提交前运行 `npm run audit:package`，并检查 Git diff 中没有 `.evalpilot`、截图、Trace、本机绝对路径或内部交接资料。
