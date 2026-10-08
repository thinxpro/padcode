# Sticks and face buttons for text editing

Status: implemented in 0.1.0-rc.5; automated acceptance passes and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #20 (`feature/hub-start-first`); retarget after it merges.

## Request

The user asked to use the unbound sticks for the cursor in the Agent's input, including jumps to the start and end and text selection if the Agent supports it, and in general to make every keyboard editing action reachable from the controller with intuitive, comfortable controls.

## What the Agent supports

Read from Claude Code 2.1.292's default keybinding table and prompt editor (strings in the installed binary; no Agent run):

- Character and line movement: arrows; up/down at the first/last line move through history.
- Word movement: Ctrl/Alt/Fn + Left/Right.
- Line start/end: Home/End (at column 0 Home moves to the previous line's start, so repeating walks up).
- Backspace, Delete (forward), Ctrl+W (delete word before), Ctrl+K/Ctrl+U (kill to line end/start).
- `chat:newline` = Ctrl+J, `chat:undo` = Ctrl+_ , `chat:clearInput` = Ctrl+L.
- No text selection in the input (Shift+arrows are not selection), so selection is out of scope; terminal mouse selection remains available.
- Avoided: Ctrl+D (exits on an empty input), Ctrl+Y (bound to `chat:defaultToNewerModel`), Ctrl+H (empty-input side effects).
- Noted conflict: Claude Code binds Ctrl+] to `app:openArtifact`, which Padcode reserves as its emergency exit.

## Mapping (Agent context, both display modes)

| Control | Key sent | Hold |
| --- | --- | --- |
| Left stick left/right | Left / Right | repeats; faster with more tilt |
| Left stick up/down | Up / Down | repeats; faster with more tilt |
| Right stick left/right | Ctrl+Left / Ctrl+Right (word) | repeats |
| Right stick up / down | Home / End | repeats slowly, walking line by line |
| Square | Backspace | repeats |
| Triangle | Ctrl+W (delete word before) | repeats |
| L3 (left stick click) | Delete (forward) | once per press |
| R2 | Ctrl+J newline, Claude Code only | once per press |
| R3 (right stick click) | Ctrl+_ undo, Claude Code only | once per press |

Existing mappings are unchanged (D-pad arrows, X Enter, O Escape, L1 Tab, R1 Shift+Tab, Options menu, L2 voice). None of the new controls sends Enter. R2 and R3 are enabled only when the Agent executable is named `claude`, because Ctrl+J acts as Enter in many other programs; for other Agents they stay unbound.

Stick handling: a direction activates at 0.5 tilt and releases below 0.3; the dominant axis wins and the other axis is ignored until release, so diagonals do not jump lines. First repeat after 350 ms, then 160 ms at 0.5 tilt down to 45 ms at full tilt (left stick), 250-110 ms (word), 400 ms (Home/End). Face-button repeat: 400 ms delay, then 70 ms. R2 uses the same 0.65/0.35 hysteresis as L2. All repeats stop on release, pause, disconnect, helper loss, menu/history capture and session end; nothing is replayed.

In Padcode contexts the left stick acts as the D-pad (menus, draft popup, history line scroll) and the right stick up/down pages history; other new controls do nothing there.

## Automated acceptance

- A1: direction detection: thresholds, hysteresis, dominant axis, diagonal jitter, return to centre.
- A2: repeat timing (injected clock) for each stick and face button, tilt-dependent rate, and that every stop condition (release, pause, disconnect, capture, stop) cancels pending repeats.
- A3: exact bytes for every control; R2/R3 only with the Claude Code profile; no control emits CR or LF except R2's Ctrl+J for Claude Code.
- A4: captured contexts receive D-pad equivalents from the left stick and page commands from the right stick.
- A5: end to end in tmux: stick and face-button events reach the Agent as exact bytes; the status legend lists the sticks; `npm run check` passes with no skipped tests.

## Physical acceptance

- H1: in Claude Code, move by character, word and line; jump to line start/end and walk to the beginning and end of a multi-line input.
- H2: delete with Square (hold), Triangle and L3; insert a newline with R2; undo with R3.
- H3: report whether repeat speeds, thresholds and button choices feel right.

## Implementation notes

- When one stick direction releases while the stick is already pushed along the other axis (rotating right to up), the new direction starts once; while a direction is held the other axis is ignored, so small diagonal movement never jumps a line.
- Square and Triangle stay raw buttons inside Padcode contexts (menus ignore them).

## Validation record

Plan commit: `79b0565`. `npm run check` passed 138 tests with zero failures or skips on macOS 27.0.1 arm64.

- A1-A3: `test/stick-input.test.mjs` with a deterministic clock covers thresholds, hysteresis, the dominant-axis lock, diagonal jitter, rotation, repeat delays and tilt-dependent speed, release and `stop()` cancellation (a held stick and a held R2 must return to centre first), exact bytes per control through a real `AgentGamepad`, Claude Code-only newline/undo, other controllers and a paused controller sending nothing, and that no control sends CR (only R2 sends LF, Claude Code profile).
- A4: in a captured context the left stick produces D-pad presses and the right stick produces page presses, with no Agent bytes.
- A5: `test/panel_pty.py` `sticks()` in real tmux: every stick direction and editing button reaches the Agent as its exact key, a held stick repeats only Right and stops on release, and in the controls menu the stick moves the selection without reaching the Agent. The status legend lists STICKS CURSOR and SQ BKSP; `--help` lists the controls.

Artifact `padcode-0.1.0-rc.5.tgz`, npm SHA-1 `c251906b5ce14725924bffad4d567fbcd0a44509` (includes the Player Hub order change from PR #20). Native helpers unchanged. H1-H3 are pending.
