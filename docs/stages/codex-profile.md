# Codex controller profile

Status: planned. This plan is committed before runtime changes. Branch `thinxpro/codex-mapping` from `main` at `85fb3d1`.

## Request

The user asked whether the latest code has a complete controller mapping for Codex. It does not: `agent-session.ts` selects the `claude` editing profile only when the Agent executable is named `claude`, so Codex runs with the `basic` profile. R2 and R3 send nothing in Codex, and the controller map shows Claude Code meanings for L1 and R1. This stage adds a Codex profile that is checked against Codex's real default keymap.

## What Codex supports

Read from the Codex source at tag `rust-v0.161.0` (`codex-rs/tui/src/keymap.rs`, `built_in_defaults` and `MAIN_RESERVED_BINDINGS`), which matches the locally installed `codex-cli 0.161.0`. Codex was not run to collect this. Codex parses input with crossterm, which reads a raw-mode LF (`0x0a`) as Ctrl+J.

| Padcode control (today) | Bytes | Codex 0.161.0 default action |
| --- | --- | --- |
| D-pad / left stick | arrows | `editor.move_*`; Up/Down also recall earlier prompts (composer history); `list.move_*` in popups and approvals; `pager.scroll_*` in the transcript |
| X | Enter | `composer.submit`; `list.accept` |
| O | Esc | `chat.interrupt_turn` while a turn runs; fixed `backtrack` (edit previous message) on an empty composer; `approval.decline`; `list.cancel` |
| L1 | Tab | `composer.queue` (queue a message while a turn runs) |
| R1 | Shift+Tab | fixed `cycle_collaboration_mode` |
| Right stick left/right | Ctrl+Left/Right | `editor.move_word_left/right` |
| Right stick up/down | Home / End | `editor.move_line_start/end` |
| Square | Backspace | `editor.delete_backward` |
| Triangle | Ctrl+W | `editor.delete_backward_word` |
| L3 | Delete | `editor.delete_forward` |
| Menu: Send interrupt | Esc | `chat.interrupt_turn` |
| Menu: Clear input | Ctrl+E, Ctrl+U | `move_line_end`, `kill_line_start` (single-line input, as in Claude Code) |

Codex keys used by this stage: `editor.insert_newline` includes Ctrl+J, and `app.open_transcript` / `pager.close_transcript` are both Ctrl+T, so Ctrl+T toggles the transcript.

Codex has no undo in its default editor. `vim_normal.undo` (`u`) exists only in vim mode, which is off by default.

Known limits that this stage documents but does not change:

- Codex binds Ctrl+] to `chat.skip_question`. Padcode reserves keyboard Ctrl+] as its emergency exit, so this Codex action cannot be reached from the keyboard inside Padcode. This is the same kind of conflict as Claude Code's `app:openArtifact`.
- Inside the Codex transcript, Esc (O) starts the reserved `transcript_edit_previous` backtrack instead of closing the view. The transcript is closed with R3 again (Ctrl+T) or `q` on the keyboard. The map labels this.
- Users can remap keys with `tui.keymap` in `config.toml`. Padcode cannot read the Agent's configuration, so the profile assumes Codex defaults. This is stated in `--help` and the map.

## Mapping change

The profile becomes `'basic' | 'claude' | 'codex'`. It is chosen from the executable basename (`claude` or `codex`), and every other Agent stays `basic`. This applies in both display modes.

| Control | basic | claude (unchanged) | codex (new) |
| --- | --- | --- | --- |
| R2 | unbound | Ctrl+J newline | Ctrl+J newline (`\n`) |
| R3 | unbound | Ctrl+_ undo (`\x1f`) | Ctrl+T transcript toggle (`\x14`) |
| L1 label | Tab | Tab | Tab (queue message) |
| R1 label | Shift+Tab | Shift+Tab (mode) | Shift+Tab (collaboration mode) |

All other bytes are unchanged for every profile. R2 keeps the 0.65/0.35 trigger hysteresis, and R3 fires once per press. No new control sends CR, and the `basic` profile still sends no LF.

Rendering changes:

- `MapProfile` / IPC `MapView` replace `claude: boolean` with `agent: 'basic' | 'claude' | 'codex'`, and IPC validation rejects any other value.
- Controller map (wide, two-column and narrow): R2/R3/L1/R1 text follows the profile. In the Codex profile, R3 reads "Transcript (R3 again closes)". In `basic`, R2/R3 read "Unused (Claude Code, Codex)".
- `--help` (`ui.ts`): the R2/R3 line names both profiles and their actions.
- The comment in `stick-input.ts` and the `agentOnly` gating are generalised: per-profile key tables replace the single `agentOnly` list.

Out of scope: approval-prompt detection, Codex vim mode, reading the user's `tui.keymap`, app-server integration, remapping Ctrl+] and adding profiles for other Agents.

## Automated acceptance

- A1: the profile is selected from the basename (`codex`, `/opt/homebrew/bin/codex` → codex; `claude` → claude; `codex-wrapper`, `gemini` → basic) in both the controls-pane path (`panel-session.ts`) and the transparent path (`agent-session.ts`).
- A2: exact bytes per profile through a real `AgentGamepad`: Codex R2 → `\n`, R3 → `\x14`; Claude unchanged (`\n`, `\x1f`); basic sends nothing for R2/R3. Every other control sends identical bytes in all three profiles. No profile emits CR from R2/R3, and LF comes only from R2 in claude/codex.
- A3: R2/R3 stay silent while paused, captured (menu, history, map), disconnected or failed, for the Codex profile too, with the existing release barrier.
- A4: the controller map renders all three profiles at wide, two-column and narrow widths with voice on and off. Every line fits the width and the plain output stays ASCII. The Codex labels for R2, R3, L1 and R1 appear, and the Claude and basic labels match today's output except the basic R2/R3 wording.
- A5: `MapView` IPC accepts `agent: basic | claude | codex` and rejects a missing field, other strings and the old `claude` boolean.
- A6: end to end in tmux (`panel_pty.py`) with a fixture Agent named `codex`: R2 and R3 reach the Agent as exactly `\n` and `\x14`, and the Controller map popup shows the Codex labels. The existing Claude-named scenario still passes.
- A7: `--help` lists the per-profile R2/R3 actions. `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance (Codex 0.161.0 or later, DS4 over Bluetooth)

Record the Codex version, terminal and its version, display mode and controller transport.

- H1: type a prompt with the keyboard or voice, insert a newline with R2, and submit with X. The message arrives as two lines and R2 never submits.
- H2: R3 opens the transcript, the D-pad and left stick scroll it, and R3 closes it. Note what O does there, which is expected to be edit-previous backtrack.
- H3: while a turn runs, O and Options > Send interrupt stop it. L1 queues a typed follow-up, and R1 cycles the collaboration mode.
- H4: the sticks, Square, Triangle, L3 and Options > Clear input edit the Codex composer as in Claude Code.
- H5: an approval prompt is answered only by deliberate D-pad + X, or declined with O.
- H6: Options > Controller map shows the Codex labels and matches what the buttons do.

Hardware-dependent items keep the PR in draft until the user reports them. Simulated runs are not reported as physical passes.

## Validation record

Pending.
