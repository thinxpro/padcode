# Prebuilt packages: install on macOS without build tools

Status: implemented in 0.1.0-rc.9; automated acceptance passes locally; M1 passed (user-reported); M2 pending; M3 needs hardware not available. This plan was committed before implementation.

## Request

People installing Padcode should not need Xcode, CMake or a compiler. The maintainer chose to keep the native helpers (gamepad, Bluetooth, microphone and speech, PTY) and ship them prebuilt in npm packages. Decisions:

- Platform package name: `padcode-darwin`.
- Signing: the packaging script signs optionally. Ad-hoc by default, an Apple Development identity now, Developer ID later, with no code change.
- Platforms this round: macOS only. Linux packages, Homebrew, Developer ID notarization and publishing are later stages.

## Findings

- The helpers are built only for the build machine (arm64) with the SDK's deployment target, so `minos` is 27.0. They would not start on older macOS versions or on Intel Macs.
- node-pty 1.1.0 ships darwin-arm64 (minos 11.0) and darwin-x64 (minimum 10.7) prebuilds. The development bundle copies only the host one.
- The current local tarball puts helpers inside the main package and can only be built for one CPU.
- Helper sources already guard newer APIs with `@available`. The only checks are macOS 13 (`addsPunctuation`) and macOS 27 (a tap API with a fallback).
- Rosetta is not installed on the maintainer's Mac, so x86_64 slices can be checked here only for structure (architecture, deployment target, signature), not run.
- Hardened runtime, needed for Developer ID notarization, blocks the microphone and Bluetooth unless the helpers carry the `com.apple.security.device.audio-input` and `com.apple.security.device.bluetooth` entitlements.

## Design

1. **Universal helpers for macOS 13+.** On macOS, `native/CMakeLists.txt` defaults to `CMAKE_OSX_DEPLOYMENT_TARGET=13.0` and `CMAKE_OSX_ARCHITECTURES=arm64;x86_64`. This includes the static SDL build. Linux is unchanged. `build/native/platform.json` lists every architecture it contains: `{"platform":"darwin","arch":["arm64","x64"]}`. The runtime accepts a list or a single string.
2. **Two packages.**
   - `padcode` (JavaScript only): contains `dist/`, `LICENSE`, `THIRD_PARTY_NOTICES.md` and `README.md`. It declares `optionalDependencies: {"padcode-darwin": "<same version>"}` and no install scripts.
   - `padcode-darwin`: contains `os: ["darwin"]` and `cpu: ["arm64", "x64"]`. It holds `bin/padcode-controller`, `bin/padcode-bluetooth`, `bin/padcode-audio`, `pty/` (node-pty lib and both darwin prebuilds), `platform.json` (`platform`, `arch` list, `minos`, `version`), the license and the notices, and also has no install scripts.

   Both stay `private: true` until a publish stage. That prevents an accidental `npm publish`, while `npm pack` and tarball installs still work.
3. **Runtime resolution.** A `runtime.ts` module finds helpers and the PTY runtime:
   - a development checkout (`build/native`, `build/pty`) first;
   - then the installed `padcode-darwin` package, found through Node module resolution from the main package.
   - If neither is found, it shows a short message: the macOS helpers package is missing, reinstall Padcode, and only macOS is packaged so far.
   - If the platform or CPU does not match, it shows the existing friendly message.
   - If the platform package's version differs from the CLI's, it says so and asks for a reinstall.

   There is no stack trace in any case. `--help` and `config` printing keep working without helpers.
4. **Packaging script.** `npm run package` runs `scripts/package.mjs`:
   - It requires macOS and a completed `build`, `build:native` (universal) and the node-pty dependency.
   - It stages both packages under `build/release/`.
   - It signs each helper with its stable identifier (`com.thinxpro.padcode.controller`, `.bluetooth`, `.audio`):
     - Ad-hoc by default.
     - When `PADCODE_SIGN_IDENTITY` is set, it uses that identity with hardened runtime, the entitlements above and a secure timestamp. `PADCODE_SIGN_TIMESTAMP=off` allows offline Apple Development builds.
   - It verifies every helper:
     - both architectures are present;
     - the minimum OS is at most 13.0 for every slice;
     - `codesign --verify --strict` passes;
     - the identifier is correct.
   - It runs `npm pack` for both packages into `artifacts/` (or `--out DIR`) and prints the two tarball names plus the install command.
   - It never publishes.
