# R2: release workflow

Status: plan committed before implementation. Implements step R2 of the [public release plan](public-release.md). This stage adds the tooling only: it does not publish anything, change repository visibility, enable the workflow on npm, or create tags.

## Scope

Make a tagged commit publishable by GitHub Actions with npm trusted publishing, with checks that stop a wrong or partial release, while keeping local packaging unpublishable by default.

## Design

1. **`--release` packaging.** `scripts/package.mjs --release` writes both staged manifests without `private`. Without the flag the manifests keep `private: true` exactly as today. The root `package.json` stays `private: true`.
2. **Helper reuse across dist-tags.** The default reuse source changes from `padcode-darwin@latest` to the highest version among all `padcode-darwin` dist-tags, read with `npm view padcode-darwin dist-tags --json`. Versions are compared with Semantic Versioning precedence, including prerelease identifiers (`0.1.0-rc.10` > `0.1.0-rc.9`, `0.1.0` > `0.1.0-rc.10`). If the package is not published or the registry cannot be reached, packaging builds fresh helpers and prints the reason, as it does now for an unavailable package. `--reuse SPEC` and `--fresh` are unchanged. The registry is the one npm is configured with (`npm_config_registry` is respected), so tests use a local stub registry instead of a test-only switch.
3. **Shared release logic** in `scripts/release-lib.mjs` (pure functions, no I/O): `compareVersions`, `highestVersion(distTags)`, `distTagFor(version)` (`next` for a prerelease, `latest` otherwise) and `changelogEntry(text, version)`.
4. **Release check.** `node scripts/release-check.mjs --tag TAG --dir DIR [--notes FILE]` runs after packaging and before publishing. It fails with one clear line per problem when:
   - `TAG` is not `v` + the root `package.json` version;
   - either tarball (`padcode-<v>.tgz`, `padcode-darwin-<v>.tgz`) is missing in `DIR`;
   - a staged manifest has another version, is still `private`, or `padcode` does not pin `padcode-darwin` to exactly `<v>` as an optional dependency;
   - `CHANGELOG.md` has no `## [<v>]` entry;
   - `padcode@<v>` is already published.

   On success it prints the dist-tag and whether `padcode-darwin@<v>` is already published, writes both to `$GITHUB_OUTPUT` when set (`dist-tag`, `publish-darwin`), and writes the changelog entry to `--notes FILE`.
5. **Workflow** `.github/workflows/release.yml`, triggered only by pushed `v*` tags:
   - Job `build` on `macos-latest`: checkout, Node 22, tmux, `npm ci --ignore-scripts`, `npm run check`, `npm run package -- --release --out artifacts`, release check, `SHA256SUMS` over both tarballs, upload the tarballs, checksums and notes as a workflow artifact. Permissions: `contents: read`.
   - Job `publish` on `ubuntu-latest`, `needs: build`, environment `npm` (the maintainer configures required reviewers there). Permissions: `contents: write` (GitHub Release) and `id-token: write` (trusted publishing). It installs npm 11.5.1 or later, publishes `padcode-darwin` (skipped when the release check reported it already published) and then `padcode`, both with the computed dist-tag and no token secret, and creates the GitHub Release with the notes, both tarballs and `SHA256SUMS`, marked prerelease for `next`.
   - `concurrency: release` so two tags cannot publish at once.
6. **Recovery.** If `padcode-darwin` was published but `padcode` failed, re-running the workflow for the same tag is safe: reuse picks the published platform package (same sources and signer, so the helpers are byte-identical), the release check reports it as published, and only `padcode` is published.
7. **Documentation.** `docs/distribution.md` gets the release procedure (bump the version, move the changelog entry, tag, approve the `npm` environment) and the recovery note. The public release plan records R2 as implemented.

## Automated acceptance

- A1: `npm run check` passes locally with no skipped tests on macOS.
- A2: packaging without `--release` gives manifests with `private: true`; with `--release` neither manifest has `private`, both keep version, license, repository, homepage and bugs, and `padcode` pins `padcode-darwin` to the same version. `npm publish --dry-run` succeeds for both release tarballs against a local stub registry.
- A3: `highestVersion` and `compareVersions` follow SemVer precedence (numeric and alphanumeric prerelease identifiers, release over prerelease). Packaging with a stub registry whose `latest` points at an older, non-reusable package and `next` at a reusable one reuses the `next` helpers; with no published package it builds fresh and says why.
- A4: the release check fails with a specific message for: tag/version mismatch, missing tarball, version mismatch inside a manifest, a `private` manifest, a wrong `padcode-darwin` pin, a missing changelog entry, and `padcode@<v>` already published. It passes for a valid prerelease (`next`) and a valid stable version (`latest`), writes `$GITHUB_OUTPUT` and the notes file, and reports an already published `padcode-darwin@<v>` as `publish-darwin=false`.
- A5: a test reads `release.yml` and checks: triggered only by `v*` tags; build on macOS with `npm run check` before packaging; `id-token: write` only on the publish job; the publish job uses environment `npm`; `padcode-darwin` is published before `padcode`; npm is upgraded to 11.5.1 or later; no `NPM_TOKEN` or `NODE_AUTH_TOKEN`; `--tag` uses the computed dist-tag.
- A6: documentation links resolve; no Chinese text in tracked files.

Tests that need macOS packaging tools skip on Linux, like the existing package tests; the pure release logic and workflow tests run everywhere.

## Manual acceptance

None in this stage. The first real run of the workflow is part of R4 (first npm publish) and M1–M4 of the public release plan.

## Test matrix

| Criterion | Test |
| --- | --- |
| A2 | `test/package.test.mjs` (release manifests, dry-run publish) |
| A3 | `test/release.test.mjs` (version logic), `test/package.test.mjs` (stub registry reuse) |
| A4 | `test/release.test.mjs` (release check CLI against fixture tarballs and a stub registry) |
| A5 | `test/release.test.mjs` (workflow file) |
| A6 | link check and Unicode scan, recorded below |

## Validation evidence

Recorded with the implementation.
