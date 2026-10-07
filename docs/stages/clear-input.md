# Controls menu: Clear input

Status: implemented in 0.1.0-rc.3; automated acceptance passes and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #18 (`fix/mic-start-watchdog`); retarget after the stack merges.

## Request

The user asked for an Options menu item that clears the Agent's current input box.

## Behavior

- New controls-menu item **Clear input** (after Send interrupt). It sends Ctrl+E (end of line) then Ctrl+U (delete the line) to the Agent through the controller input path, then closes the menu with the usual neutral barrier.
- Padcode cannot see the Agent's input, so this is a key sequence, not a semantic action. Ctrl+E Ctrl+U clears a single-line input in readline-style editors, including Claude Code's prompt; a multi-line input may keep its other lines. Ctrl+C and double Esc are not used: in Claude Code a second Ctrl+C on an empty input exits, and double Esc on an empty input opens message history.
- Like any other Agent input after a voice insertion, clearing makes Undo voice insert unavailable.
- Transparent mode has no controls menu and is unchanged.

## Automated acceptance

- A1: the context matrix and menu-order tests include Clear input; choosing it emits exactly `\x05\x15` once and closes the menu.
- A2: end to end in tmux: the Agent receives exactly `\x05\x15` and nothing else; Undo voice insert after Clear input is refused.
- A3: `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance

- H1: in Claude Code, type or dictate a one-line request, choose Options > Clear input; the input box is empty and nothing is sent.
- H2: report what happens with a multi-line input.

## Validation record

Plan commit: `5d28e07`. `npm run check` passed 133 tests with zero failures or skips on macOS 27.0.1 arm64. A1: the context matrix and menu tests include Clear input (exactly one `clear` effect, then close); voice items now sit just before End session regardless of how many base items exist. A2: `panel_pty.py` `controls()` asserts the Agent receives exactly `\x05\x15`, and `insert()` asserts Undo voice insert is refused after Clear input. Artifact `padcode-0.1.0-rc.3.tgz`, npm SHA-1 `1073503e215abb03fa58fe8c65090b9ab15e9c4b`. H1 and H2 are pending.

### User-reported physical acceptance

On 2026-10-07 the user reported that Clear input passed in Claude Code with 0.1.0-rc.3 (H1). The multi-line case (H2) was not reported separately and remains open.

### 0.1.0-rc.4

Same features as rc.3 plus the controls-menu crash fix found by Ubuntu CI (see the C5 stage record) and test synchronization fixes across the stack. All six open PRs (#14-#19) passed macOS and Ubuntu CI after the fixes. Artifact `padcode-0.1.0-rc.4.tgz`, npm SHA-1 `e2a7d270834c3b609379b9bd966b6ab3627b0834`; native helpers unchanged from rc.2.
