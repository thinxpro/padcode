# Changelog

All notable changes to Padcode are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each published version gets one entry.

## [Unreleased]

## [0.1.0-rc.10] - 2026-10-14

First public release candidate, published to npm under the `next` tag: `npm install -g padcode-cli@next` (the npm package is `padcode-cli`; the command is `padcode`). macOS 13 or later (Apple silicon and Intel), Node.js 22.14 or later. It collects these private development builds, each documented in [`docs/stages`](docs/stages):

### Added

- Scripted README demo: `npm run demo` plays it, `npm run demo:record` re-records `docs/media/demo.gif` with VHS. It uses real Padcode screens with a labeled virtual controller and a stand-in Agent.
- Controller Lab: live view of every button, stick, trigger and touchpad, with simulated `demo` mode and `controllers --json` events (`0.1.0-dev.0`).
- Bluetooth-first setup for macOS, with controller-operated menus and a saved Agent loadout (`dev.1`–`dev.5`).
- Agent sessions in a bounded PTY with controller-to-key mapping, keyboard pass-through, pause and disconnect protection (`dev.6`–`dev.8`).
- tmux controls pane with status, an Options menu (resume, pause, history, interrupt, end session) and a Player Hub reachable from every screen (`dev.9`–`dev.13`).
- Opt-in voice: hold L2 to record, local transcription with macOS on-device speech, whisper.cpp or a custom command, and insertion into the Agent input with undo (`dev.14`–`rc.2`).
- Clear input from the controls menu (`rc.3`).
- Stick cursor editing: left stick moves, right stick jumps by word and line, face buttons edit (`rc.5`).
- Controller map popup, sized to the terminal (`rc.6`, `rc.7`).
- Controller families: DualSense, Xbox, Nintendo Switch Pro and other SDL gamepads are detected and shown with their own button names (`rc.8`).
- Redesigned terminal interface: welcome screen, Player Hub, setup wizard, Controller Lab and session pane, with `NO_COLOR`, `PADCODE_ASCII` and narrow-terminal support (`rc.9`).
- Quick commands on Share/View and `@` on the touchpad, and a Codex controller profile (`rc.10`).

[Unreleased]: https://github.com/thinxpro/padcode/compare/v0.1.0-rc.10...HEAD
[0.1.0-rc.10]: https://github.com/thinxpro/padcode/releases/tag/v0.1.0-rc.10
