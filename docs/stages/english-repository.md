# English repository content

## Scope and implementation plan

Translate all maintained repository documentation, including the README, into English. Translate existing PR descriptions while preserving their template, scope, evidence and pending hardware checks. Require English in future repository content, commit messages and PR titles/descriptions. Keep Unicode behavior tests meaningful using non-Chinese Unicode fixtures.

This documentation task is stacked on PR #3 (`fix/bluetooth-permission-host`) to translate the latest complete documentation without changing earlier implementation branches. No merges, history rewrites, visibility changes or npm publication are authorized by this task.

## Acceptance and validation

- E1: All tracked text files contain no Chinese text; prose, diagrams and examples are English. Preserve technical meaning, commands, links and historical validation evidence.
- E2: All existing PR titles and descriptions are English and retain the repository template and actual acceptance status.
- E3: AGENTS.md and CONTRIBUTING.md require English for future contributions. User-provided runtime data remains unrestricted.
- E4: Check documentation links and diffs, and run the complete `npm run check` gate because Unicode test fixtures change. CI must pass.
- E5: Submit this task as a separate PR. Keep hardware acceptance pending; do not interpret acknowledgment as a physical pass.

No test is added solely to detect language: editorial review and a tracked-file Unicode scan verify E1.
