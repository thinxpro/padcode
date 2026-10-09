# UI-4: Session status pane, controls popup and controller map

Status: planned. This plan, its acceptance criteria and test matrix are committed before implementation.

Stacked on [UI-3](ui-3-controller-lab.md) (`feature/ui-controller-lab`, PR #30) and the earlier UI stages (#25-#27); none is merged yet. This PR targets `feature/ui-controller-lab` and is retargeted as prerequisites merge.

## Request

Last stage of the interface overhaul. The maintainer reported UI-3 working with the DualShock 4 on 2026-10-09 and asked to continue. Inside an Agent session (tmux display), the status pane under the Agent, the controls popup (`PADCODE CONTROLS`, `END SESSION?`, `VOICE DRAFT`) and the controller map should match the rest of the new interface.

## Findings

- `renderPanel(status, width, rows, color, notice, names)` (`panel.ts`) draws one or two rows: `PADCODE // GAMEPAD <STATE>` with the detail and `CTRL+] END` on the right, then a legend of button hints. Colours are raw SGR codes per state.
- `pane-menu.ts` draws the popup: title, blank, optional body, blank, items as `> [n] item`, blank, hint. `panel-session.ts` sizes the tmux popup from that row structure (`items + 6`, plus the body), so the number of rows must not change.
- `controller-map.ts` draws the map in ASCII (`_`, `/`, `|`) because box-drawing characters are ambiguous-width; since UI-0 the maintainer chose Unicode chrome with an ASCII fallback (`PADCODE_ASCII=1`, non-UTF-8 locales).
- Tests that read the panes: `panel_pty.py` checks the pane text for `GAMEPAD ACTIVE`, `MENU`, `ACTIVE`, and the raw popup output for `PADCODE CONTROLS`, `> [2] Pause gamepad mapping`, `HOME`, `XBOX WIRELESS CONTROLLER`, `TOUCHPAD`, `L STICK`, `Delete word, hold`, `Ends the session` and the absence of `more lines`. `panel.test.mjs` checks exact monochrome strings (`PADCODE // GAMEPAD`, the legend text) and that stripping colour yields the monochrome text.

## Design

1. **Status pane.** `renderPanel(status, caps, rows, notice, names)`:
   - row 1: `PADCODE` (brand), a state dot coloured by state (`●` ok for ACTIVE, `▲` warn for PAUSED/HISTORY/RECONNECTED/ARMING, `✕` danger for DISCONNECTED/INPUT LOST/UNAVAILABLE/END SESSION?, `◆` accent for MENU/REC/PLAYING), then `GAMEPAD <STATE>` as one span in the state tone, the detail dimmed, and `CTRL+] END` right-aligned. Priority when narrow: state first, then `CTRL+] END`, then the detail.
   - row 2: the legend with key caps (inverse in colour, `[KEY]` without), fitted by priority as today; a notice replaces it with a warning symbol and text.
   - Monochrome and ASCII text: `PADCODE * GAMEPAD ACTIVE` style (ASCII dot), so `GAMEPAD <STATE>` stays contiguous in every mode.
2. **Controls popup.** Same rows as today: the title (brand, one span, e.g. `PADCODE CONTROLS`), a rule instead of the first blank row, body, blank, items, blank, hint. The current item is one span `▶ 2  Pause gamepad mapping` (accent, bold); other items `  3  ...`; the hint is dimmed. ASCII mode uses `>`.
3. **Controller map.** The outline uses rounded box drawing (`╭─╮│╰╯`) with Unicode and keeps the ASCII outline otherwise; labels and actions use theme tones. Positions, legend text and the compact list are unchanged, so map sizing in `panel-session.ts` is unchanged.
4. **Capabilities.** `pane-panel.ts` and `pane-menu.ts` use `detectCaps` on their own pane output; `panel-session.ts` sizes the map with the same function in monochrome.

## Automated acceptance

- S1 Status pane: every state at widths 20-140 and 1-2 rows in truecolor, monochrome and ASCII: lines fit, `GAMEPAD <STATE>` intact whenever `GAMEPAD` is shown, state symbol and tone per state, `CTRL+] END` kept before the detail, notices, sanitised input; stripping colour equals the monochrome render apart from the key-cap padding, which is checked separately.
- S2 Popup rows: the popup renderer is a pure function returning exactly title + 1 + body (+1 when present) + items + 2 rows, so the tmux height formula still holds; selected and other items, long items truncated, ASCII and monochrome without escapes.
- S3 Map: Unicode and ASCII outlines close on every row at 78 columns for PlayStation and offset layouts; same row count as before; compact list unchanged.
- S4 PTY: `panel_pty.py` and `menu-pty.py` pass; the popup selection check changes from `> [2] Pause gamepad mapping` to `▶ 2  Pause gamepad mapping` (documented reason: new item marker); all other checks unchanged.
- S5 `npm run check` passes with no skipped tests.

## Physical acceptance

- H1 (DualShock 4, tmux display): the status pane shows the new style for ACTIVE, PAUSED (Options), MENU, and DISCONNECTED (controller off), with readable colours.
- H2: Options opens the controls popup; D-pad moves `▶`; the controller map opens and is drawn with a closed outline; O closes.
- Display review with `NO_COLOR=1` and `PADCODE_ASCII=1`.

## Validation record

Pending.
