# Bounded Bluetooth discovery

## Evidence and scope

The user cannot discover a flashing PS4 controller; dev.2 reports `Bluetooth discovery stopped before completion`. A local read-only scan reproduced the timeout in about 22 seconds. The implementation enables remote name updates, which Apple documents can exceed the inquiry length, and discards all discovered devices on timeout. This evidence does not yet establish that name updates are the sole cause on this Mac.

This task stacks on PR #4 (`docs/english-repository`). Keep all maintained content in English; no merges or device pairing are included in diagnosis.

## Implementation plan

- Separate bounded discovery from pairing/connection. Disable remote name updates; use cached names or an explicit unnamed-device label and address.
- Track inquiry-started, found-device, completion, aborted and error states. Use a monotonic deadline, stop/detach on every exit, preserve found devices on timeout with explicit partial-result metadata. Paired devices alone must not turn an empty timed-out inquiry into success.
- Return actionable errors distinguishing a scan that never started, an active timeout, cancellation, an OS abort and a native error. Never label partial results as a complete scan or verified controller input.
- Add native tests using a synthetic inquiry implementation exercising the production discovery routine without radio access, plus protocol/UI tests for partial results. Reproduce bounded real discovery without recording device identities.
- Bump the local development package to dev.3 and submit a separate Draft PR; request PS4 discovery/pair/input retest after automated checks.

## Acceptance matrix

| ID | Requirement | Validation |
| --- | --- | --- |
| D1 | No remote name requests; actual found devices survive a deadline with a partial-result warning | native synthetic inquiry + adapter + wizard |
| D2 | Success, empty completion, never-started/active timeout, native errors, OS abort and cancellation remain distinct; stop/detach always occur | native fault/lifecycle tests |
| D3 | No stale paired list is claimed as fresh discovery; missing names retain usable address labels; malformed metadata is rejected | native + protocol/UI tests |
| D4 | Complete automated gate and macOS/Ubuntu CI pass; local npm package installs | npm run check + CI |
| D5 | Actual PS4 discovery, explicit pairing and SDL fresh input pass in Warp | user physical acceptance; pending until observed |

References: [Apple inquiry length](https://developer.apple.com/documentation/iobluetooth/iobluetoothdeviceinquiry/inquirylength), [IOBluetoothDeviceInquiry](https://developer.apple.com/documentation/iobluetooth/iobluetoothdeviceinquiry).

## Evidence-driven plan amendment

The first instrumented scan with name updates disabled received a device-found callback, then completed with native error `1` after about 16 seconds. Therefore name updates are not the sole cause; an OS inquiry failure can also hide an already discovered device. Extend D1/D2 to preserve found results on native completion errors as well as deadlines, with `native-error` metadata and the numeric error displayed as a partial-result warning. Empty native-error results still fail. Explicit cancellation/OS abort still fail and never offer stale results. Do not claim the underlying macOS inquiry error itself is fixed.

## Implementation and local evidence

- Pre-implementation plan: `86a42b9`; evidence-driven amendment: `4ae534d`.
- Production discovery has a synthetic inquiry seam, monotonic deadline, disabled remote name updates, cached-name fallback, deduplication and explicit stop/delegate cleanup. Partial native-error and deadline results are surfaced separately from complete results.
- Real dev.2 scan reproduced the timeout in about 22 seconds. Instrumented development scans showed a device-found callback followed by error `1`, and variable initialization/scan timing. Two diagnostic runs hit the previous outer 25-second process limit. The scan process now allows 35 seconds total, including a 20-second inquiry; initialization can otherwise consume its small cleanup margin.
- A subsequent bounded real scan returned two discovered devices, including one controller-name candidate, with `complete:false` / `reason:deadline`. No pairing, connection or SDL input verification was performed. This confirms result retention on this Mac, not stable PS4 acceptance or a fix for Apple's underlying inquiry behavior.
- Phase-only diagnostics are opt-in through PADCODE_BLUETOOTH_DEBUG. Device names/addresses and process samples are not committed.
- Physical D5 and stability remain pending; keep the fix PR Draft.
- Final local `npm run check`: all 50 tests pass, zero failures/skips (macOS 27 arm64, Node 23.5.0). Native synthetic tests cover complete/empty results, delayed callbacks, fallback results, deduplication, missing names, partial errors, startup errors, unavailable inquiry, OS abort, pre-cancellation and active cancellation. Adapter and wizard tests verify metadata validation and partial-result wording; existing package installation and lifecycle tests remain green. JavaScript line coverage is 98.75%; native code is excluded from that metric.
- CI results are tracked on the fix PR. The development tarball version is 0.1.0-dev.3, for the current macOS arm64 build only; no registry publication.

## Subsequent user evidence

The user confirmed that the controller connects over Bluetooth with dev.3. This establishes a successful connection attempt; SDL button verification, repeated reconnection, background input and ten-minute stability are still pending. The requested controller-operated menu follow-up is tracked in [its own stage](gamepad-terminal-menus.md).
