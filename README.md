# Padcode

Control your own AI coding agent with a gamepad.

Padcode is a local developer tool designed for terminal installation. You choose your terminal, project, agent and accounts. Padcode provides controller input, key mapping, terminal session bridging and optional agent integrations.

**Current status: Bluetooth-first terminal onboarding development build; physical controller acceptance is pending.** First-run setup, local configuration, macOS Bluetooth discovery/pairing/connection, SDL input verification and a game-style dashboard are implemented. Agent sessions and npm registry publication are not implemented. The repository is private; public release requires validation and a maintainer decision. Padcode is a provisional name; npm and Homebrew name availability has not been confirmed.

## Run the development build

Development prerequisites: Node.js 22.14+ (Node 22 LTS recommended), npm, CMake 3.24+ and a C/C++ compiler; use Xcode/Command Line Tools on macOS. The full test suite also needs Python 3 and `pgrep`. These are developer requirements; installation without build tools is a P1 release requirement.

```sh
npm ci --ignore-scripts
npm run check
node dist/cli.js demo
node dist/cli.js
```

The first native build downloads checksum-pinned SDL source from its official GitHub release and requires network access. `demo` is explicitly simulated; `controllers` shows real device state. Q / Esc exits the dashboard; Ctrl+C interrupts. `controllers --json` emits pipe-friendly events. The interface supports narrow terminals, `NO_COLOR` and `TERM=dumb`, and waits for a connection when no controller is present.

Interactive startup without arguments opens setup, or the Player Hub if configuration exists. Use `node dist/cli.js config` to reconfigure. Configuration lives at `$XDG_CONFIG_HOME/padcode/config.json` when that variable is an absolute path, otherwise `~/.config/padcode/config.json`. The current build only saves the selected agent command and arguments; it does not launch the agent or collect credentials.

See the [terminal setup guide](docs/setup.md) for the complete flow and macOS permission boundaries, and the [Bluetooth acceptance report](docs/stages/p0-config-validation.md) for physical test status.

## Install a local npm test package

After building and testing locally, create a package for the current platform. No npm publishing account is needed:

```sh
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
npm install -g ./artifacts/padcode-0.1.0-dev.3.tgz
padcode
```

The package includes compiled helpers and runs no compilation scripts during installation. It only supports the build machine's OS/CPU combination; it is not a published universal package. CI tests equivalent installation and onboarding in a temporary directory without modifying the user's global installation.

## Product boundaries

- Install and launch through a CLI; no standalone desktop app or DMG.
- Bring and authenticate your own AI coding agent; select an installed command or provide a custom command.
- Preserve the selected agent's terminal interface, with keyboard and controller input available together.
- No model service, account system, prompt proxy, cloud execution or hosted code service.
- Keep configuration and tool records local. The selected agent determines its own networking, model billing and data handling.
- Voice input and desktop control are optional future extensions.

## Intended experience

The following illustrates the target experience. **Do not use these as current installation instructions:**

```sh
npm install -g padcode
cd my-project
padcode
```

First launch: detect a controller → select a local agent or custom command → select a key profile → start a session.

Currently, `padcode` provides setup and the Player Hub, and `padcode config` is implemented. Agent session launch and `padcode doctor` remain future work.

## Initial release scope

The initial target is macOS with a DualShock 4 over Bluetooth and one foreground terminal session. USB is an alternative. Generic mode will launch a user-provided interactive CLI, map basic controller inputs to terminal keys and preserve keyboard input. Physical controller support on Windows/Linux will only be claimed after platform-specific validation.

No coding agent is bundled, and no vendor API is mandatory. Structured agent adapters, voice, global mouse control, multiple sessions and background residency are deferred.

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

The current [Bluetooth-first onboarding stage](docs/stages/p0-config-bluetooth.md) builds on Controller Lab. The next separate task is P0-2, the PTY session bridge. Commit its plan and acceptance criteria before implementation. Submit each task through a PR; all automated checks and required physical acceptance must pass before marking an implementation PR ready.

Repository content, commit messages and PR titles/descriptions must be in English.

Licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
