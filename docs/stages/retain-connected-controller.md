# Retain known controllers during discovery

## Evidence and scope

The user reports that dev.4 controller-operated menus pass. Record the requested menu flow as user-verified, without inferring unreported reconnect, hold or ten-minute stability results. A connected PS4 disappears when the user selects Scan nearby because that action replaces the known-device list with inquiry-only results.

This task stacks on PR #6 (`feature/gamepad-terminal-menus`). No merge or hardware connection changes are implied.

## Implementation plan

- Keep discovery and known-device status as separate inputs. After every scan, refresh known-device status and merge both sources by normalized Bluetooth address. Show source and connection state; prioritize connected controllers. Known entries must not inflate the nearby discovery count.
- Keep the device picker open after scan errors, with known controllers still selectable. If status refresh fails, retain previously known entries explicitly as cached/unknown and require a connection check rather than assuming they remain connected. Abort must still exit rather than recover silently.
- Never carry old inquiry-only results into later empty scans. Preserve partial-scan warnings before the status call resets adapter state. No automatic pairing, disconnect or unpair operation.
- Add merge/failure/cancellation tests and end-to-end setup selection tests; run the full automated gate and CI. Bump the local package to dev.5 and request a connected-controller scan regression test.

## Acceptance and tests

| ID | Criterion | Verification |
| --- | --- | --- |
| K1 | Connected/paired controllers remain selectable after empty/successful/partial scans; duplicate addresses create one entry | merge + setup tests |
| K2 | Source labels and discovered counts distinguish known devices from inquiry results; status refresh is authoritative | merge/UI tests |
| K3 | Scan failure stays in the picker; status failure retains cached known entries without false connected claims; abort stops | failure + setup tests |
| K4 | Already-connected selection avoids unnecessary pair/connect; cached selection verifies connection; existing keyboard/gamepad flows pass | setup + full gate |
| K5 | User scans while PS4 is already connected and continues without restarting config | physical regression, pending |

## Prior-stage user evidence

On 2026-09-19 the user reported the dev.4 requested controller-menu test passed. This covers the reported menu flow; it does not establish completion of every separate physical stress/stability criterion.
