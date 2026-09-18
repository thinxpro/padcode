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
