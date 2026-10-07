# Padcode

Control your own AI coding agent with a gamepad.

Padcode is a local developer tool designed for terminal installation. You choose your terminal, project, agent and accounts. Padcode provides controller input, key mapping, terminal session bridging and optional agent integrations.

**Current status: private release candidate `0.1.0-rc.1` for macOS.** The full controller flow works end to end with a user-provided Agent (tested with Claude Code): Bluetooth setup, controller-operated menus, launching the Agent with automatic controller handoff, a tmux controls pane with an Options menu, and opt-in voice dictation that types into the Agent's input. Each stage's automated tests pass; physical acceptance so far rests on the maintainer's reports recorded in [`docs/stages`](docs/stages). npm publication, Developer ID signing and Linux/Windows controller support are not done. Padcode is a provisional name.

## What you can do with a controller

| Where | Controls |
| --- | --- |
| Player Hub and setup | D-pad moves, X confirms, O goes back. Every screen returns to the Hub. |
| Agent session | D-pad arrows, X Enter, O Escape, L1 Tab, R1 Shift+Tab. Keyboard always works too. |
| Options (with tmux) | Controls menu: resume, pause, browse history, send interrupt (Esc), voice undo/review, end session. |
| L2 (macOS, opt-in) | Hold to dictate, release to transcribe. The text is typed into the Agent's input and **never sent**; X sends it. Options > Undo voice insert removes it. |

Voice transcription runs on your Mac: macOS on-device speech needs nothing installed; whisper.cpp (`brew install whisper-cpp`) is more accurate, and Padcode can download a pinned, checksum-verified model after you confirm; any command that prints text also works. Padcode never sends audio anywhere.

## Run the development build

Development prerequisites: Node.js 22.14+ (Node 22 LTS recommended), npm, CMake 3.24+ and a C/C++ compiler; use Xcode/Command Line Tools on macOS. The full test suite also needs Python 3 and `pgrep`. These are developer requirements; installation without build tools is a P1 release requirement.

```sh
npm ci --ignore-scripts
npm run check
node dist/cli.js demo
node dist/cli.js
```

The first native build downloads checksum-pinned SDL source from its official GitHub release and requires network access. `demo` is explicitly simulated; `controllers` shows real device state. Q / Esc exits the dashboard; Ctrl+C interrupts. `controllers --json` emits pipe-friendly events. The interface supports narrow terminals, `NO_COLOR` and `TERM=dumb`, and waits for a connection when no controller is present.

Bluetooth discovery keeps known paired/connected controllers visible, even when no nearby device is discovered.

A uniquely identity-matched saved controller can operate menus directly: D-pad up/down, X to confirm and O to go back/cancel. During initial setup or when identity is ambiguous, D-pad navigates and claims control, or X claims without confirming. Keyboard input remains available, and custom command text still uses the keyboard.

Interactive startup without arguments opens setup, or the Player Hub if configuration exists. `padcode config` reconfigures, and Player Hub > Voice / microphone settings changes only voice. Configuration lives at `$XDG_CONFIG_HOME/padcode/config.json` when that variable is an absolute path, otherwise `~/.config/padcode/config.json`. Saving configuration never launches an Agent; Start agent session (or `padcode run`) shows the executable, literal arguments and project directory before you confirm. With tmux 3.2+ installed the session runs in a private tmux server with a status pane; Padcode never installs tmux, and `PADCODE_PANEL=off` keeps the plain transparent mode (Options then pauses/resumes). Ctrl+] always ends the session. `PADCODE_INPUT_TRACE=1` prints metadata-only routing diagnostics. Padcode does not collect credentials or record session content.

See the [terminal setup guide](docs/setup.md) for the complete flow and macOS permission boundaries, and the [Bluetooth acceptance report](docs/stages/p0-config-validation.md) for physical test status.

## Install a local npm test package

After building and testing locally, create a package for the current platform. No npm publishing account is needed:

```sh
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
npm install -g ./artifacts/padcode-0.1.0-rc.1.tgz
padcode
```

The package includes compiled helpers and runs no compilation scripts during installation. It only supports the build machine's OS/CPU combination; it is not a published universal package. CI tests equivalent installation and onboarding in a temporary directory without modifying the user's global installation.

## Product boundaries

- Install and launch through a CLI; no standalone desktop app or DMG.
- Bring and authenticate your own AI coding agent; select an installed command or provide a custom command.
- Preserve the selected agent's terminal interface, with keyboard and controller input available together.
- No model service, account system, prompt proxy, cloud execution or hosted code service.
- Keep configuration and tool records local. The selected agent determines its own networking, model billing and data handling.
- Voice input is optional and local (macOS). Desktop control is a possible future extension.

## Intended experience

The following illustrates the target experience. **Do not use these as current installation instructions:**

```sh
npm install -g padcode
cd my-project
padcode
```

First launch: detect a controller → select a local agent or custom command → select a key profile → start a session.

Currently, `padcode` provides setup and the Player Hub, and `padcode config` is implemented. `padcode run` starts the configured Agent after confirmation. `padcode doctor` remains future work.

## Initial release scope

The initial target is macOS with a DualShock 4 over Bluetooth and one foreground terminal session. USB is an alternative. Generic mode will launch a user-provided interactive CLI, map basic controller inputs to terminal keys and preserve keyboard input. Physical controller support on Windows/Linux will only be claimed after platform-specific validation.

No coding agent is bundled, and no vendor API is mandatory. Structured agent adapters, global mouse control, multiple sessions and background residency are deferred. Voice is opt-in, macOS-only and local.

The [continuous controller sessions and voice](docs/stages/p0-4-continuous-controller-and-voice.md) stages C1-C6 are implemented. Remaining before a public release: Developer ID signing (development builds re-ask for microphone access after each update), installation without build tools, Codex and second-terminal compatibility records, and the maintainer's release decision.

## Design documents

| Document | Contents |
| --- | --- |
| [Product](docs/product.md) | User flow, scope and interaction constraints |
| [Architecture](docs/architecture.md) | CLI, SDL3, PTY, input routing and process lifecycle |
| [Agent integration](docs/agent-integration.md) | Generic mode, key profiles and optional structured adapters |
| [Distribution](docs/distribution.md) | npm, native artifacts, Homebrew/curl and public release preparation |
| [Roadmap and acceptance](docs/roadmap.md) | Stages, validation methods and completion criteria |
| [Decisions](docs/decisions.md) | Confirmed and provisional decisions |
| [Contributing](CONTRIBUTING.md) | Development scope, PRs and test evidence |

## Development workflow

The current [Bluetooth-first onboarding stage](docs/stages/p0-config-bluetooth.md) builds on Controller Lab. The [P0-2 PTY session bridge](docs/stages/p0-2-pty-session.md) now provides keyboard forwarding. The [P0-3 gamepad mapping stage](docs/stages/p0-3-gamepad-agent-input.md) adds basic controller keys, pause and disconnect protection. Real-agent/terminal compatibility and new physical acceptance remain pending. Submit each task through a PR; all automated checks and required physical acceptance must pass before marking an implementation PR ready.

Repository content, commit messages and PR titles/descriptions must be in English.

Licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
