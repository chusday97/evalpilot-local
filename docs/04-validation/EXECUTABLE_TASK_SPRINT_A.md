# Executable Task Completion — Sprint A

## Scope

Sprint A adds an execution-readiness layer between `EvalCase` selection and `AI Test Agent` execution.

The goal is deliberately narrow:

> A case with unresolved prerequisites must not be handed to the browser Agent and then mislabeled as an evaluator/product failure.

## Runtime before

```text
Eval Case
→ choose starting URL
→ launch Chromium
→ AI Test Agent
```

A task such as “edit an existing project” could start in an empty browser context without an existing project and fail only after the Agent spent actions trying to recover.

## Runtime after Sprint A

```text
Eval Case
→ Scenario Compiler
→ ExecutableScenario
→ Scenario Preflight
   ├─ ready → launch Chromium → AI Test Agent
   └─ blocked → persist blocker evidence → stop before Chromium
```

## Readiness states

- `ready`
- `needs_test_data`
- `needs_auth`
- `needs_setup`
- `needs_human_input`
- `unsupported`

Sprint A only classifies these states. It does not automatically resolve them yet.

## Persisted evidence

Every selected evaluation now writes:

```text
evaluations/<evaluationId>/scenario-preflight.json
```

The snapshot contains:

- selected scenario IDs and Case IDs
- starting URL
- readiness state
- prerequisite checks
- blocker category and source
- known-information keys
- ready and blocked Case lists

## Conservative execution rule

If any selected Scenario is not `ready`, the current Sprint A implementation stops the evaluation before `chromium.launch()` with `EVALUATION_SCENARIO_NOT_READY`.

This is intentionally conservative. Sprint B will resolve safe blockers through fixtures/setup rather than weakening the gate.

## Current deterministic classification

The compiler distinguishes common prerequisite families:

- login/auth state → `needs_auth`
- test/sample/seed data or files → `needs_test_data`
- existing objects/history/state → `needs_setup`
- unconfirmed business/manual requirements → `needs_human_input`
- stale Product Task / invalid starting URL → `unsupported`
- already-open/reachable page prerequisites → satisfied by project readiness

Unknown non-trivial prerequisites default to `needs_setup` rather than being silently ignored.

## Tests

`tests/executable-scenario.test.ts` covers:

1. simple page readiness
2. relative starting URL resolution
3. existing-object setup blockers
4. login blockers
5. test-file blockers
6. known-information-backed prerequisites
7. stale Product Task refusal
8. multi-case blocker summaries
9. source-level guard that Scenario Preflight occurs before Chromium launch

## Explicitly deferred to Sprint B

- automatic field/test-data Fixture generation
- HTML constraint-aware values
- auth/session fixtures
- setup Case dependencies
- browser storage state injection
- automatic resolution of `needs_setup`

## Definition of done for Sprint A

- non-ready Cases never reach the browser Agent
- blocker reason is persisted before execution
- ready Cases continue to use the Adaptive evaluation path
- existing browser/evaluator tests remain green
