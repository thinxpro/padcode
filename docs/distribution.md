# Installation and distribution

## Current status

No npm registry package, Homebrew formula or curl installer has been published. The development build can produce an npm tarball containing native helpers for the build platform; isolated installation and first-run setup are tested. This is not a public cross-platform release. Confirm package naming and ownership before publication.

## npm first

The target is single-command CLI installation. If `padcode` is unavailable, use an authorized npm scope or another name. A GitHub account name does not automatically grant npm scope ownership.

The main package carries the JavaScript CLI; platform artifacts provide the SDL3 helper and native PTY components. Platform-specific optionalDependencies are a candidate; finalize packaging after validating native dependencies.

### First release target

- Validate the actual development Mac architecture first and record OS/CPU versions.
- Prioritize DualShock 4 Bluetooth validation; retain USB as an alternative.
- Specify a compatible Node.js LTS requirement.
- Require no Xcode, CMake, C/C++ compiler or SDL development package on user machines.
- Report unsupported platforms explicitly instead of silently attempting source compilation.

## Later installation channels

Homebrew should distribute validated versions and dependencies using the same CLI and configuration format. Offer a curl installer only after establishing versioned trusted downloads, checksums, architecture detection, upgrades and uninstall behavior. Specify whether Node is a prerequisite.

Installers only install the tool. They do not install agents, modify projects, collect credentials or enable desktop-control permissions. Native macOS binaries may require signing, notarization and quarantine handling; validate real downloaded artifacts rather than treating a successful local build as installation evidence.

## Local data and uninstall

Document binary, configuration, cache and log locations. Uninstall preserves configuration by default; removal must be explicit. Padcode does not manage the agent's own data directories.

## Public release checklist

The [public release stage](stages/public-release.md) completes this checklist.

- [ ] Confirm project naming and package ownership; the maintainer already has an npm account.
- [x] Select the project license: MIT, without overriding third-party licenses.
- [ ] Review Git history, examples, screenshots and artifacts for personal information, credentials and private project content.
- [ ] Verify licenses and notices for distributed SDL3, PTY and other dependencies.
- [ ] Provide working installation, upgrade, uninstall and troubleshooting instructions.
- [ ] Publish a compatibility matrix and limitations, distinguishing supported from planned features.
- [ ] Validate installation and startup without developer build tools.
- [ ] Document logging, networking and data handling.
- [ ] Obtain an explicit maintainer decision to go public; repository creation does not authorize visibility changes or package publication.

GitHub repository visibility, GitHub Release visibility and npm package visibility are managed separately; do not assume they change together.
