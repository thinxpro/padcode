# Codex controller profile

Status: implemented and merged; automated acceptance passes locally; physical acceptance reported as passed by the user (see below). This plan was committed before runtime changes (`0d6d727`). Branch `thinxpro/codex-mapping` from `main` at `85fb3d1`.

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
| R1 label | Shift+Tab | Shift+Tab (mode) | Shift+Tab (collab mode) |

All other bytes are unchanged for every profile. R2 keeps the 0.65/0.35 trigger hysteresis, and R3 fires once per press. No new control sends CR, and the `basic` profile still sends no LF.

Rendering changes:

- `MapProfile` / IPC `MapView` replace `claude: boolean` with `agent: 'basic' | 'claude' | 'codex'`, and IPC validation rejects any other value.
- Controller map: R2/R3 text follows the profile in every layout, and L1/R1 text follows it in the shoulder rows (drawing and two-column legend). In the Codex profile, R3 reads "Transcript on/off". In `basic`, R2/R3 read "Unused for this Agent". The narrow list keeps its generic "Tab / Shift+Tab" row.
- The map's profile comes from the controller source (`AgentGamepad.profile`), so the map always shows the keys the controller actually sends.
- `--help` (`ui.ts`): the R2/R3 line names both profiles and their actions. The README controls table states that each Agent's default keymap is assumed.
- The comment in `stick-input.ts` and the `agentOnly` gating are generalised: per-profile key tables replace the single `agentOnly` list.

Out of scope: approval-prompt detection, Codex vim mode, reading the user's `tui.keymap`, app-server integration, remapping Ctrl+] and adding profiles for other Agents.

## Automated acceptance

- A1: the profile is selected from the basename (`codex`, `/opt/homebrew/bin/codex` → codex; `claude` → claude; `codex-wrapper`, `gemini` → basic). `launchConfigured` selects it once for both display modes, and the controls-pane map reads it from the same controller source.
- A2: exact bytes per profile through a real `AgentGamepad`: Codex R2 → `\n`, R3 → `\x14`; Claude unchanged (`\n`, `\x1f`); basic sends nothing for R2/R3. Every other control sends identical bytes in all three profiles. No profile emits CR from R2/R3, and LF comes only from R2 in claude/codex.
- A3: R2/R3 stay silent while paused, captured (menu, history, map), disconnected or failed, for the Codex profile too, with the existing release barrier.
- A4: the controller map renders all three profiles at wide, two-column and narrow widths with voice on and off. Every line fits the width and the plain output stays ASCII. The Codex labels for R2, R3, L1 and R1 appear, the Claude output is unchanged, and the basic output differs from today only in the R1 and R2/R3 wording.
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

## Changes against the plan

Found while rendering, before any acceptance ran:

- **Shorter labels.** The planned "Transcript (R3 again closes)" and "Unused (Claude Code, Codex)" do not fit the 34-column narrow list (25 characters for the action). They became "Transcript on/off" and "Unused for this Agent", and the "R3 again closes" hint is stated in this document and the physical checklist. "Shift+Tab (collaboration mode)" became "Shift+Tab (collab mode)" for the same reason.
- **Basic R1 label.** The plan table already gave basic R1 as "Shift+Tab". The original A4 wording ("match today's output except the basic R2/R3 wording") contradicted that and now names R1 too.
- **Default-keymap note.** The note is in the README controls table, not `--help`. The help row is already 77 of 80 columns.

## Validation record

On macOS 27.0 arm64 with Node 23.5.0 and tmux 3.7c, `npm run check` passed 199 tests with zero failures or skips.

- A1: `test/stick-input.test.mjs` "A1 the profile follows the executable name" covers bare names, absolute paths, wrappers, other Agents and an empty command, and that the profile list matches the key table.
- A2/A3: the same file sends every stick and editing control through a real `AgentGamepad` for `basic`, `claude` and `codex`. Codex adds exactly `\x14` (R3) and `\n` (R2), Claude adds `\x1f` and `\n`, and basic adds nothing. A second controller and a paused controller send nothing. Inside a captured context, the Claude and Codex profiles both leak no bytes. No R2/R3 key contains CR, and no shared key contains CR or LF.
- A4/A5: `test/controller-map.test.mjs` renders all three profiles at widths 34, 60, 78 and 100 with voice on and off and checks the R2/R3 rows and the shoulder labels. The `MapView` IPC accepts the three profiles, with and without family/swap, and rejects unknown, miscased, numeric and missing values as well as the old `claude` boolean. The Claude map snapshots (`test/snapshots/session/map-*.txt`) are unchanged.
- A6: `test/panel_pty.py` `codex_profile()` in real tmux: R3 then R2 reach the Agent as exactly `\x14\n`, Square still sends `\x7f`, and the Controller map popup shows "Transcript on/off", "New line (no send)", "Tab (queue message)" and "Shift+Tab (collab mode)" with no Claude Code "Undo". Nothing from the menu or map reaches the Agent. The existing Claude `sticks()` scenario still passes.
- A7: the `--help` snapshots changed only in the R2/R3 row.

H1-H6 were pending physical testing with Codex at that point.

### Merge with quick commands (PR #36)

PR #36 (quick commands) merged into `main` first and conflicted with this branch in the controls menu, controller map, README and PTY tests. Resolution: Quick commands is now controls-menu item 6 and Controller map item 7, so `codex_profile()` opens the map with six D-pad presses. The map keeps both the profile labels and the touchpad row. Quick commands has its own `agentKind` (`claude` / `codex` / `other`) in `quick-commands.ts`. That duplicates `agentProfile` and is left for a follow-up so this PR stays scoped. After the merge, on the same machine, `npm run check` passed 206 tests with zero failures or skips.

### User-reported physical acceptance and merge decision

On 2026-10-10 the user reported that physical testing passed ("测过了") and authorized merging PR #35. The report did not break results down by H1-H6 and did not record the Codex version, terminal, display mode or controller transport, so those details are not claimed here.
