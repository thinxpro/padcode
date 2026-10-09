# UI-3: Controller Lab

Status: implemented; automated acceptance passes locally; DualShock 4 acceptance and display review pending. This plan, its acceptance criteria and test matrix were committed before implementation.

Stacked on [UI-2](ui-2-setup-wizard.md) (`feature/setup-wizard`, PR #27), which is stacked on UI-1 (#26) and UI-0 (#25); none is merged yet. This PR targets `feature/setup-wizard` and is retargeted as prerequisites merge. (The branch is `feature/ui-controller-lab`; `feature/controller-lab` is the merged P0-1 branch.)

## Request

Fourth stage of the interface overhaul. The maintainer accepted UI-1 and UI-2 and asked to continue with UI-3 on 2026-10-09: Controller Lab (`padcode controllers`, Hub > Controller lab) and the arcade demo should draw the controller, light up pressed buttons and show sticks and triggers visually.

## Findings

- `render(state, width, height, color)` in `ui.ts` draws the lab and the demo as plain text: a title, a source line, a status line, an ASCII face/D-pad sketch with `[X]` for pressed buttons, `HELD` button names, `#` meters for the four stick axes and two triggers, recent input and a footer. `session.ts` repaints it on the alternate screen (or prints plain frames when the output is not a terminal).
- Only the face buttons, D-pad and shoulders are drawn; menu/view, stick presses, triggers as buttons and the touchpad are only listed under `HELD`. Stick positions are numbers and bars, not positions.
- Button names already follow the device family (`glyphs.ts`).
- Tests and PTY suites match `PLAYER READY`, `INSERT CONTROLLER`, `BOOTING`, `DEMO / SYNTHETIC`, `TEST / VIRTUAL DEVICE`, `LIVE / SDL INPUT`, `DEMO - NOT HARDWARE EVIDENCE`, and the footers `HOLD O 1S / Q BACK`, `RELEASE O TO RETURN`, `O / Q BACK`, `Q / ESC EXIT`. The lab unit test also matches the `#` meter (`-#####`) and `[A]`-style pressed labels.

## Design

1. **Canvas (`src/tui/canvas.ts`).** A fixed-size grid of cells with a style per cell; `put(row, column, text, style)` writes text, `lines()` returns rows with merged SGR runs. Used to place controller parts at fixed columns.
2. **Controller drawing.** A frame titled `CONTROLLER LAB` with the source on the right. Inside, drawn at fixed positions for a 60-column body:
   - triggers L2/R2 as labelled block meters, shoulders L1/R1 as key caps;
   - view/menu buttons (family names) in the centre, and a touchpad or home label (PlayStation draws the touchpad);
   - the D-pad as a cross of arrows (`▲ ◀ ▶ ▼`), face buttons as a diamond of key caps with family names;
   - each stick as a small box with a dot at the stick's position (5 x 3 positions), its name (L3/R3) lit while pressed, and `X/Y` values below.
   Pressed controls are highlighted (inverse accent key caps with colour; `[NAME]` brackets without colour, as today).
3. **Status and history.** Above the drawing: player/device line with a status dot (`PLAYER READY // name`, `INSERT CONTROLLER // waiting for connection`, `BOOTING INPUT ENGINE...`), device count and button edges. Below: `HELD` names and `RECENT INPUT` (as many lines as fit). Footer: the existing return hint (`HOLD O 1S / Q BACK` etc.) and the demo warning, unchanged in wording.
4. **Responsive layout.** Full drawing at 64+ columns and enough rows; a compact layout (D-pad and face rows as key caps, stick and trigger meters as bars) below that; every line fits the width and the frame fits the height; recent input shrinks first. `NO_COLOR`, `TERM=dumb` and non-TTY output contain no escape sequences; `PADCODE_ASCII=1` and non-UTF-8 locales use ASCII (`^ v < >`, `o` for the stick dot, `#` meters).
5. **Wiring.** `session.ts` passes `detectCaps(process.env, output)` instead of a colour flag; the input, hold-to-return and demo logic are unchanged.

## Automated acceptance

- L1 Canvas: placement, overwrite, clipping at edges, wide characters, style runs, monochrome output.
- L2 Lab render: every family shows its own button names; each pressed control (face, D-pad, shoulders, triggers, menu/view, stick presses, touchpad) is highlighted; stick dots move to the expected cell for full deflection in each direction and centre at rest; trigger meters follow the value; disconnected/booting/waiting/demo/virtual/live states keep their texts and footers.
- L3 Fit: widths 12 to 160 and heights 5 to 50 in truecolor, monochrome and ASCII: every line fits, frame fits, no escapes without colour, ASCII-only chrome in ASCII mode; hostile device names are sanitised.
- L4 Snapshots: full and compact layouts, idle and with inputs, PlayStation and Xbox, truecolor / monochrome / ASCII.
- L5 PTY: lab and demo suites (Hub navigation lab hold-O and demo, onboarding demo, `pty_check.py`) pass unchanged.
- L6 `npm run check` passes with no skipped tests. The lab unit test's `#` meter expectation is replaced by the new meter check (reason: meters use the shared block meter since UI-0).

## Physical acceptance

- H1 (DualShock 4): in Controller Lab every button lights the matching part of the drawing with PlayStation names, the stick dots follow both sticks, L3/R3 light when pressed, L2/R2 meters follow the triggers, the touchpad press shows.
- H2: hold O for one second returns to the Hub only after release, as before; `q` returns too.
- H3 (when hardware is available): an Xbox or Nintendo controller shows its own names in the drawing.

Display review: the drawing at full width, about 60 and 40 columns, `NO_COLOR=1` and `PADCODE_ASCII=1`.

## Implementation notes

- `src/lab-view.ts` replaces `render` in `ui.ts` (removed); `session.ts` passes `detectCaps` with the output size. The lab unit cases moved from `test/ui.test.mjs` to `test/lab-view.test.mjs`.
- The drawing is one layout for every family (D-pad left, face buttons right, sticks below); names, the touchpad (PlayStation) or HOME label, and the PS button follow the family. The offset-stick drawing remains in the session controller map (UI-4 scope).
- The full drawing needs 64 columns and about 22 rows; otherwise the compact rows are used, then no frame below 40 columns. The footer is kept on the last row in every size.
- A trigger past half lights its name; the meter itself is drawn cell by cell on the canvas so its colours survive.
- `DIVIDER` is now typed `unique symbol` so row arrays built with spreads type-check.
- The first full gate failed once in `gamepad-agent-pty.py` (`press('south')` reached the Agent during the 250 ms settle window). That suite does not use the lab code; it passed five isolated runs and the complete rerun. Recorded as an intermittent timing failure, not fixed here.

## Validation record

Plan commit: `738c0cb`. On macOS 27.0.1 arm64 with Node 24.21.0, the second complete `npm run check` passed 191 tests with zero failures or skips (the first had the intermittent failure above); `lab-view.js` and `canvas.js` have 100% line coverage. CI is disabled by the maintainer's decision, so Linux was not exercised.

- L1-L3: `test/lab-view.test.mjs`.
- L4: 10 snapshots in `test/snapshots/lab/`.
- L5: Hub navigation (lab hold-O, demo), onboarding demo and `pty_check.py` suites pass unchanged.

DualShock 4 acceptance H1-H2 and the display review are pending.
