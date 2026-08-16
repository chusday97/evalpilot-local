# Badcase: variant card pointer interception

## Status

- Badcase ID: `variant_card_pointer_interception`
- First confirmed evidence: Connected AquaGuide Blind Smoke #2 (`31943203037`)
- EvalPilot commit: `f6da369502367bcb8c88a91eb7f9b6a839d6fe36`
- Pinned AquaGuide commit: `8663b469c50605529367daf1b69ac0cd7cfb0cac`
- Current classification: Product ↔ Evaluator interaction boundary
- Product failure: not confirmed
- Evaluator failure: not confirmed
- Regression status: covered by deterministic browser fixture on `agent/mixed-cause-attribution`

## Observed evidence

During `blind-record-existing-livestock`, the Blind Actor selected the visible species variant labeled `标准款`. The grounded Playwright click failed because an overlapping wishlist control intercepted pointer events. The journey subsequently continued and later terminated because the DeepSeek request timed out.

This means the run contained two different causes in sequence:

1. a deterministic browser action execution failure that did not immediately terminate the journey;
2. a later provider timeout that did terminate the journey.

The terminal runtime attribution remains `provider`. The earlier browser action failure must not be erased merely because a later provider failure became terminal.

## Why this is not yet a product bug

The evidence proves that EvalPilot's grounded Playwright click failed on the pinned DOM. It does not prove that a human user cannot select the same variant, because a human may click a different point inside the visible card. Therefore this badcase must remain at the Product ↔ Evaluator boundary until human-equivalent interaction semantics or an independent product reproduction confirms the product side.

## Smallest responsible-layer fix

Preserve failed browser actions as diagnostic sidecar evidence:

```json
{
  "runtimeFailureSource": "provider",
  "observedPreFailureSignals": [
    {
      "type": "action_execution_failure",
      "action": "click",
      "cause": "pointer_interception",
      "targetElementId": "...",
      "summary": "... intercepts pointer events",
      "evidenceRefs": ["..."]
    }
  ]
}
```

`observedPreFailureSignals` is diagnostic-only. It does not change the journey verdict, `runtimeFailureSource`, product failure classification, or existing UX detector output.

## Regression contract

The regression must prove all of the following:

- a grounded click whose target center is covered by an overlapping wishlist control fails deterministically;
- the failure is classified as `action_execution_failure` with cause `pointer_interception`;
- successful actions do not emit pre-failure signals;
- the connected AquaGuide workflow enriches the artifact after the paid smoke and before protocol validation;
- the enrichment step has no DeepSeek secret and makes no provider call;
- blocked downstream journeys remain blocked prerequisites rather than additional failures.

## Next gate

Do not run Connected AquaGuide Smoke #3 until this regression and the mixed-cause artifact sidecar are green in CI. After merge, the next paid smoke should keep the pinned AquaGuide commit, provider/model, screenshot policy, and max-step policy unchanged.
