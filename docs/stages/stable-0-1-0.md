# Stable release 0.1.0

Status: implemented; S1–S4 pass locally. The release steps, S5, M2 and M4 wait for merge and the tag. Plan committed before implementation: `dd680de`. Follows R4 of the [public release plan](public-release.md).

## Reason

`0.1.0-rc.10` is on npm under `next`. The maintainer reported M1 (registry install and DualShock 4 session) and M3 (uninstall keeps configuration) as passed on 2026-10-14. The maintainer approved preparing `0.1.0` on 2026-10-14. `0.1.0` is published under `latest`, so `npm install -g padcode-cli` works without `@next`.

This is also the first release published by the [release workflow](release-workflow.md). It is how the remaining checks are done:

- M2: an upgrade from `0.1.0-rc.10` keeps macOS permissions;
- M4: the npm pages show provenance.

## Scope

- The version becomes `0.1.0` in `package.json` and `package-lock.json`. Native code does not change, so the workflow reuses the helpers from `padcode-darwin@0.1.0-rc.10`.
- `CHANGELOG.md`:
  - a `## [0.1.0]` entry stating that it is the first stable release and listing the changes since `0.1.0-rc.10`;
  - the link references are updated.
- The user documentation installs and upgrades with `npm install -g padcode-cli`.
  - README: install, upgrade, troubleshooting, local packages, and the status line, which still says "not yet published".
  - `SECURITY.md`: supported versions.
  - The demo caption.
- The `padcode --help` footer "Release candidate / private build." is removed; the version line already shows the build. The help snapshots are updated.
- The demo GIF is re-recorded with VHS, so its final caption shows `npm install -g padcode-cli`. This was a follow-up from the [npm name stage](npm-name.md).
- Unchanged: the release workflow, packaging, release check, the CLI behavior and the configuration format.

## Release steps (after merge, maintainer authorization)

1. Tag the merge commit `v0.1.0` and push the tag. The release workflow builds, checks and waits for approval in the `npm` environment.
2. The maintainer approves the `publish` job. It publishes `padcode-darwin@0.1.0` and `padcode-cli@0.1.0` under `latest` with provenance and creates the GitHub Release.
3. Optional maintainer cleanup, run locally and recorded with the evidence:
   - `npm dist-tag add <pkg>@0.1.0 next` for both packages, so `@next` does not install an older version;
   - `npm deprecate <pkg>@0.0.0-stage` for the placeholder versions npm created.

## Acceptance

- S1: `npm run check` passes locally and in CI. The help snapshots show `v0.1.0` and no release candidate footer.
- S2: `npm run package -- --release` reuses `padcode-darwin@0.1.0-rc.10` helpers, and `node scripts/release-check.mjs --tag v0.1.0 --dir artifacts` reports dist-tag `latest` with both packages to publish.
- S3: no maintained user document tells users to install with `@next`, except as the release candidate channel. No Chinese text is added, and relative links resolve.
- S4: the re-recorded `docs/media/demo.gif` ends with `npm install -g padcode-cli`.
- S5 (registry, after the release steps): the workflow run succeeds. On both packages, `latest` is `0.1.0`, and `npm view` shows provenance attestations. The GitHub Release has both tarballs, and `SHA256SUMS` matches the registry tarballs.
- M2 (maintainer, hardware): upgrading from `0.1.0-rc.10` with `npm install -g padcode-cli` keeps the helpers' `cdhash`. A session with L2 voice and the controller does not ask again for microphone, speech or Bluetooth permission.
- M4 (maintainer): the npm package pages show provenance for `0.1.0`.

## Test matrix

| Criterion | Check |
| --- | --- |
| S1 | `npm run check`, CI |
| S2 | local `--release` packaging and release check, recorded below |
| S3 | `git grep` for `@next` and Chinese text, link check |
| S4 | the final frame of the GIF, recorded below |
| S5 | workflow run, `npm view`, `shasum` |
| M2, M4 | maintainer report |

## Validation evidence

Environment: macOS 27.0.1 arm64 (M4 Pro), Node 24.21.0, npm 11.19.0, VHS from Homebrew.

- S1:
  - `npm run check` passed 213 tests with zero failures or skips. CI is recorded on the PR.
  - The help snapshots were rewritten with `UPDATE_SNAPSHOTS=1`. They now show `v0.1.0` and end after the ENVIRONMENT section.
- S2: `npm run package -- --release --out artifacts` printed `Helpers: reused unchanged from padcode-darwin@0.1.0-rc.10`. The release check printed `Release 0.1.0 is ready: npm dist-tag latest; padcode-darwin@0.1.0 will be published.` The local tarballs are only evidence; the workflow builds the published ones.
- S3: `git grep @next` outside stage records and the changelog leaves only the README upgrade line for release candidates. Changed files contain no Chinese text, and relative links resolve.
- S4: `npm run demo:record` rewrote `docs/media/demo.gif` and `demo.mp4`. The last frame shows `DEMO COMPLETE / npm install -g padcode-cli`.
