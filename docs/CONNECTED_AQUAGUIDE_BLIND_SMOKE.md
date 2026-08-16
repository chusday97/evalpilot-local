# Connected AquaGuide Blind Smoke

This phase validates the calibrated connected-model path against the pinned AquaGuide product rather than only controlled probe pages.

Initial scope is deliberately narrow:

- pinned AquaGuide commit `8663b469c50605529367daf1b69ac0cd7cfb0cac`
- provider `deepseek`
- model `deepseek-v4-flash`
- one repetition only
- three existing Blind Experience journeys: create freshwater aquarium, record existing livestock, and Daily Check
- screenshots remain disabled for provider input
- Oracle remains hidden from the Actor and visible only to the Judge

The first run is a smoke test. It must preserve raw Actor decisions, browser evidence, Judge output, UX findings, and provider/evaluator failure attribution. A successful workflow run is not by itself evidence that the evaluator is correct.

Do not tune prompts, detector thresholds, or AquaGuide-specific heuristics from a single connected run. Any observed badcase should be retained first, attributed to the smallest responsible layer, and only then considered for a production change.

## Smoke #2: mixed-cause evidence

The second paid smoke ran on EvalPilot `f6da369502367bcb8c88a91eb7f9b6a839d6fe36` against the same pinned AquaGuide commit. It validated the runtime-attribution repair:

- create aquarium: `pass`
- record livestock: `inconclusive` with `runtimeFailureSource=provider`
- Daily Check: `blocked_prerequisite` because the livestock journey did not pass
- Actor Oracle leaks: `0`
- evaluator failures: `0`

The livestock run also contained an earlier deterministic action-execution failure before the terminal DeepSeek timeout. Playwright attempted to click a grounded variant card and reported that a wishlist control intercepted pointer events. The Actor later continued, so this earlier event is not the terminal failure and is not sufficient by itself to declare an AquaGuide Product Failure.

Connected-smoke diagnostic schema v3 therefore preserves two independent layers:

```text
terminal runtime attribution
  runtimeFailureSource = provider | evaluator | null

observed pre-failure evidence
  observedPreFailureSignals[]
    - action_execution_failure
    - pointer_interception when deterministically observed
```

`observedPreFailureSignals` is a sidecar derived from the already persisted Agent evidence packet. It does not change `EvalCaseResult`, does not alter the final verdict, and does not make `protocolHealthy=false` by itself. Its purpose is to keep recoverable execution evidence from disappearing when a later provider/evaluator interruption becomes the terminal cause.

A `pointer_interception` signal is currently classified at the **product/evaluator interaction boundary**. It records what Playwright observed; it does not claim that a human user is necessarily blocked by the same geometry. Product attribution requires separate confirmation.

Do not run another paid smoke solely to reconfirm this extraction. First keep the mixed-cause regression green locally/CI; only then use another real smoke when it can answer a new question.
