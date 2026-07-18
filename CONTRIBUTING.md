# Contributing

Thanks for helping improve EvalPilot Local.

1. Discuss large behavior or contract changes in an issue first.
2. Fork the repository and create a focused branch.
3. Run `npm ci`, `npm run check`, `npm test`, and `npm run build`.
4. For packaging changes, also run `npm run audit:package` and `npm run test:consumer`.
5. Open a pull request describing the user-visible outcome, tests, and known limits.

Do not commit `.evalpilot`, screenshots, Trace archives, worktrees, credentials, local paths, internal handoff documents, or private project fixtures. New UI actions must have loading, success, failure, and recovery feedback.
