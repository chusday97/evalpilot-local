# Evaluator Accuracy Sprint — Phase 5 Validation

## Scope

Phase 5 adds step-level Semantic Verifier, optional Semantic Reflector, explicit Persona Agent Policy, and bounded adaptive waiting. It does not start Product Task Understanding or the real evaluator benchmark.

## Decision rules

- Deterministic action failure wins.
- A semantic result below `0.8` confidence cannot independently confirm a step.
- Deterministic and reliable semantic disagreement becomes Inconclusive.
- A visual-only expectation cannot be confirmed when screenshot transfer was not authorized.
- Confirmed `finish`, explicit `abandon`, safety blocks, Persona patience, retry limits, and the fixed maximum action count cannot be overridden by Semantic Reflector.
- Waiting observes target text, route/DOM changes, form values, scroll movement, loading completion, and network idle; every wait is bounded.

## Browser acceptance

| Scenario | Observable result |
|---|---|
| Ordinary form | Field change, submit result, and finish are confirmed by deterministic and semantic evidence |
| Delayed loading | Screenshot and verification occur after the loading result appears |
| Streaming result | The runner waits for terminal `Completed` text instead of capturing an intermediate token |
| No visible feedback | Two failed attempts reach the explicit Persona patience bound and abandon without claiming success |
| Path recovery | Semantic Reflector recommends backtrack, the Actor returns to the prior page, and only confirmed finish ends the run |

## Commands

```bash
npm run check
npm run test:semantic-verifier
npm run test:ai-agent
npm run test:browser
npm run test:runner
npm run test:dashboard
npm test
npm run build
npm run audit:package
npm run test:public-example
npm run test:consumer
```

`test:semantic-verifier` reports 12 passing tests with all five Chromium scenarios executed. Standard CI uses Mock Provider and does not require a real OpenAI key.

## Known limits

- Mock responses isolate workflow correctness; they do not measure real-model precision or recall.
- Visual expectations use a conservative language detector. Phase 7 benchmark must quantify misses and false matches before reliability claims.
- The branch must be pushed before GitHub-hosted Actions can be considered verified.
- Independent Critic/Evaluator review was unavailable in this execution environment.
