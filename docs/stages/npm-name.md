# npm package name: padcode-cli

Status: merged (PR #43, retargeted to `main` after #42). N6 passed on 2026-10-14: `padcode-cli@0.1.0-rc.10` is published.

## Reason

On 2026-10-14, `padcode-darwin@0.1.0-rc.10` was published. Publishing the main package then failed:

```
403 Forbidden - PUT https://registry.npmjs.org/padcode - Package name too similar to existing package pacote
```

The maintainer chose the unscoped name `padcode-cli`. See the decision in the [public release plan](public-release.md#decisions).

## Scope

- The npm package name of the CLI changes from `padcode` to `padcode-cli`. This affects the root `package.json`, `package-lock.json`, the staged manifest, the tarball name `padcode-cli-<v>.tgz`, the release check, the release workflow and the user documentation.
- Unchanged:
  - the product name Padcode;
  - the `padcode` command (`bin`);
  - configuration and data paths;
  - the tmux session name;
  - the platform package `padcode-darwin`.
- The version stays `0.1.0-rc.10`: `padcode-cli@0.1.0-rc.10` has never been published, and it pins the published `padcode-darwin@0.1.0-rc.10`.
- The README demo GIF ends with the caption `npm install -g padcode@next`. The caption source changes here. Re-recording the GIF needs VHS and is a follow-up; until then the README text below the GIF gives the correct command.
- Historical stage records keep the names that were used at the time.

## Acceptance

- N1: packaging produces `padcode-cli-<v>.tgz` and `padcode-darwin-<v>.tgz`. The CLI manifest is named `padcode-cli`, has `bin.padcode`, and pins `padcode-darwin` exactly. An install from the tarballs provides the `padcode` command, and the installed-copy scenarios still pass.
- N2: the release check validates `padcode-cli` and `padcode-darwin` and refuses an already published `padcode-cli@<v>`.
- N3: the release workflow publishes `./artifacts/padcode-darwin-<v>.tgz` and then `./artifacts/padcode-cli-<v>.tgz`, and attaches both tarballs to the GitHub Release.
- N4: README, changelog and distribution documents use `npm install -g padcode-cli@next` / `npm uninstall -g padcode-cli`.
- N5: `npm run check` passes with no skipped tests; CI passes.
- N6 (registry): `padcode-cli@0.1.0-rc.10` is accepted by npm and installs together with `padcode-darwin@0.1.0-rc.10`. This is recorded after the maintainer publishes it.

## Validation evidence

Environment: macOS 27.0.1 arm64, Node 24.21.0, npm 11.19.0.

- N1, N2, N3, N5 (local): `npm run check` passed 213 tests with zero failures or skips. The run includes:
  - packaging under the new name;
  - the offline install from tarballs, with the `padcode` command from `padcode-cli` and the installed-copy scenarios;
  - the release-check cases;
  - the workflow test. A5 now also checks the GitHub Release attachments.

  CI is recorded on the PR.
- `npm run package -- --release` reused the helpers from the published `padcode-darwin@0.1.0-rc.10` byte for byte. Against the real registry, the release check reported: `Release 0.1.0-rc.10 is ready: npm dist-tag next; padcode-darwin@0.1.0-rc.10 is already published and will be skipped.`
- N4: README, changelog and distribution documents updated.
- N6 (2026-10-14): the maintainer published `artifacts/padcode-cli-0.1.0-rc.10.tgz`, packaged on `main` at `a1f175f`, with `--tag next`. npm accepted the name. The registry tarball has sha1 `6b515649829102fa496ad7a8ac82433eec155ec1`, the same as the local one. `npm install -g --prefix <empty dir> padcode-cli@next` installed `padcode-cli` and `padcode-darwin@0.1.0-rc.10`. `padcode --version` printed `0.1.0-rc.10`, `padcode --help` worked, and the three helpers passed `codesign -v` as universal `x86_64 arm64` binaries.
