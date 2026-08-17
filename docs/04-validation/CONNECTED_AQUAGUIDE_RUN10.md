# Connected AquaGuide Run #10 — retained-evidence analysis

Date: 2026-08-17

This note records evidence from Connected AquaGuide Blind Smoke Run `31999907665`. It separates product behavior, deterministic Oracle behavior, semantic Judge/provider behavior, and the next validation gate.

## Frozen identity

- EvalPilot SHA: `416d5dee32e2ed4ea38956d875f068ff8cd8d41c`
- AquaGuide SHA: `2add55a54402afc18b642b572d8ee8351ab72c53`
- Provider/model: `deepseek / deepseek-v4-flash`
- Daily run: `run-ai-2026-08-17T06-13-27-705Z`
- Screenshots sent to provider: `false`

## Workflow outcome

The paid connected smoke executed. Create Aquarium and Record Livestock passed. The Daily Actor completed its interaction path, but the semantic Judge timed out twice at the provider boundary, so the persisted Daily verdict was `inconclusive` and the smoke protocol was unhealthy.

Provider telemetry for Daily semantic Judge:

```text
attempt 1/2: timeout after ~45.0s
attempt 2/2: timeout after ~45.0s
```

The same run also contained a recoverable 45s Actor timeout during Livestock; its retry returned successfully in ~15.6s. This supports classifying the Daily terminal interruption as provider latency/availability rather than a generic evaluator-runtime failure.

## Product navigation evidence

The Daily Actor no longer followed the historical Care Guide → Quick Check path. It entered `Daily Aquarium Check`, selected the supplied observations, generated a result, and saved today's record.

This is positive runtime evidence for the PUI-BC-023 navigation/IA fix, but it is not yet a same-case PASS because the semantic Judge did not return. PUI-BC-023 must therefore remain unresolved in the lifecycle until a valid Judge result is available.

## Oracle drift found and fixed

Run #10 retained evidence showed stable visible product-state markers:

- `Act now`
- `Do this first`
- `已保存今天的检查记录。`

The previous deterministic Oracle still expected older English strings and therefore produced a false hard failure. EvalPilot commit `d6283933f9f86abf8407b85d34f8578b92ba9b4b` aligned the Daily deterministic contract with the retained saved state and added regressions for:

1. Quick Check-only → fail.
2. Real Daily result but not saved → fail.
3. Run #10-style saved Daily result → pass.

CI Run `32001754024` completed successfully across Node 20, Node 24, and the Chromium smoke job, including evaluator regression and browser tests.

## Prompt-size hypothesis rejected

The semantic Judge payload shape was reconstructed from retained evidence using the production prompt builder.

Approximate UTF-8 payload sizes:

- Create: ~62.9 KB — Judge succeeded.
- Livestock: ~88.8 KB — Judge succeeded.
- Daily: ~63.6 KB — Judge timed out twice.

Therefore the current evidence does not support “Daily timed out because its Judge prompt was unusually large.” The leading classification remains provider latency/availability variance.

## New Product Badcase discovered from the same evidence

Run #10 also exposed a separate deterministic AquaGuide rule-engine failure. The Actor selected:

- `经常浮头`
- `清澈`
- `没有泡沫或油膜`
- `没有异味`
- `正常游动和进食`
- `没有特别操作`

The product nevertheless returned `鱼浮头并伴随水体异常` and included a `少量换水 20%-30%` action.

Root cause in AquaGuide is substring matching of categorical answers: `没有异味` contains the positive substring `有异味`, so the water-abnormal high-risk rule is falsely matched. This is tracked as AquaGuide `PUI-BC-024`, Issue #74. It is independent of the later Judge timeout.

## Next validation gate: Judge-only replay

EvalPilot now provides a retained-evidence Judge replay path. The replay:

1. Reads the exact saved Daily `evidence-packet.json` from Run #10.
2. Validates case ID, target SHA, and Evidence Packet completeness.
3. Re-runs the current deterministic Oracle locally.
4. Reports semantic prompt byte size during a zero-call preflight.
5. Only after explicit paid-call authorization, calls the semantic Judge.
6. Re-merges deterministic + semantic results using the normal Hybrid Judge merger.

Boundary: a Judge-only replay can repair/complete the verdict for the retained evidence, but it does not constitute a fresh product interaction run.

Do not trigger another full three-journey paid smoke merely to retry this Judge transport failure. First fix PUI-BC-024 and use the retained-evidence Judge replay when remote-call authorization is explicitly provided.
