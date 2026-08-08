# Evaluator Accuracy Sprint — Phase 6 Validation

## Scope

Phase 6 improves task-level Product Model and Oracle specificity. It does not start the real evaluator benchmark, add new product features, or claim real-model accuracy.

## Trust rules

- Product Understanding receives only bounded routes, visible headings/navigation/buttons/forms, document excerpts, Background, Blueprint, and existing unknowns.
- Source code, screenshots, Trace, secrets, and full page text are excluded from this request.
- Evidence references and routes must exist in the supplied catalog; invalid values are filtered and trigger human review.
- Oracle assertions must match a task success signal and use a supported deterministic assertion type.
- A task includes only its linked business rules. Inferred or unknown rules, signals, lifecycles, and journeys set `needsHumanReview=true`.
- Provider or Schema failure returns an explicit deterministic fallback with warnings.

## Fixture comparison

| Fixture | Legacy tasks | Understood tasks | Oracle improvement | Review boundary |
|---|---:|---:|---|---|
| Single form | 1 | 1 | `Created` and `Safe demo` become visible-text assertions | Invented route/outcome/assertion is filtered |
| Multi-page CRUD | 1 generic task | 3 tasks | View, create, and edit receive separate success signals and Oracles | No duplicate Case IDs inside the project |
| AI generation | 1 | 1 | Answer, sources, forbidden fabricated citation, and semantic relevance are separated | Inferred citation rule forces human review |

## Commands

```bash
npm run check
npm run test:product-understanding
npm test
npm run test:ai-agent
npm run test:semantic-verifier
npm run test:browser
npm run test:runner
npm run test:dashboard
npm run build
npm run audit:package
npm run test:public-example
npm run test:consumer
```

## Known limits

- Mock Provider verifies orchestration, schemas, filtering, persistence, and failure recovery; it does not measure real-model task-understanding quality.
- Real precision, recall, false-positive rate, and consistency remain Phase 7 work.
- The branch must be pushed before GitHub-hosted Actions can be considered verified.
- Independent Critic/Evaluator review was unavailable in this execution environment.
