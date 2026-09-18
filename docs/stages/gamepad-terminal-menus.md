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
