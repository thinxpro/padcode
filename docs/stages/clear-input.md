# Controls menu: Clear input

Status: planned. This plan is committed before runtime changes. Stacked on PR #18 (`fix/mic-start-watchdog`); retarget after the stack merges.

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

Pending.
