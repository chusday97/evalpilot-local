# Evaluator Accuracy Sprint — Phase 1 Validation

## Coverage semantics

- Asset coverage: a non-retired Case exists for the capability-scoped cell.
- Execution coverage: at least one Case for the cell has a saved pass, fail, or inconclusive result.
- Verified coverage: a stable Case has a latest PASS result and its Evidence Packet passes the current Evidence Gate.
- The deprecated `coverageRatio` field is an alias of `verifiedCoverageRatio`.

Example Dashboard API response excerpt:

```json
{
  "assetCoverageRatio": 1,
  "executionCoverageRatio": 0,
  "verifiedCoverageRatio": 0,
  "coverageRatio": 0,
  "cells": [
    {
      "cellId": "cell-cap-demo-capability-cap-demo",
      "capabilityId": "cap-demo",
      "dimension": "capability",
      "value": "cap-demo",
      "assetStatus": "stable",
      "executionStatus": "not_run",
      "verified": false
    }
  ]
}
```

Legacy files keep their original asset ratio but load with execution and verified coverage set to zero. They are not rewritten.

## Validation

- `npm run check`: passed.
- `npm test`: 30 files passed, 3 skipped; 124 tests passed, 16 skipped.
- `npm run build`: passed.
- `npm run test:dashboard`: 6 passed, including desktop and 390px checks.
- `npm run audit:package`: passed; 220,343 bytes, 137 files, 0 sensitive matches.
