# Controls menu: Controller map

Status: implemented in 0.1.0-rc.6; automated acceptance passes and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #21 (`feature/stick-cursor`); retarget after the stack merges.

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

## Implementation notes

- The drawing is ASCII only. Shape symbols and box-drawing characters are East Asian ambiguous-width and are drawn two columns wide by many CJK terminal setups, which would break the frame; labels use (X), (O), (SQ) and (TRI) and colour carries the game look.
- With voice actions the controls menu can now hold 11 items, more than the old 9-item limit of the menu IPC message; the end-to-end suite caught the popup rejecting such a menu. The limit is now 16 items, with a test for the full menu. Number keys still pick items 1-9; later items are reached with arrows or the stick.

## Validation record

Plan commit: `8983c36`. `npm run check` passed 142 tests with zero failures or skips on macOS 27.0.1 arm64.

- A1: `test/controller-map.test.mjs` renders both profiles, voice on/off and widths 34-100: every control and its action appears, lines fit the width and stay ASCII, the frame rows are equal length, and colour output strips to the plain output.
- A2: the map context (open from the menu, O back to the map item, X and Options close, keyboard picks, unmapped buttons ignored), map-view IPC validation, and the 11-item full menu.
- A3: `test/panel_pty.py` `controls()` opens Controller map in real tmux, sees the drawing (TOUCHPAD, L STICK), returns with O and confirms nothing reached the Agent.

Artifact `padcode-0.1.0-rc.6.tgz`, npm SHA-1 `1269ec2eea6d0b0b920b5a1307bcc5ae56ad1eec`. H1 is pending.
