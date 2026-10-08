# Fix: Bluetooth permission reported as "off or unavailable"

Status: planned. This plan, its acceptance criteria and test matrix are committed before implementation.

Independent of the UI overhaul stack (PRs #25-#27); branched from `main`.

## Evidence

On 2026-10-08 the maintainer ran `padcode config` from a development build (the `ui` worktree) and chose Bluetooth. Setup showed `LINK NOT READY: Bluetooth is off or unavailable` on every retry, although Bluetooth was on and permission had been granted in System Settings. On the same Mac:

- The globally installed Padcode's `padcode-bluetooth status` returned `ok:true`, `powered:true` and the connected DUALSHOCK 4 (device identities are not recorded here).
- The worktree's freshly built `padcode-bluetooth status` returned `code:"powered-off"`, and its `diagnose-permission` passed (the helper owns its permission identity).
- The microphone helpers showed the same split: installed `authorized`, worktree build `not-determined`.

The helpers are ad-hoc signed, and macOS records privacy consent per code identity, so every native rebuild is a new app to TCC with no grant. That part is expected for development builds. The defect is the Bluetooth helper's handling of it: when `CBManager.authorization` is `notDetermined`, it never requests consent; it goes straight to `IOBluetoothHostController`, which reports no powered host without consent, and the helper turns that into the misleading `powered-off` error. The user is sent to check a radio that is on, and no consent prompt ever appears.

The microphone helper already requests consent when undetermined; the maintainer also saw a microphone error, whose text has not been captured yet. It is out of scope here until that text is available.

## Design

1. **Request consent first.** After the permission-owner handoff and before any IOBluetooth call, the helper reads `CBManager.authorization`:
   - `allowedAlways`: continue as today;
   - `denied` / `restricted`: the existing `permission` error;
   - `notDetermined`: create a `CBCentralManager` (power alert disabled) to make macOS show its consent prompt, run the run loop until the authorization changes, the operation is interrupted, the parent exits, or 20 seconds pass (within the Node runner's 25-second status timeout). Then allowed continues; denied/restricted is the `permission` error; still undetermined is a new `permission-pending` error.
2. **Accurate messages.** `permission-pending`: macOS has not granted Bluetooth access to padcode-bluetooth yet; answer the macOS prompt or allow it in Privacy & Security > Bluetooth, then retry. Both permission messages add that macOS ties the grant to the exact helper build, so reinstalling or rebuilding Padcode needs it again. `powered-off` is reported only after authorization is `allowedAlways`.
3. **Testable decision.** The mapping from authorization before/after the request to an outcome is a pure function in `native/authorization.h`, used by the helper and compiled into a test harness (no radio access, no consent prompt).
4. **No bypass.** No TCC database access, no reset, no change to the host terminal. Stable code signing that would keep grants across rebuilds is a separate decision for the maintainer (it involves certificates and the release process), recorded as an open item.

## Automated acceptance

- P1 Decision harness: every authorization state before the request, and each after-state for `notDetermined` (allowed, denied, restricted, still undetermined, interrupted), maps to continue, `permission` or `permission-pending`; only `allowedAlways` continues.
- P2 Existing helper tests pass: usage errors and malformed commands never touch the radio; `diagnose-permission` still passes without radio access or prompts.
- P3 Node side: `NativeBluetooth` surfaces `permission-pending` and `permission` messages unchanged to setup, which shows them as `LINK NOT READY` with the Retry / USB / later recovery menu.
- P4 `npm run check` passes with no skipped tests.

Automated tests cannot show a real macOS consent prompt; they do not count as permission or hardware evidence.

## Physical acceptance

- H1: from a freshly built helper with no grant, `padcode config` > Bluetooth shows the macOS Bluetooth consent prompt; after allowing, the device list appears without the false "off" message.
- H2: denying the prompt (or ignoring it for 20 seconds) shows the permission message, and Retry after allowing in System Settings works.
- H3: with Bluetooth actually turned off and permission allowed, the `powered-off` message still appears.
- H4: the DUALSHOCK 4 then pairs/connects and passes the input check as before.

The PR stays draft until the maintainer reports H1-H4.

## Validation record

Pending.
