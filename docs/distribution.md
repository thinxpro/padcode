# Installation and distribution

## Current status

No npm registry package, Homebrew formula or curl installer has been published yet. `npm run package` builds the two npm packages locally: `padcode` (JavaScript only) and `padcode-darwin` (universal macOS helpers and the PTY runtime). Isolated installation from those tarballs, without build tools, and first-run setup are tested. The [public release plan](stages/public-release.md) covers publishing.

## npm first

The target is single-command CLI installation: `npm install -g padcode`. The names `padcode` and `padcode-darwin` were unclaimed on npm on 2026-10-08.

The main package carries the JavaScript CLI and depends on the exact matching `padcode-darwin` version as an optional dependency. The platform package declares `os: darwin` and `cpu: arm64, x64`, so npm skips it elsewhere and Padcode reports the platform as unsupported instead of compiling anything. Neither package runs install scripts.

### First release target

- macOS 13 or later on Apple silicon and Intel (universal helpers).
- DualShock 4 over Bluetooth first; USB as an alternative.
- Node.js 22.14 or later.
- No Xcode, CMake, C/C++ compiler or SDL development package on user machines.
- Unsupported platforms are reported explicitly instead of silently attempting source compilation.

## Compatibility

What has been checked on real hardware, as opposed to built or covered only by automated tests with virtual devices. The [stage records](stages/) hold the evidence.

| Area | Tested on hardware | Built, not tested on hardware | Not supported yet |
| --- | --- | --- | --- |
| OS / CPU | macOS 27, Apple silicon | macOS 13–26; Intel Macs | Linux, Windows (controller input, packages) |
| Controllers | DualShock 4 over Bluetooth and USB | DualSense, Xbox, Nintendo Switch Pro and other SDL gamepads (detected, with their own button names) | — |
| Agents | Claude Code; Codex profile | Any other interactive terminal CLI (basic profile) | Structured Agent adapters |
| Terminals | Warp and macOS Terminal | Other terminals (iTerm2, Ghostty, ...); plain mode without tmux | — |
| Voice | macOS on-device speech; whisper.cpp | Custom transcription commands | Voice on Linux or Windows |

Naming an Agent or terminal here is not a guarantee; report problems with the bug report template.

## Data handling

- **No telemetry and no accounts.** Padcode does not phone home, collect analytics or ask for credentials.
- **Network access** happens only in two places: the development build downloads SDL source from its official GitHub release with a pinned SHA-256, and voice setup downloads a whisper model from Hugging Face only after you confirm, verifying a pinned SHA-256. The packaged CLI makes no other network requests. Your Agent decides its own networking.
- **Session content is not recorded.** Padcode forwards controller input to the Agent's PTY and does not save terminal output or prompts. `PADCODE_INPUT_TRACE=1` prints routing metadata (no typed text) to the terminal only.
- **Voice** is opt-in. Audio clips are written to a private (`0700`) temporary directory, transcribed on your Mac and deleted afterwards; directories left by a crashed session are removed on the next start. Audio is never uploaded by Padcode. macOS speech runs with on-device recognition required.
- **Files Padcode writes:**

  | Path | Contents | Removed by uninstall |
  | --- | --- | --- |
  | `$XDG_CONFIG_HOME/padcode/config.json`, default `~/.config/padcode/config.json` | Controller identity, Agent command and arguments, voice settings | No; delete it to reset |
  | `$XDG_DATA_HOME/padcode/models/`, default `~/.local/share/padcode/models/` | Downloaded whisper models (only if you chose one) | No; delete it to free space |
  | `$TMPDIR/pc-*`, `$TMPDIR/pcv-*` | Per-session IPC socket and voice clips | Removed when the session ends |

- **macOS permissions** (Bluetooth, microphone, speech recognition) are requested by the helper that needs them, only when you use that feature.

## Uninstall

```sh
npm uninstall -g padcode
```

This removes the CLI and the platform package. Configuration and downloaded models stay; remove `~/.config/padcode` and `~/.local/share/padcode` to delete them. Padcode does not manage the Agent's own data directories. macOS permission entries can be removed in System Settings > Privacy & Security.

## Release procedure

Releases are published by the [release workflow](../.github/workflows/release.yml) with npm trusted publishing; nobody publishes from a laptop after the first version. See the [R2 stage](stages/release-workflow.md) for the checks.

1. On a PR: set the version in `package.json` (`0.1.0-rc.N` for a release candidate, `0.1.0` for stable) and move the `CHANGELOG.md` entries from `[Unreleased]` to a `## [<version>] - <date>` section. Merge it.
2. Tag the merge commit and push the tag: `git tag v<version> && git push origin v<version>`.
3. The `build` job runs `npm run check`, packages with `--release` (reusing the newest published helpers when native code is unchanged) and runs `scripts/release-check.mjs`. It stops if the tag and version differ, a manifest is wrong, the changelog entry is missing, or `padcode@<version>` already exists.
4. Approve the `publish` job in the `npm` environment. It publishes `padcode-darwin`, then `padcode`, under `next` for a prerelease or `latest` otherwise, and creates the GitHub Release with the changelog entry, both tarballs and `SHA256SUMS`.

**Recovery.** If `padcode-darwin` was published but `padcode` failed, re-run the workflow for the same tag. Packaging reuses the published helpers byte for byte, the release check reports `padcode-darwin` as already published, and only `padcode` is published. A published version can never be replaced; fix forward with a new version.

## Later installation channels

Homebrew should distribute validated versions and dependencies using the same CLI and configuration format. Offer a curl installer only after establishing versioned trusted downloads, checksums, architecture detection, upgrades and uninstall behavior. Specify whether Node is a prerequisite.

Installers only install the tool. They do not install agents, modify projects, collect credentials or enable desktop-control permissions. Native macOS binaries may require signing, notarization and quarantine handling; validate real downloaded artifacts rather than treating a successful local build as installation evidence.

## Public release checklist

The [public release stage](stages/public-release.md) completes this checklist.

- [x] Confirm project naming and package ownership: the name stays Padcode; `padcode` and `padcode-darwin` were unclaimed on npm.
- [x] Select the project license: MIT, without overriding third-party licenses.
- [ ] Review Git history, examples, screenshots and artifacts for personal information, credentials and private project content. Tracked files are reviewed and in English ([R1](stages/release-ready-content.md)); a full-history secret scan is part of going public (R3).
- [x] Verify licenses and notices for distributed SDL3, PTY and other dependencies ([third-party notices](../THIRD_PARTY_NOTICES.md)).
- [x] Provide working installation, upgrade, uninstall and troubleshooting instructions (README and above).
- [x] Publish a compatibility matrix and limitations, distinguishing supported from planned features (above).
- [ ] Validate installation and startup from the npm registry without developer build tools (M1 of the release plan).
- [x] Document logging, networking and data handling (above).
- [ ] Obtain an explicit maintainer decision to go public; repository creation does not authorize visibility changes or package publication.

GitHub repository visibility, GitHub Release visibility and npm package visibility are managed separately; do not assume they change together.
