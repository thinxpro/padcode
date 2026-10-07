# Bluetooth permission ownership fix

## Evidence and scope

The first physical attempt in Warp on macOS 27 aborted before pairing. The crash report identifies TCC and a missing NSBluetoothAlwaysUsageDescription; the helper already embeds that key, but Warp (the responsible process) does not. No device information or crash identifiers are committed. This is a failed hardware acceptance, not a passing Bluetooth test.

Branch `fix/bluetooth-permission-host` stacks on PR #2 (`feature/bluetooth-onboarding`). Do not merge either dependency implicitly.

## Implementation plan (before code)

- Give the standalone Bluetooth executable its own permission identity at launch, preserving the npm/terminal distribution and ordinary macOS consent. Investigate macOS responsibility spawn attributes, resolved at runtime because these are not public SDK APIs. No permission bypass, terminal modification, TCC reset or privileged daemon.
- Prefer an in-place spawn/exec handoff so PID, pipes, deadlines and cancellation stay unchanged. Validate ownership after handoff before accessing Bluetooth. If the OS cannot supply this facility, return an actionable structured error instead of risking the privacy abort.
- Add a no-radio diagnostic that exercises the real launch/ownership path and checks the embedded usage description. Run it on both built and npm-installed binaries. Keep permission denial, powered-off and pairing feedback explicit.
- Bump the development tarball version; document unsupported API compatibility risk and remaining real Warp/PS4 acceptance.

## Acceptance and test matrix

| ID | Requirement | Evidence |
| --- | --- | --- |
| F1 | Helper establishes self-owned permission identity with its embedded usage description before Bluetooth access | native no-radio diagnostic, direct and through Node and installed package |
| F2 | Missing launch facility/metadata/invalid internal invocation fails without touching radio; no recursive spawn | native fault-path tests |
| F3 | Cancellation/timeout behavior and CLI recovery remain correct; malformed commands never touch radio | existing process/native/PTY tests, diagnostic PID check |
| F4 | All applicable tests and macOS/Linux CI pass; local npm install contains corrected binaries | npm run check, CI, installed-package integration |
| F5 | Warp can progress past status with system permission, then discover/connect/check PS4 input | user physical test, pending and Draft until passed |

The no-radio diagnostic is not proof of TCC consent or controller pairing. Any change in the proposed launch mechanism needs an explicit plan amendment before implementation.

## Validation evidence

- Plan commit: `8de70a3`; implementation followed this gate.
- Local macOS 27 arm64, Node 23.5.0: `npm run check` passes all 47 tests, zero failures/skips. JS line coverage 98.72%; native code is checked by compiled integration/fault-injection tests, not included in that coverage metric.
- Real built and isolated npm-installed helper: `diagnose-permission` passes without radio access; Node child PID equals diagnostic PID after the in-place launch.
- Separate native harness checks missing metadata, missing runtime symbols, retained foreign owner, disclaim failure, spawn failure and accepted self-owner. Fault injection is only in the test executable.
- Actual unsandboxed `status` on this Mac returned `ok:true`, `powered:true` with a device list after the ordinary consent flow. No scan/pair/connect operation was performed by this check; no device identities are recorded here.
- Initial full run caught the old hardcoded CLI version assertion after bumping dev.1 → dev.2; the assertion now checks the package version. The complete gate was rerun and passed.
- CI tracked on the fix PR. Warp install/retry and PS4 pairing/input/stability remain pending; keep the PR Draft.

## Compatibility rationale

The embedded Info.plist was present in dev.1. The missing piece was process responsibility. The fix uses runtime-resolved `responsibility_spawnattrs_setdisclaim` with `POSIX_SPAWN_SETEXEC`, then verifies `responsibility_get_pid_responsible_for_pid(getpid()) == getpid()` before any Bluetooth API. One marker bounds the handoff; validation cannot silently loop. It does not grant permission, change the host app or bypass macOS consent. These responsibility APIs are private SPI, so future OS compatibility is a material limitation; missing APIs or failed ownership checks return an error before radio access.

References: [Apple Bluetooth usage description](https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription), [Chromium responsibility/metadata check](https://chromium.googlesource.com/chromium/src/+/refs/tags/134.0.6998.28/base/process/process_info_mac.mm), [Ghostty discussion of terminal responsibility](https://github.com/ghostty-org/ghostty/issues/9263).
