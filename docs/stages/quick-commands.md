# Quick commands: slash commands and mentions from the controller

Status: implemented in 0.1.0-rc.10; automated acceptance and user-reported physical acceptance (H1-H4) pass. This plan was committed before runtime changes. Targets `main`.

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

## Implementation notes

- The popup now scrolls: when the items exceed the rows inside the popup, it shows a window around the selection with "... N more above/below" rows. The first attempt reserved one row too many and clipped lists that fit; the end-to-end test caught it, and a unit test now proves lists that fit the coordinator's popup are never clipped.
- The Controller map legend gained one row (TOUCH and Share/View), so the full drawing is 16 lines and the compact legend 9; the compact legend fits from 16 terminal rows (was 15). On controllers without a touchpad the TOUCH row says `@` is in Quick commands.
- The status pane legend adds `[SHARE] COMMANDS`; it is dropped first on narrow panes like the other trailing hints.
- Keeping the Agent in `padcode config` keeps its custom commands; choosing another Agent starts without them, because commands are Agent-specific.

## Validation record

Plan commit: `5dd136c`. `npm run check` passed 205 tests with zero failures or skips on macOS 27.0.1 arm64, Node 24.21.0.

- A1, A4, A5: `test/quick-commands.test.mjs` (palette per Agent kind, custom limits, config round-trip and rejections, scrolling for 24 items at several heights, no clipping for lists that fit, 24-item IPC). `test/onboarding.test.mjs` covers keeping custom commands.
- A2: the Quick commands button matrix and menu/Share/keyboard paths in `test/quick-commands.test.mjs`; the controls menu tests now include the new item.
- A3: `test/agent-gamepad.test.mjs` (touchpad `@`, Share `/` in transparent mode) and the routing test in `test/quick-commands.test.mjs` (no effect while captured or paused).
- A6: `test/controller-map.test.mjs` height invariants for 16-40 terminal rows; snapshots updated.
- A7: `panel_pty.py` `commands()` in real tmux: Share opens QUICK COMMANDS, item 1 writes exactly `/`, a custom command writes exactly its bytes with no Enter and shows the TYPED notice, the touchpad writes `@`, Share/O close without typing, keyboard `4` picks, Options > Quick commands returns to the menu on O, and nothing else reaches the Agent.

Artifacts `padcode-0.1.0-rc.10.tgz` (SHA-1 `688aeb200de9dcfb18143c13955cbe4b27747530`) and `padcode-darwin-0.1.0-rc.10.tgz` (SHA-1 `b468198e5afe1ec88c2665070dc9271285ba7327`), ad-hoc signed.

### User-reported physical acceptance

On 2026-10-09 the maintainer installed the rc.10 tarballs into their Node 23.5 global install and reported, item by item, that H1 (`/clear`, `/compact`, `/model`, `/resume` in Claude Code), H2 (the `/` command picker), H3 (touchpad `@` file picker) and H4 (Codex `/clear` and `$`) passed. Whether dictation was used to filter the `@` picker was not reported separately.

On 2026-10-10 the maintainer asked to merge. GitHub Actions produced no checks for this PR (recent runs on other branches fail within seconds, before any step runs), so the merge rests on the local `npm run check` gate and the physical acceptance above.
