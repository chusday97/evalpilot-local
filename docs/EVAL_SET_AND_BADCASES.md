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

## 公开评测器回归集

脱敏后的评测器历史问题维护在 `tests/evaluator-regression/`，由 `fixtures.ts` 记录来源现象、真实产品时长和预期结论，由浏览器测试调用生产等待器、快照服务和下一动作引擎复现。当前固定包含：

1. 10 秒 AI 生成不提前失败；
2. 20 秒流式输出持续延长等待；
3. 只有加载提示时保持等待；
4. 永久不变的加载最终标记停滞；
5. 修复任务绑定所选评测的问题快照；
6. 陈旧全局问题文件不能改变快照；
7. 没有产品 Bug 时建议重新评测；
8. 已确认产品 Bug 时生成 Codex 修复任务；
9. 正常等待不消耗 Persona 耐心；
10. 新进展会前移停滞时钟。

运行 `npm run test:evaluator-regression` 可逐项复验。CI 为控制时间按固定比例加速页面夹具，但仍单独断言生产 AI 等待策略为 10 秒软上限、60 秒硬上限；设置 `EVALPILOT_REGRESSION_REAL_TIME=1` 可按原始时长运行。

## Connected smoke mixed-cause Badcase

2026-08-16 的第二次 AquaGuide connected smoke 暴露了一个必须保留、但**不能直接升级为 Product Badcase** 的 mixed-cause 现象：

```text
已发生的确定性动作执行失败
  → grounded variant card click 被 wishlist 子控件拦截 pointer events
  → Actor 后续继续执行
  → 更晚发生 DeepSeek provider timeout
  → 本次 journey 最终 inconclusive
```

这个 Badcase 的回归目标不是改变最终 verdict，而是防止较早发生的确定性证据被后续 terminal failure 覆盖。connected diagnostic 必须同时保留：

- `runtimeFailureSource=provider` 作为终止本次 journey 的 primary runtime attribution；
- `observedPreFailureSignals[].cause=pointer_interception` 作为中断前已观察到的独立执行证据；
- dependent journey 仍使用 `blocked_prerequisite`，不能把上游未通过复制成第二个 Product Failure。

当前 attribution 边界是 **Product ↔ Evaluator interaction boundary**。Playwright pointer interception 证明自动化点击在该 DOM/几何状态下失败，但尚不足以证明真人用户同样无法完成点击，因此不能据此创建 Product Badcase。

公开 regression 使用脱敏错误片段，只断言 signal extraction 与 attribution 分层，不提交真实 smoke 的截图、Trace、绝对路径或运行时 artifact。

## Connected smoke Oracle locale mismatch Badcase

2026-08-16 的第三次 AquaGuide connected smoke 暴露了一个独立的 **Evaluator / Benchmark Badcase**：Actor 完成了 Daily Check，页面显示了明确的英文高风险结论和增氧动作，semantic Judge 也返回 `pass`；但 deterministic Oracle 使用了混合语言的 exact-string assertions，因此把已经完成的任务误判为 P1 Product Failure。

根因链：

```text
benchmark 没有显式固定 locale
  → runner 实际呈现英文 Daily Check 结果
  → deterministic Oracle 仍要求 `Act now` + 中文动作字符串
  → exact-string hard failure
  → Hybrid Judge 按既定规则输出 Product Failure
```

这个现象必须分类为：

```text
Evaluator Badcase
  category = oracle_configuration
  subtype = locale_mismatch
  product_failure = false
```

修复边界：

- 不修改 AquaGuide 产品代码；
- 不修改 Actor / Judge prompt；
- 不放松 Hybrid Judge 的 deterministic-hard-failure precedence；
- connected AquaGuide benchmark 显式固定 Playwright locale 为 `en-US`；
- 显式把 AquaGuide 的 `aquaguide_locale` 固定为 `en`；
- 所有 locale-sensitive deterministic targets 统一到同一个英文 benchmark contract；
- preflight 与 final diagnostic 必须输出 `benchmarkLocale` / `applicationLocale`，让结果可以追溯到明确语言配置。

公开回归 `tests/connected-aquaguide-oracle-locale-regression.test.ts` 使用 Smoke #3 的脱敏可见结果，要求 `High Risk` 和 `Increase aeration or surface disturbance immediately` 在 deterministic Judge 中同时 PASS，并静态阻止 connected benchmark 再次混入中文 deterministic target。

这个 Badcase 修复后仍不能直接视为产品回归 PASS。先通过零调用 CI / preflight，再用一次新的 connected smoke 验证同一 pinned product 在修复后的 Oracle contract 下不再产生相同 false Product Failure。

### Validation closure: Smoke #5

Smoke #5 (`31954516559`) on EvalPilot `f045c92e2bcc0dc4f199b764e4ea7f4d753550a9` supplied the required real connected validation after the locale and provider-transport repairs:

- Create Aquarium: `pass`
- Record Livestock: `pass`
- Daily Check: `pass`
- Daily deterministic assertions: both `pass`
- Daily semantic Judge: `pass`
- provider/evaluator/unknown failures: `0 / 0 / 0`
- prerequisite blockers: `0`
- Actor Oracle leaks: `0`

Therefore the `oracle_configuration / locale_mismatch` false Product Failure is considered **validated closed for the pinned connected benchmark configuration**. It remains in the evaluator badcase history and regression set; it must not be reclassified as a historical AquaGuide Product Badcase.

The earlier `pointer_interception` mixed-cause signal did not recur in Smoke #5 (`observedPreFailureSignalCount=0`). One clean run is not enough to erase that historical signal, so its status remains retained / non-product / recurrence-unproven rather than resolved as impossible.

## Provider timeout retry infrastructure Badcase

Smoke #4 exposed a separate EvalPilot provider-transport implementation defect: `OpenAiCompatibleProvider` configured `maxRetries=1`, but an `AbortError` from the request timeout bypassed the retry budget and immediately terminated the logical request. The repair now retries timeout aborts while budget remains and preserves the same `REQUEST_FAILED` timeout error after exhaustion.

Classification:

```text
Evaluator infrastructure badcase
  category = provider_transport
  subtype = timeout_retry_budget_bypassed
  product_failure = false
```

Validation is intentionally split into two evidence layers:

1. zero-call provider regression proves timeout-on-first-attempt → success-on-second-attempt, timeout exhaustion, and `maxRetries=0` behavior;
2. Smoke #5 proves the repaired build can complete the full real connected three-journey benchmark with `providerFailureCount=0`.

Current observability limitation: `knowledge-boundary-audit.json` records the final status of each logical provider request, not internal attempt-level events. Smoke #5 therefore cannot prove that a timeout actually happened and was recovered during that specific run. If retry incidence becomes an operational metric, add attempt-level transport telemetry before estimating timeout/recovery rates from connected cohorts.
