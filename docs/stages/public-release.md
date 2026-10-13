# Public release: open source on GitHub and publish to npm

Status: plan approved by the maintainer on 2026-10-10. R1 is merged ([release-ready content](release-ready-content.md), PR #38). R2 is implemented in the [release workflow stage](release-workflow.md). R3 and R4 are maintainer steps and have not started; nothing is published.

## Request

The maintainer wants to prepare the first public release: open-source the repository on GitHub and publish Padcode to npm so that `npm install -g padcode` works on macOS without build tools. Homebrew and Developer ID signing come later.

## Decisions

Confirmed by the maintainer:

- The name stays **Padcode**. The npm names `padcode` and `padcode-darwin` were both unclaimed on 2026-10-08. The "provisional name" note is removed from the README.
- **No Apple Developer ID for now.** npm installs do not carry the quarantine attribute, so ad-hoc signed helpers run without notarization. The existing helper reuse ([prebuilt packages](prebuilt-packages.md#scope-change-reuse-unchanged-helpers)) keeps macOS permission grants across releases that do not change native code.
- Channels in this stage: GitHub (public repository and Releases) and npm. Homebrew (a personal tap that installs the npm package) and Developer ID notarization are separate later stages.
- **Email in history: accepted as public.** 36 commits on `main` (as of 2026-10-10) carry the author email `hello.thinkpro@gmail.com`. All of them are `Merge pull request #N` commits made in the GitHub web UI; every other commit uses the `noreply` address. History is not rewritten. Before going public the maintainer enables *Keep my email addresses private* so future web merges use the `noreply` address.
- **CI is re-enabled once the repository is public.** The `check.yml` workflow is currently disabled manually. Public repositories get free GitHub-hosted minutes, and npm trusted publishing requires GitHub Actions.
- **Versioning: rc first.** The first publish is a release candidate under the `next` dist-tag. `0.1.0` goes to `latest` only after the manual checks below pass.

## Findings

- The repository `thinxpro/padcode` is private. Repository, Release and npm package visibility are managed separately.
- The root `package.json` is `private: true`. `scripts/package.mjs` copies `private` into both staged manifests, so neither tarball can be published as is. The staged manifests already carry `repository` (needed for provenance).
- `scripts/package.mjs` reuses helpers from `padcode-darwin@latest`. If rc versions go to `next`, the `latest` tag either does not exist yet or points at an older version, so reuse would compare against the wrong package. (Resolved in R2: reuse now picks the highest version on any dist-tag.)
- npm trusted publishing (OIDC from GitHub Actions) needs npm CLI 11.5.1 or later, `id-token: write`, a GitHub-hosted runner and a public repository for provenance. It is configured per package on npmjs.com, which may require the package to exist first.
- README still calls Padcode a provisional name; the current version is `0.1.0-rc.10`.
- Missing public-project files: `SECURITY.md`, `CHANGELOG.md`, issue templates. `THIRD_PARTY_NOTICES.md` still lists "review which SDL component notices apply" as an open release task.
- `docs/distribution.md` has an unchecked public release checklist; this stage completes it.

## Design

Work is split into PRs, each targeting `main`. Steps marked **maintainer** are outward actions that only the maintainer performs or explicitly authorizes; no PR performs them.

### R1: release-ready repository content (PR)

1. README: current status, remove "provisional name", an install section for `npm install -g padcode` (with `@next` while in rc), upgrade (`npm install -g padcode@latest`), uninstall (`npm uninstall -g padcode`; configuration at `~/.config/padcode` is kept and removed only explicitly), a troubleshooting section, and a slot for a demo GIF supplied by the maintainer.
2. Compatibility matrix in `docs/distribution.md`: tested (macOS 27 arm64, DualShock 4 over Bluetooth and USB, Claude Code) versus built but untested (x86_64, macOS 13–26, other controller families) versus unsupported (Linux and Windows controllers).
3. Data handling section: no network access except the explicit SDL source download during development builds and the opt-in, checksum-verified whisper model download; no telemetry; no recording of session content; where configuration and logs live.
4. `SECURITY.md` (private vulnerability reporting through GitHub), `CHANGELOG.md` (Keep a Changelog format, one entry per published version, back-filled from the rc stages), `.github/ISSUE_TEMPLATE/` (bug report asking for `padcode --version`, macOS version, controller and Agent; feature request).
5. `THIRD_PARTY_NOTICES.md`: finish the SDL component review for the statically linked helpers and confirm node-pty's MIT notice is included.
6. `package.json`: add `homepage`, `bugs`, `keywords`, `author`; staged manifests inherit them.
7. CI workflow: rename to "Checks", drop the obsolete `feature/controller-lab` branch trigger.

### R2: release workflow (PR)

1. `scripts/package.mjs --release`: staged manifests omit `private`. Without the flag, behavior is unchanged, so local packaging still cannot be published by accident. The root `package.json` stays `private: true`.
2. Helper reuse looks up the highest published `padcode-darwin` version across all dist-tags instead of `@latest`. `--reuse` and `--fresh` keep working.
3. A release check (`scripts/release-check.mjs`) run before publishing:
   - the Git tag equals `v` + `package.json` version;
   - both staged manifests have that version and `padcode` depends on exactly that `padcode-darwin` version;
   - the dist-tag is `next` for prerelease versions and `latest` otherwise;
   - the version is not already published.
4. `.github/workflows/release.yml`, triggered by pushing a `v*` tag:
   - runs on `macos-latest` with Node 22 and npm upgraded to 11.5.1 or later;
   - runs `npm run check`, then `npm run package -- --release`, then the release check;
   - publishes `padcode-darwin` first, then `padcode`, with the computed dist-tag, using trusted publishing (no `NPM_TOKEN` secret);
   - creates a GitHub Release for the tag with the changelog entry, both tarballs and a `SHA256SUMS` file;
   - the publish job uses a GitHub environment `npm` that requires the maintainer's approval.
5. `docs/distribution.md`: a release procedure (bump version, update changelog, tag, approve) and how to recover from a half-finished publish (platform package published but main package failed).

### R3: going public (maintainer, after R1 merges)

1. Enable *Keep my email addresses private* in GitHub email settings.
2. Scan the full history with gitleaks (or trufflehog) and record the result here. Any finding blocks going public.
3. Set the repository description, topics and social preview; enable Discussions, Dependabot alerts and private vulnerability reporting; protect `main`.
4. Change the visibility to public. Re-enable the `Checks` workflow.

### R4: first npm publish (maintainer, after R2 merges and R3)

1. If npm requires the package to exist before configuring a trusted publisher: `npm login` with 2FA, then publish the two locally packaged rc tarballs (`--release`) under `next`, `padcode-darwin` first.
2. On npmjs.com, add the trusted publisher (`thinxpro/padcode`, workflow `release.yml`, environment `npm`) for both packages; require 2FA and disallow tokens for publishing.
3. Later versions are published only through the release workflow.

## Out of scope

Homebrew tap, Developer ID signing and notarization, curl installer, Linux and Windows packages, promotion and launch posts. Promotion is the maintainer's work outside the repository; the README demo is the only in-repository part.

## Automated acceptance

- A1: `npm run check` passes with no skipped tests, locally and in CI once re-enabled.
- A2: packaging without `--release` produces manifests with `private: true`; with `--release`, both manifests have no `private`, the same version, `repository`, `homepage`, `bugs` and `license`, and `padcode` pins `padcode-darwin` to the same version. `npm publish --dry-run` succeeds on both tarballs.
- A3: helper reuse picks the highest published version across dist-tags (tested with a stubbed registry lookup that has `latest` older than `next`, only `next`, and nothing published).
- A4: the release check fails with a clear message for a tag/version mismatch, a dependency version mismatch, a wrong dist-tag and an already-published version, and passes for a valid prerelease and a valid stable version.
- A5: the release workflow file is checked by a test for: trigger on `v*` tags only, `id-token: write`, the `npm` environment on the publish job, publish order (`padcode-darwin` before `padcode`), no `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret, and npm 11.5.1 or later.
- A6: documentation links resolve; no Chinese text in tracked files.

## Manual acceptance

Physical and registry checks; none of them may be reported from simulation.

- M1: after the first publish, on the maintainer's Mac with no repository checkout on `PATH`: `npm install -g padcode@next` installs both packages from the registry; `padcode --version` matches; a normal session with the DualShock 4 works (Hub, Agent session, sticks, controller map, L2 voice).
- M2: upgrading to the next published version that does not change native code reuses the helpers (same `cdhash`) and does not ask for microphone, speech or Bluetooth permission again.
- M3: `npm uninstall -g padcode` removes the CLI and the platform package and keeps `~/.config/padcode`.
- M4: the npm package pages show provenance for versions published by the workflow, and the GitHub Release contains both tarballs with matching `SHA256SUMS`.
- M5 (when hardware is available): an Intel Mac or macOS 13–15 machine installs from the registry and runs the session.

## Test matrix

| Area | Automated | Manual |
| --- | --- | --- |
| Manifests and `private` handling | A2 | — |
| Helper reuse across dist-tags | A3 | M2 |
| Release preconditions | A4 | — |
| Release workflow shape | A5 | M4 |
| Registry install, session, voice | — | M1, M5 |
| Upgrade keeps permissions | — | M2 |
| Uninstall keeps configuration | — | M3 |
| Documentation | A6 | review |

## Validation evidence

To be recorded per PR: plan commit, environment, `npm run check` result, CI run, history scan result, and each M-check with date and what the maintainer actually exercised.

### R3 history scan (2026-10-14)

Tool: gitleaks 8.30.1 with `--redact`.

**Scope:** 179 commits, covering:

- every remote branch;
- every pull request head;
- every local branch in the maintainer's checkout;
- a second pass over merge commits, which gitleaks skips by default.

The current tree was also scanned in `gitleaks dir` mode, and commit messages were checked separately.

**Result:** no secrets found. Going public is not blocked.

**Personal data:** gitleaks does not look for personal data, so a manual search covered local paths, email addresses, token prefixes, private keys, Bluetooth MAC addresses, serial numbers and host names:

- **Accepted, history only:** `/Users/kevinsmacmini/Project/padcode` was added to the README in `ba32d9c` and removed the same day in `62cd85e` (2026-09-18). It exposes the macOS user name. The current tree does not contain it, and history is not rewritten.
- **Accepted, already decided:** the maintainer's email in web-merge commit metadata (see Decisions).
- **Not sensitive:** the Apple team ID `P7WKBU5DDV` in [prebuilt packages](prebuilt-packages.md). Every binary signed with that certificate shows it anyway.
- **Placeholders only:** every MAC address in history is a placeholder (`aa:bb:cc:dd:ee:ff`, `00:11:22:33:44:55` and similar).
- **None found:** real device serial numbers or host names.

**Earlier CI failures:** 17 of the 74 earlier CI runs failed because the private repository's Actions billing limit stopped the jobs before they started, not because tests failed. Public repositories run on GitHub-hosted runners without charge.
