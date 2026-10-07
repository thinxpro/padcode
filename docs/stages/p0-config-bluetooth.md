# Bluetooth-first terminal onboarding

Status: implementation and automated validation complete; physical acceptance pending. This plan was committed before implementation (`37ce2c0`). User priority change: Bluetooth is now the primary connection flow; USB is optional. This stage moves onboarding ahead of PTY integration. Existing hardware criteria remain pending, with Bluetooth replacing USB as the primary physical acceptance path by explicit user instruction. See [validation evidence](p0-config-validation.md).

## Scope

Provide a genuine terminal configuration flow: `padcode` on first interactive launch → Bluetooth (default) or USB → discover/select/pair/connect → verify a controller button through SDL → choose installed/custom Agent → select key profile → review and save. `padcode config` edits it; subsequent startup shows saved settings and actions. Cancellation preserves the old file. Explicit deferral is allowed but never displayed as verified.

No Agent execution is added here: PTY is a separate task. Saving an Agent command means configuring it, not starting a development task. Registry publication and multi-platform prebuilt distribution remain separate release work; validate the installed CLI using a locally packed npm tarball without publishing it.

## Implementation

1. Game-console terminal prompts and progress/status feedback, keyboard driven, narrow width/NO_COLOR/TERM=dumb support. No browser or editor is required for configuration.
2. macOS native helper using IOBluetooth: status/paired list, bounded discovery, explicit selected-device pairing, connection, structured errors. Bundle/build it with the tool; no extra Homebrew Bluetooth utility required. Only query APIs and explicit user-selected pairing/connection; no arbitrary device disconnection or automatic radio changes.
3. System privacy authorization/radio-off recovery may require a macOS system dialog/settings. Show the exact limitation and retry/USB/defer choices in terminal; do not claim the tool can bypass OS permission. Numeric/PIN pairing modes must fail explicitly if unsupported; never auto-confirm an authentication challenge.
4. SDL probe confirms actual input separately from OS pairing. Expose wired/wireless/unknown and serial where available. Let the user choose the SDL device to test; do not silently attribute another controller's input to the selected one.
5. Versioned local JSON config, strict validation, atomic save with private file permissions. User-level path (XDG_CONFIG_HOME or ~/.config/padcode); no credentials, project autoexecution, or shell command concatenation. Discover candidate executables through PATH without executing them. Custom command and arguments entered separately.
6. A locally installable npm development tarball includes compiled CLI and current-platform helper binaries. Verify paths work outside the checkout; label it current-platform only and block mismatched platform use. No `npm publish` or visibility change.

## Fixed acceptance criteria

| ID | Criterion | Validation |
| --- | --- | --- |
| B1 | Interactive first run enters setup; --help stays side-effect free; non-TTY no-args gives help rather than hanging | CLI + PTY |
| B2 | Bluetooth is the default; discovery/selection/pair/connect and error feedback stay in terminal; USB/defer are explicit alternatives | wizard unit + PTY + physical |
| B3 | Native helpers build on macOS; non-macOS returns an explicit unsupported Bluetooth result; operations have bounded output/time and cancellation cleanup | build + native smoke + process integration |
| B4 | Paired/connected is not input-verified; only a fresh SDL press from the selected device passes; wrong transport/serial does not silently pass | probe tests + physical |
| B5 | Installed/custom Agent selection saves executable+args without running it; invalid paths can be retried; no bundled default Agent | wizard/config tests |
| B6 | Save/reload/edit/cancel/corrupt config have deterministic behavior; failed writes and cancellation preserve previous data | filesystem unit + PTY |
| B7 | Clean local npm tarball install provides working padcode/help/demo/setup entry points and helpers outside checkout; no global user install | isolated installation integration |
| B8 | Existing controller lab checks continue passing; complete npm run check green on macOS and Linux; no required test skips | local + CI |
| B9 | User completes PS4 Bluetooth flow and restarts with saved config; power-cycle/reconnect 3 times, background input and 10-minute run verified | physical checklist; draft until complete |

## Test plan

- Unit tests: schema errors, config atomicity/permissions, executable discovery, menu validation, Bluetooth result validation, timeouts/aborts, controller identity/input selection, wizard success/failure/retry/defer/cancel.
- Integration: native helper argument validation without touching hardware, child cleanup on abort/error, PTY onboarding and persisted second launch, installed-package smoke using temporary prefix/cache.
- Physical: actual macOS Bluetooth permission, discovery, pairing and connection are not automated in CI. No simulated result counts as B9.
- Gate: `npm ci --ignore-scripts` then `npm run check`. Add package smoke and wizard tests to the existing gate.

## PR dependency

`feature/bluetooth-onboarding` is stacked on unmerged `feature/controller-lab` (PR #1). PR targets that branch so only onboarding changes appear. Do not merge PR #1 implicitly. Retarget after dependency merge.

## References

- Apple SDK IOBluetoothDevicePair.h documents pairing without IOBluetoothUI panels; IOBluetoothDeviceInquiry provides device discovery.
- SDL 3.4.16 SDK: SDL_GetGamepadConnectionState and SDL_GetGamepadSerial. Missing metadata is not proof of Bluetooth identity.