5. **Local install command.**

   ```sh
   npm install -g ./artifacts/padcode-darwin-<v>.tgz ./artifacts/padcode-<v>.tgz
   ```

   After publishing this becomes `npm install -g padcode`, and npm picks `padcode-darwin` automatically on macOS.
6. **Documentation.** README install section, the setup guide and contributing notes describe user versus developer requirements. Third-party notices are updated for the bundled node-pty and SDL in the platform package.

## Scope change: reuse unchanged helpers

Added after the first implementation, at the maintainer's request. Releases are expected without a paid Developer ID at first. macOS ties ad-hoc permission grants (microphone, speech recognition, Bluetooth) to the exact helper binary, and rebuilds are not bit-identical, so every release would make users grant permissions again. Reuse limits that to releases that change the native code.

- `platform.json` records `native: { source, signer, since }`:
  - `source` is a SHA-256 over every file in `native/` (sources, CMake settings with the SDL pin and targets, plists, entitlements) and `scripts/build-native.mjs`;
  - `signer` is `adhoc` or the certificate's team ID, read from the signature;
  - `since` is the version the binaries were first built for.
- `npm run package` looks for a previous platform package. By default this is `padcode-darwin@latest` from npm; `--reuse SPEC` takes a tarball path or another npm spec, and `--fresh` skips the lookup. Its helpers are copied byte for byte, keeping their original signature, only when all of these hold:
  - the source hash matches;
  - the signer matches the current identity (for certificates, the team comes from the keychain certificate's OU, not from the name);
  - every helper passes the full verification (architectures, minos, strict signature, identifier, signer).
- Otherwise the helpers are built and signed fresh, and the script prints the reason (package not available, native sources changed, other signer, failed verification). A failed lookup never fails packaging.

- P6: packaging twice reuses the helpers byte for byte and keeps `native`. A previous package with changed sources, another signer, a damaged helper, or a missing tarball each leads to freshly signed helpers that pass strict verification, with the reason printed.

## Automated acceptance

- P1: the native build produces universal helpers with deployment target 13.0. `lipo` and `vtool` checks run on every helper slice, and the existing native tests still pass.
- P2: `runtime.ts` resolution is covered for each case:
  - the development directory wins;
  - the platform package is used when there is no development build;
  - a missing package gives the friendly message;
  - a platform/CPU mismatch is reported;
  - a version mismatch is reported;
  - list and string `arch` values both work;
  - none of these print a stack trace.
- P3: `scripts/package.mjs` produces two tarballs:
  - `padcode` has no `build/`, binaries or install scripts, and declares the exact optional dependency.
  - `padcode-darwin` has the three helpers, both node-pty prebuilds, `platform.json`, `os`/`cpu`, no install scripts and no test or config files.
  - Ad-hoc signing applies the stable identifiers and passes strict verification.
  - An invalid `PADCODE_SIGN_IDENTITY` fails with a clear message and leaves no tarballs.
- P4: the two tarballs install offline into a temporary prefix with `--ignore-scripts`, on a `PATH` without `cmake`, `cc`, `clang` or `xcrun`. Then:
  - `padcode --help` works;
  - the helper virtual test reports the PlayStation family;
  - onboarding, Agent PTY and gamepad Agent PTY scenarios pass from the installed copy;
  - the Bluetooth and audio diagnostics report their own TCC identity and usage strings;
  - installing `padcode` alone (`--omit=optional`) gives the friendly missing-helpers message;
  - a corrupted `platform.json` gives the mismatch message.
- P5: `npm run check` includes packaging and passes locally with no skipped tests. CI is disabled by the maintainer's decision.

Not covered automatically here: running the x86_64 slices (no Intel Mac or Rosetta available), macOS 13–26 (no such machine available) and Apple Development signing (needs the maintainer's keychain; run manually).

## Manual acceptance

- M1: the maintainer installs the two tarballs globally with Node 23.5 and runs a normal session with the DualShock 4: Hub, Agent session, sticks, map and voice (L2 dictation).
- M2: with `PADCODE_SIGN_IDENTITY="Apple Development: …"`, packaging signs and verifies the helpers. After installing, microphone permission is requested once and survives reinstalling a rebuilt package signed with the same identity.
- M3 (when hardware is available): an Intel Mac or macOS 13–15 machine runs the installed package.

## Implementation notes

- `native/CMakeLists.txt` sets the deployment target and architectures before `project()`, so the static SDL build inherits them. The helpers compile cleanly with `-Werror` at macOS 13. A universal clean build takes about 50 seconds on the M4 Pro.
- `src/runtime.ts` replaces the two separate lookups in `process.ts` and `agent-session.ts`. The platform package is found with `require.resolve('padcode-darwin/platform.json')` from the CLI, which works for global and local installs.
- `scripts/pty-bundle.mjs` is shared by the development PTY bundle (host CPU) and the platform package (both macOS prebuilds, taken unchanged from node-pty).
- npm accepts the main tarball alone even when the optional `padcode-darwin` cannot be fetched (offline, unpublished). The CLI then prints the missing-helpers message.
- With `PADCODE_SIGN_IDENTITY` the helpers get hardened runtime. A trial signing of `padcode-audio` with the maintainer's Apple Development identity (team `P7WKBU5DDV`, no timestamp) produced flags `runtime`, the audio-input entitlement and identifier `com.thinxpro.padcode.audio`. `padcode-audio diagnose` then still reported `selfResponsible: true`. Microphone capture under hardened runtime is part of M2.
- Files in the platform package keep upstream node-pty signatures (ad-hoc). Only Padcode's helpers are re-signed.

## Validation record

Plan commit: `31c27ac`. Environment: macOS 27.0.1, M4 Pro arm64, Xcode 27.0, CMake 4.0.3, Node 24.21, npm 11.19. `npm run check` passed 155 tests with zero failures or skips (154 before the reuse scope change). CI is disabled by the maintainer's decision, so Linux was not exercised.

- P1: all three helpers contain `arm64` and `x86_64` slices, each with `minos 13.0`.
- P2: runtime resolution covers every case in the criteria.
- P3: package contents and manifests are checked. Ad-hoc signing applies the `com.thinxpro.padcode.*` identifiers and passes `codesign --verify --strict`. A missing identity fails and leaves the output directory empty.
- P4: the install runs offline with install scripts enabled. `PATH` contains only `node` and `/bin`, and the test asserts that `cmake`, `cc`, `clang`, `xcrun`, `make` and `python3` are unreachable. From the installed copy, `--help`, `--version`, the virtual helper, both diagnostics, and the onboarding, Agent PTY and gamepad Agent PTY scenarios pass. The mismatch and missing-package messages print no stack trace.
- P6 (added with the scope change): passes. A manual run with the Apple Development identity rebuilt helpers when the previous package was ad-hoc ("was signed by adhoc, now P7WKBU5DDV"). A second run reused the signed helpers ("reused P7WKBU5DDV signature").
- Not run: x86_64 slices (no Rosetta or Intel Mac), macOS 13–26, a full Apple Development signed package (only the trial signing in the notes above).

## Physical acceptance record

- M1, user-reported on 2026-10-08: the maintainer installed the two local rc.9 tarballs globally and reported that testing passed with the DualShock 4 ("测试没问题"). The exact scenarios exercised were not itemised in the report.
- M2: not yet run. Optional, before relying on certificate signing.
- M3: not run (no Intel Mac, no macOS 13–15 machine).
