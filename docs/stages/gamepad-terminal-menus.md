# Gamepad-operated terminal menus

## Scope and evidence

The user confirmed that the PS4 now connects over Bluetooth using dev.3. Record that as connection evidence only; full button, reconnection and stability acceptance remains pending. The next requirement is to operate all subsequent choice menus with the controller already in hand.

This task stacks on PR #5 (`fix/bluetooth-discovery-timeout`). Keep repository and PR content in English. No implicit merges or agent execution.

## Implementation plan

- Add an SDL-backed menu navigation service using the existing validated input stream. Activate it after transport setup and restore it from saved controller settings on startup. Reuse that input stream for the explicit fresh-button test; do not run competing helpers.
- D-pad up/down changes selection, cross confirms and circle returns through a displayed Back/Cancel/Exit choice or cancels setup without saving. Keep keyboard numbers/Enter, arrows and cancellation available.
- Use actual button edges, ignore holds and nonselected controllers, discard actions outside menus, and never carry a confirm into the next menu. When identity metadata is missing, require a fresh press on the intended controller to claim menu control; do not guess between devices.
- Display live selection and controller hints in a game-style terminal menu. Preserve narrow terminals, NO_COLOR and TERM=dumb. Explicit text entry (custom executable/arguments) still requires the keyboard and must say so.
- Disconnect/helper failure keeps the menu usable by keyboard, clears held/selection state and reports status. Reconnection requires a fresh claim. Cleanup must restore raw mode and stop the owned helper on all exits and before Controller Lab starts.
- Bump the local package to dev.4, run the full automated gate and CI, then request physical end-to-end menu testing.

## Acceptance and test matrix

| ID | Criterion | Validation |
| --- | --- | --- |
| M1 | After Bluetooth connection, input-check selection, agent/profile/save menus and Player Hub work with D-pad/cross/circle | unit integration + physical |
| M2 | Fresh selected-controller edges only; no held repeats, other-device control, queued confirmations or text-field injection | routing/probe + prompt tests |
| M3 | Keyboard numbers/Enter/arrows/q/Ctrl+C and text input remain usable; narrow/plain/color terminal output restores correctly | real PTY tests |
| M4 | Disconnect, helper error, reconnect, abort and exit clean up correctly; one helper serves menus and input check | service/lifecycle + PTY |
| M5 | Complete automated gate, installed-package smoke and macOS/Ubuntu CI pass | npm run check + CI |
| M6 | User completes Bluetooth-to-save and hub choices with controller, including cancellation and reconnect | physical checklist; Draft until passed |

## Validation evidence

- Pre-implementation plan commit: `840d5d2`.
- Local `npm run check` passed all 57 tests, zero failures/skips, on macOS 27 arm64 / Node 23.5.0. The suite includes the installed-package smoke and all prior tests.
- Real PTY tests drive the production prompt/setup and ControllerProbe through a synthetic JSONL helper: first physical claim, input check, agent/profile/save/hub choices, held-confirm suppression, D-pad duplicates, disconnect/reclaim, explicit circle Exit/Back, keyboard arrows, plain text fields ignoring controller input, Ctrl+C, terminal restoration and helper reaping. A launch counter confirms menus and input verification use one helper.
- Service tests cover identity mismatches, ambiguous-device claiming, competing devices, helper failure, abort and reactivation cleanup. A subprocess regression test confirms disconnect during a pending input check does not permanently poison the shared stream after reconnection.
- Raw terminal rendering retains numbered input, selected-row highlighting, narrow/color/plain behavior and keyboard cancellation. Text input remains explicitly keyboard-only.
- CI is tracked on this task's PR. The local package is `0.1.0-dev.4` for macOS arm64; no npm registry publication.
- User evidence: dev.3 successfully connects the PS4. M6 and the original full physical stability criteria remain pending; this implementation PR stays Draft.

## Physical acceptance checklist

1. Install dev.4, run `padcode config`, connect the controller and press X once to claim menus.
2. Without returning to the keyboard, select the input check, select the intended SDL controller and press a fresh button to pass verification.
3. Use D-pad/X to select an installed agent, confirm the profile and save. Enter Player Hub and choose Exit with O. Custom command text is a documented keyboard exception.
4. Restart `padcode`, claim the controller and navigate the saved Player Hub; open configuration editing with the controller.
5. Hold X: it must not confirm the next menu. Hold D-pad: it must not continuously scroll. Test circle cancellation at save and verify the prior configuration is retained.
6. Disconnect/reconnect during a menu and during input verification. Keyboard must remain usable, and a fresh X press must restore controller menu control.
7. Test Ctrl+C and check the terminal remains usable. Record terminal/version and any incorrect selections; no credentials are needed.
