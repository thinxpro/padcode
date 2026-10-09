# Quick commands: slash commands and mentions from the controller

Status: plan committed before runtime changes. Targets `main`.

## Request

Claude Code and Codex open command and mention pickers when `/` or `@` is typed in their input. The controller had no way to type these characters. The user chose option C: a quick-commands palette on Share/View plus a direct `@` on the touchpad, with `/clear`, `/compact`, `/model` and `/resume` as the core commands and further useful commands researched.

## Research (2026-10-09)

Checked against the installed Claude Code 2.1.295 and codex-cli 0.161.0, the Claude Code command docs and changelog, and the Codex TUI source (`slash_command.rs`, `chat_composer.rs`, `file_search.rs`).

- Both Agents treat `/` as a command only at the start of the input. Typing the full command (`/compact`) and pressing Enter runs it; Up/Down and Tab/Enter navigate the picker. Padcode already maps these to the D-pad, L1 and the confirm button.
- `@` opens a file picker in both. Codex lists no files until at least one character is typed; Claude Code's empty-query behavior is unverified. Dictation (L2) can supply the filter text.
- Claude Code: `!` at the start enters shell mode; the `#` memory shortcut was removed in 2.0.70, so `#` is not offered.
- Codex: `$` opens the skill/app mention picker; `!` shell commands depend on a config switch and are not offered.
- Ranked for a controller. Claude Code: `/clear`, `/compact`, `/model`, `/resume`, `/rewind`, `/plan`, `/context`, `/diff`, `/usage`. Codex: `/clear` (clears the screen and starts a new chat), `/compact`, `/model`, `/resume`, `/plan`, `/diff`, `/status`, `/review`, `/fork`.
- Custom commands: Claude Code skills and `.claude/commands`; Codex custom prompts are deprecated in favor of skills. Automatic discovery is out of scope; users list their own commands in the configuration instead.

## Behavior

- **Share / View** (`back`) opens the **Quick commands** popup while the gamepad routes to the Agent. The popup is also reachable from the controls menu (item after Clear input). Pressing Share again or O closes it (O returns to the controls menu when opened from there).
- Items, in order: `/  Browse all commands`, `@  Mention a file`, the Agent's extra sigil (`!  Shell mode` for Claude Code, `$  Mention a skill` for Codex), the researched commands for the detected Agent, then the user's custom commands. Other Agents get `/`, `@` and custom commands only. The Agent is detected from the executable name (`claude`, `codex`).
- Choosing an item **types** its text into the Agent as keystrokes and never presses Enter: the Agent's own picker appears, and the user confirms with X (or edits/cancels). Padcode cannot see the input, so it does not clear it first; a status notice says commands only run at the start of an empty input and that Clear input is in the controls menu.
- **Touchpad click** types `@` directly. Controllers without a touchpad use the palette.
- Transparent (no tmux) mode has no popup: Share types `/` and the touchpad types `@`, opening the Agent's own pickers.
- Custom commands: optional `agent.commands` in `config.json`, up to 8 strings, each starting with `/`, at most 60 characters, no control characters. Unknown or invalid values fail configuration validation like other fields; existing configurations without the field are unchanged.
- The popup scrolls when its items exceed the available rows, keeping the selection visible. The menu IPC limit rises from 16 to 24 items.
- The Controller map lists Share/View as Quick commands and the touchpad as `@ mention`.

## Automated acceptance

| ID | Criterion | Validation |
| --- | --- | --- |
| A1 | Palette contents per Agent kind (Claude Code, Codex, other) with custom commands appended; labels fit 64 chars | unit (`quick-commands.test.mjs`) |
| A2 | Context matrix: Share opens the palette from the Agent context, every button has exactly one effect in the palette, O/Share/Options close it, opening from the menu returns to the menu item on O, keyboard numbers pick | unit (`session-controls.test.mjs`) |
| A3 | Choosing an item emits exactly its keystrokes once, no Enter; touchpad emits `@`; Share in transparent mode emits `/`; nothing is sent while paused or captured | unit (`agent-gamepad.test.mjs`) |
| A4 | Config: valid `agent.commands` round-trips; too many, too long, missing `/`, control characters and non-strings are rejected; absent stays absent | unit (`config.test.mjs`) |
| A5 | Popup scrolling keeps the selection visible for 24 items in short popups; IPC accepts 24 items and rejects 25 | unit (`popup-view.test.mjs`, `session-controls.test.mjs`) |
| A6 | Controller map shows Share and touchpad entries; height invariants still hold for every terminal height | unit (`controller-map.test.mjs`) |
| A7 | End to end in tmux: Share opens QUICK COMMANDS, choosing `/` and a custom command writes exactly those bytes to the Agent, touchpad writes `@`, nothing else reaches the Agent, the session re-arms after the barrier | `panel_pty.py` |
| A8 | `npm run check` passes with no skipped tests | local gate and CI |

## Physical acceptance

- H1: in Claude Code, Share > `/clear`, `/compact`, `/model`, `/resume` each show the command in the input and X runs it.
- H2: Share > `/  Browse all commands` opens Claude Code's command picker; D-pad and X pick a command.
- H3: touchpad click types `@` and the file picker appears; dictating part of a file name filters it.
- H4: the same in Codex (`/clear`, `$` skill picker).

## Out of scope

- Discovering skills or custom commands from the Agent's directories.
- Remapping buttons; the palette is not configurable beyond `agent.commands`.
