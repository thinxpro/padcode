# Product design

## Goal

Let developers use a gamepad to operate their chosen AI coding agent in their existing terminal and project. Reduce repetitive keyboard actions and explore a more comfortable development workflow.

The tool handles input and session connectivity. Users choose the agent, authenticate, configure models and decide development tasks. Starting Padcode does not automatically submit a request, modify code or approve agent actions.

## User-provided environment

- Computer, terminal and project directory.
- An installed coding agent CLI that works independently.
- The agent's required accounts, authentication and network access.
- A supported controller; DualShock 4 is the first validation target.
- Optionally, an existing dictation tool or external transcription service.

## First use

1. Start the tool in a project directory.
2. Default to Bluetooth setup: list/scan devices in terminal, explicitly select the controller, pair/connect and verify a real button press. USB is an alternative; deferred verification is labeled unverified.
3. Discover candidate agent commands on PATH, showing only commands actually found, or accept a custom executable path and arguments.
4. Confirm the command and working directory, then choose a key profile.
5. Review and save configuration in terminal. The current build enters Player Hub here; process launch is part of the future PTY stage.
6. Forward the native terminal interface, with controller and keyboard input sharing one session.
7. Restore the terminal when the agent exits and return a clear exit status.

Finding a command does not establish authentication, compatibility or usability. Padcode does not install agents or collect their credentials.

## Daily use

- `padcode`: setup on first launch, Player Hub thereafter; agent session launch is future work.
- `padcode config`: configure the agent command, key profile and controller options.
- `padcode doctor` (planned): check executables, controller, TTY, helpers and platform support without printing credentials or full environment values.
- A dedicated tool chord will pause/resume mapping. Choose it after physical testing to avoid conflicts with exit actions.

## Initial key profile concept

| Control | Generic session mode |
| --- | --- |
| D-pad | Arrow keys |
| × | Enter |
| ○ | Escape |
| L1 / R1 | Configurable Tab / Shift+Tab |
| Sticks | Reserved until scrolling behavior is validated |
| Tool chord | Pause/resume mapping |

Enter and Escape are terminal inputs, not universal "Approve" or "Stop" actions. Do not assign exit, commit or push to easily triggered single buttons in the initial release.

Sticks need deadzones, response curves and repeat limits. Submission keys trigger on press edges to prevent repeated submissions during holds. Clear held state on disconnect.

## Control scopes

### Session mode: initial release

Send input to the PTY started by Padcode, independently of OS window focus. Supporting multiple terminal products does not imply every terminal feature works; publish support based on the validation matrix.

### Desktop mode: optional future work

Send mouse movement, scrolling and shortcuts to the active desktop. This needs platform-specific implementation and permissions, explicit mode indication and switching rules. Never duplicate one input to both desktop and PTY.

## Non-goals

- Building a coding agent or choosing a default model service for users.
- Providing accounts, API keys, model credits, hosted projects or cloud tasks.
- Building an editor, terminal emulator, review GUI or embedded browser in the initial release.
- Recording prompts, code or full terminal output, or uploading telemetry by default.
- Promising complete compatibility with every CLI, platform or controller.

## Experience validation

The user should independently launch their chosen agent, enter a request by keyboard or existing dictation tool, operate menus and submit with the controller, inspect native output, continue and exit normally. Evaluate connection/setup steps, accidental actions, display issues and actual comfort.
