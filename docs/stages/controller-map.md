# Controls menu: Controller map

Status: planned. This plan is committed before runtime changes. Stacked on PR #21 (`feature/stick-cursor`); retarget after the stack merges.

## Request

The user asked for an Options menu entry that shows, like a game's controls screen, how every DualShock 4 control maps to Claude Code, so the mapping is easy to remember. Customising the mapping is deferred.

## Behavior

- New controls-menu item **Controller map** (after Clear input). It opens a popup with a drawing of the controller: shoulder and trigger labels above it, D-pad, face buttons, sticks, L3/R3, Share, touchpad and Options on it, and a legend below. O returns to the controls menu; Options or X closes everything.
- The content follows the active profile: for Claude Code, R2 is "New line (no send)" and R3 "Undo"; for other Agents they read "Not used (Claude Code only)". L2 shows "Hold to dictate" when voice is set up and "Voice off (Hub > Voice settings)" otherwise. Keyboard-only facts are listed too: Ctrl+] ends the session.
- The popup worker draws the figure from a pure renderer (`controller-map.ts`); only the profile and voice flag cross IPC. At 78 columns or more it draws the controller; narrower popups show a two-column list. Colors follow the status pane; `NO_COLOR` renders plain text. The Agent pane is not resized.

## Automated acceptance

- A1: renderer output for both profiles, voice on/off, wide and narrow widths: every mapped control appears with its action, lines never exceed the width, and the plain variant contains no escape sequences.
- A2: menu context tests: opening the map, O back to the menu at the same item, Options/X closing, keyboard keys in the popup, IPC validation of the new view fields.
- A3: end to end in tmux: the popup shows the drawing with the Claude Code labels, nothing reaches the Agent, and closing re-arms after the barrier. `npm run check` passes with no skipped tests.

## Physical acceptance

- H1: open Options > Controller map in Claude Code; the drawing is readable in the user's terminal and matches what the buttons do.

## Validation record

Pending.
