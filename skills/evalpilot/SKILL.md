---
name: evalpilot
description: Run evidence-first local pre-release and simulated-user UX evaluations for a Web product with EvalPilot Local. Use when asked to scan code/docs/Git and localhost, generate a background/blueprint/Persona/cases/journeys, run fixed or path-isolated exploratory Chromium tests, inspect UX friction and full-loop completion, open the local Dashboard, confirm issues, compare before/after runs, or produce a release-blocker report in Codex or Antigravity.
---

# EvalPilot Local

Use the shared EvalPilot CLI for every operation. Do not duplicate scanning, generation, grading, or report logic inside the Skill.

## Safety gates

- Keep EvalPilot independent from the target project; use the bundled wrapper so outputs stay in the EvalPilot project.
- Treat the target repository as read-only unless the user separately asks to fix a confirmed issue.
- Never read `.env` values or expose credentials. Put authentication state only in `.evalpilot/secrets/` or environment variables.
- Start or connect only to localhost/test URLs. Do not run fault injection against production.
- Report `failed` and `blocked` separately. Never claim a browser case passed without a real run Artifact.
- Add failures to regression only after explicit confirmation with `report --confirm-failures`.
- Never give an exploratory run standard steps, selectors, or the ideal path. Use `run --exploratory`; compare against the journey only after execution.
- Treat simulated-user metrics as engineering evidence, not real user satisfaction, retention, conversion, or market validation.
- Start Dashboard only on loopback. Do not expose or proxy it to a remote host.

## Workflow

1. Run `scripts/evalpilot.sh status` to inspect existing state. If not initialized, run `init --project <absolute-path> --url <http(s)-url>`.
2. Ensure the target URL is reachable. If it is stopped, inspect target `package.json` and start the documented local command without editing target files.
3. Run commands in dependency order: `scan` → `generate-background` → `generate-blueprint` → `generate-cases` → `run` or `run --exploratory` → `report`.
4. Before running cases, surface `needs_human_review` business constraints. Do not silently approve them.
5. For one fixed case, use `run --case <case-id>`. For one exploratory case, use `run --exploratory --case <case-id>`. For confirmed functional failures after a fix, use `run --regression`.
6. Read `LATEST_REPORT.md` for functional release gates and `LATEST_UX_REPORT.md` for user-goal/full-loop/UX evidence. Keep both conclusions separate.
7. Recheck the target Git status to prove EvalPilot did not modify the target.
8. For a non-technical review, start `dashboard`; confirm a UX issue in Report, rerun the same feature, then inspect the automatically generated before/after comparison. Fewer actions count as improvement only when closure and safety do not regress.

## Task routing

- “初始化当前项目”：`init`, then `status`.
- “连接 localhost 并扫描”：verify URL, then `scan`.
- “生成产品背景/评测蓝图”：run the prerequisite commands first, then the requested generator.
- “为新功能生成评测集”：refresh `scan/background/blueprint`, then `generate-cases`; review affected capability cases.
- “运行 P0/P1 上线测试”：run all automated cases, then filter the report by P0/P1 and blocked critical coverage.
- “根据 Git diff 回归”：inspect target diff read-only, select related confirmed regression cases, then `run --regression`.
- “分析失败并出报告”：run `report`; use `--confirm-failures` only when the user confirms those failures.
- “模拟一个不知道标准路径的新用户”：run `run --exploratory`; report action count, abandonment, four-layer completion, friction, evidence, and authenticity limits.
- “打开可视化工作台”：run `dashboard`; if 4173 is occupied, use `dashboard --port <free-port>` and return the loopback URL.
- “验证修复是否改善体验”：confirm the UX issue in Dashboard, rerun the same feature, and inspect the persisted comparison; flag lost safety steps or new issues as regression.

For exact command meanings and output locations, read [references/commands.md](references/commands.md).
