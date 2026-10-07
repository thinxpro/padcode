# Development rules

- One clearly scoped task per branch and pull request targeting `main`. Multiple commits per PR are welcome. Do not push implementation directly to `main` or merge without user authorization.
- If a task depends on an unmerged PR, use an explicitly documented stacked PR targeting that prerequisite branch, then retarget to `main` after it merges. This keeps each PR's diff scoped; it is not permission to merge the prerequisite.
- Before writing implementation code, commit the stage's implementation plan, acceptance criteria and test matrix under `docs/stages/`.
- Implement against those criteria. Scope or criteria changes need an explicit documented reason, not silent relaxation after a failure.
- Include complete automated tests appropriate to the feature: unit, integration, failure paths and lifecycle. All applicable checks must pass before marking a PR ready.
- Hardware acceptance is separate from virtual-device tests. Ask the user for physical testing, record actual evidence, and keep hardware-dependent PRs draft until required hardware acceptance passes.
- Never report a pending, skipped or simulated hardware test as a real-device pass.
- CLI visuals should feel like a polished game console: strong hierarchy, purposeful color, controller-oriented vocabulary and responsive layouts. Preserve keyboard operation, monochrome output and narrow-terminal usability.
- Keep the product a local CLI with user-provided agents. No bundled account/model service, Electron app or automatic task execution.
- Update implementation status and reproducible validation evidence with each task. Keep secrets and real user session content out of fixtures and logs.

## Checks

The stage plan defines its exact commands and manual checklist. Once package scripts exist, `npm run check` is the complete local automated gate. CI must run the same applicable gate. PRs list the tested environment and any outstanding manual acceptance.
