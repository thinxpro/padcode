# R1: release-ready repository content

Status: implemented; automated acceptance passes. No hardware acceptance required. Implements step R1 of the [public release plan](public-release.md), plus a final English-only sweep requested by the maintainer on 2026-10-13 ("everything public should use plain English, with an open-source license that lets others download, modify and use the project").

This PR is stacked on PR #37 (`docs/public-release-plan`) because it implements that plan. It is retargeted to `main` after #37 merges. It does not change repository visibility, publish packages, rewrite history or merge anything.

## Audit (2026-10-13)

| Surface | Finding | Action |
| --- | --- | --- |
| Commit messages (all 164+ commits, all branches) | All English | None; history is not rewritten |
| Commit authors | 36 GitHub web merges use the maintainer's personal email | Already accepted as public in the release plan; maintainer enables *Keep my email addresses private* (R3) |
| PR titles | All English | None |
| PR descriptions | #32 quotes a Chinese maintainer report | Translate the quote |
| PR comments and reviews | No Chinese | None |
| Issues, Releases | None exist | None |
| Remote branch names | All ASCII English | None |
| Tracked docs | 12 stage records quote maintainer reports or example transcripts in Chinese | Replace with English translations, marked as translated |
| Tests and fixtures | Chinese strings used as wide/Unicode fixtures, against the AGENTS.md rule | Replace with Japanese kana, Korean, emoji and accented Latin; keep the same width and multi-byte coverage |
| License | MIT `LICENSE`, `license` in `package.json` | Keep; mention in README and staged manifests |
| `CONTRIBUTING.md` | Refers to an unrelated private project ("SensForge") | Remove |
| Public-project files | No `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, issue templates | Add |
| `README.md` | Stale version (rc.8), "provisional name", no install/upgrade/uninstall/troubleshooting | Rewrite those sections |
| `docs/distribution.md` | No compatibility matrix or data-handling section; checklist outdated | Add both; update checklist |
| `THIRD_PARTY_NOTICES.md` | SDL component review open | Complete the review for the macOS helpers |
| `package.json` | No `homepage`, `bugs`, `keywords`, `author` | Add; staged manifests inherit them |
| CI workflow | Named "Controller lab checks", obsolete `feature/controller-lab` trigger | Rename to "Checks"; drop the trigger |
| Secrets / personal paths | Scan of tracked files found none | Full-history scan with gitleaks stays an R3 maintainer step |

## Acceptance

- L1: No Chinese (Han) characters in any tracked file. Unicode coverage remains: wide characters (display width 2), multi-byte UTF-8, emoji and combining-free accented Latin are still exercised by the same tests.
- L2: PR #32's description is English with its template, evidence and pending checks unchanged.
- L3: README has current status, install (`npm install -g padcode@next` during rc), upgrade, uninstall (configuration kept), troubleshooting, a demo slot and the license.
- L4: `docs/distribution.md` has a compatibility matrix (tested / built but untested / unsupported) and a data-handling section (network access, telemetry, session content, configuration and log locations).
- L5: `SECURITY.md`, `CHANGELOG.md` (Keep a Changelog), `CODE_OF_CONDUCT.md` and `.github/ISSUE_TEMPLATE/` (bug report, feature request, config) exist and are English.
- L6: `THIRD_PARTY_NOTICES.md` names the SDL component notices that apply to the shipped helpers and confirms node-pty's notice.
- L7: `package.json` has `homepage`, `bugs`, `keywords`, `author`; `npm run package` copies them into both staged manifests (covered by `test/package.test.mjs`).
- L8: The CI workflow is named "Checks" and triggers on pushes to `main` and on pull requests.
- L9: `npm run check` passes with no failures or skips; relative Markdown links resolve.

## Test matrix

| Area | Automated | Manual |
| --- | --- | --- |
| Unicode fixtures (width, UTF-8 split, insertion, transcript) | existing unit and PTY suites (L1, L9) | — |
| Staged manifest metadata | `test/package.test.mjs` (L7) | — |
| Language scan | `git grep -P '[\x{3400}-\x{4DBF}\x{4E00}-\x{9FFF}]'` is empty (L1) | editorial review |
| Links | link check script (L9) | — |
| GitHub PR text | — | `gh pr view 32` (L2) |

No hardware acceptance is required: no runtime behavior changes.

## Validation evidence

- Plan committed before changes: `ccb1b91`.
- L1: `git grep -P '[\x{3400}-\x{4DBF}\x{4E00}-\x{9FFF}]'` over tracked files is empty. Fixtures use Korean, kana, emoji and accented Latin; the voice-insert sentence stays 21 code points so the undo count (21 Backspaces) is unchanged.
- L2: PR #32 description edited on 2026-10-13; all 37 PR titles and descriptions and all PR comments and reviews contain no Chinese text. No issues or Releases exist. All commit messages on all branches are English.
- L6: SDL review done against the compiled objects of `padcode-controller` (223 SDL objects). Notices added for HIDAPI (BSD), Sun libm, yuv2rgb (BSD-3) and qsort (zlib, Gareth McCaughan); dlmalloc and `SDL_strtokr.c` are CC0; `imKStoUCS.c` is empty on macOS.
- L7: `test/package.test.mjs` asserts `license`, `author`, `homepage`, `bugs`, `repository` (and `keywords` for `padcode`) in both staged manifests.
- L9: `npm run check` on macOS 27.0.1 arm64, Node 24.21.0: 206 tests, 206 pass, 0 fail, 0 skipped. Relative Markdown links and anchors resolve (script check over all tracked Markdown).
- Not done here (maintainer, R3): enable *Keep my email addresses private*, full-history secret scan, repository settings and visibility. A local-only branch with a non-English name exists in the maintainer's checkout; it was never pushed.
