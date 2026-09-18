# Contributing

Read the [development rules](AGENTS.md), README, architecture and roadmap before implementation. Prioritize P0. Use one PR per clearly scoped task, with multiple commits as needed. Commit the stage implementation plan, acceptance criteria and test matrix before writing code.

## Language

Use English for all maintained repository content: documentation, code comments, CLI messages, examples, commit messages, PR titles and descriptions, and project issue/review text. This prepares the project for public collaboration. Unicode support and user-provided runtime data remain unrestricted; use non-Chinese Unicode fixtures when testing encoding behavior.

## Scope

- Preserve the local CLI and user-provided agent boundaries.
- Explain each new dependency's purpose, distribution impact and platform limitations.
- Include tested versions and results when adding platform or agent support.
- Do not commit user configuration, credentials, project content, terminal recordings or real session logs.
- Update decisions when the design changes, distinguishing implemented, verified and planned behavior.

## Git and PRs

Initial documentation lives on `main`. Use short-lived branches and PRs targeting `main`; this repository does not use SensForge's `dev` convention. Suggested prefixes are `feature/`, `fix/` and `docs/`. For dependencies on unmerged work, follow the documented stacked PR exception in AGENTS.md.

Use the repository PR template. Describe the concrete change, user behavior, validation methods, results and limitations. All automated tests must pass. Explicitly identify unrun hardware tests and leave incomplete checks unchecked; keep hardware-dependent PRs draft. Do not merge without user authorization.

## Validation

For documentation changes, check links, examples and status claims. The full automated gate is `npm run check`: type checking, TypeScript/native builds, unit/subprocess/PTY/SDL virtual-device tests and coverage. Run `npm ci --ignore-scripts` first. Input routing, lifecycle and installation artifacts must meet their stage acceptance criteria; record physical hardware validation separately.
