# P0-1 · Controller Lab

Status: implementation planned; acceptance pending. This plan is committed before implementation.

## Task and boundary

Deliver a runnable developer build that reads SDL3 controller input and displays it in a game-console-style terminal dashboard. This is the input-validation tool needed before PTY/Agent integration. It does not launch agents, inject desktop input, save user data or install globally.

Commands planned for this task:

- `padcode` / `padcode --help`: show the game-styled command hub and available commands.
- `padcode controllers`: live controller dashboard, requires a TTY and compiled helper.
- `padcode controllers --json`: versioned JSONL events for diagnostics, suitable for pipes.
- `padcode demo`: clearly labeled synthetic dashboard preview, requires no hardware.
- `padcode --version`: package version.

## Implementation plan

1. TypeScript CLI, pinned development dependencies, reproducible lockfile, Node test runner and strict type checking. Use no runtime npm dependencies for this stage.
2. C++ SDL3 helper built by CMake against a pinned SDL release and verified source checksum. Developer build may require compiler/CMake; consumer binary distribution is P1.
3. Versioned JSONL handshake and events: ready, connected, disconnected, button and axis. Each event has sequence and monotonic timestamp; device events include instance ID. Escape untrusted device names and bound parser input.
4. Input state reducer ignores duplicate button edges, applies configurable-in-code stick deadzone, clears held state on disconnect and selects devices deterministically. No keyboard injection in this task.
5. ANSI dashboard with cyan/magenta arcade styling, connection state, controller diagram, pressed-button state, axis meters and compact event feed. UI redraws at a capped rate; no terminal output goes to disk. NO_COLOR/TERM=dumb and narrow layouts supported.
6. Clean helper and terminal lifecycle on keyboard quit, Ctrl+C, SIGTERM, helper error, protocol violation or output stream closure. Restore cursor/raw mode/alternate screen where used.
7. Unit tests, CLI subprocess tests, actual SDL virtual-device integration, native build and CI on macOS. Linux test runner support may be exercised but does not imply Linux physical hardware support.

## Acceptance matrix (fixed before code)

| ID | Acceptance | Evidence |
| --- | --- | --- |
| A1 | Fresh checkout can install dev deps, type-check and compile CLI/helper using documented prerequisites | build + CI |
| A2 | Help/version/unknown command have deterministic output and correct exit codes; no hardware is opened for help/demo | CLI integration |
| A3 | Parser rejects invalid JSON/schema/version, non-monotonic sequence, oversized or incomplete records, and handles split UTF-8 chunks | unit + failure integration |
| A4 | Button duplicates do not create repeated edges; deadzone suppresses drift; disconnect clears button/axis state; other devices cannot overwrite selected device | unit |
| A5 | Actual SDL virtual device produces connection, press/release, axes and removal through the production event serializer | native integration, explicitly virtual |
| A6 | Dashboard supports 80-column and narrow terminals, plain/NO_COLOR mode, sanitized device names, and bounded event history | renderer/unit + captured PTY preview |
| A7 | Quit/signals/helper failure restore terminal and reap owned helper; malformed protocol fails clearly; JSON mode emits no styling | subprocess + real PTY lifecycle tests |
| A8 | USB DualShock 4 shows every main button press/release and axes correctly; neutral axes settle; no repeated edges from holds | user physical checklist |
| A9 | Three unplug/replug cycles clear held state and reconnect; background input works; no stuck state or crash over 10 minutes | user physical checklist |
| A10 | All automated checks pass; hardware evidence is recorded; no skipped required checks | validation report + CI |

## Automated gate

`npm ci`, then `npm run check`: strict TypeScript checks, CLI build, native build, all unit/integration/PTY/SDL virtual-device tests. Native tests must fail rather than silently skip when helper is missing. Unit coverage report must be generated and inspected for untested input/error/lifecycle branches; coverage percentage alone is not an acceptance substitute.

Tests must use synthetic device names and inputs; no user Agent or project content is required. No actual Coding Agent is launched during this stage.

## Physical test procedure

After automated checks pass, provide user with exact checkout and start commands. Use a USB data cable. Record macOS version, CPU, terminal name/version, controller model and connection mode.

1. Press and release D-pad directions, cross/circle/square/triangle, L1/R1, L3/R3, Share and Options; record any missing or wrong labels. PS/touchpad support is observed separately, not assumed.
2. Move both sticks to extremes and back to center, squeeze/release L2/R2. Verify axes and neutral deadzone.
3. Hold cross for five seconds, release; verify one down and one up transition.
4. Hold a button, unplug; verify all state clears. Reconnect and repeat three times.
5. Focus another app, operate the controller, return and confirm events were received.
6. Use for ten minutes. Quit with Q and Ctrl+C in separate runs; verify terminal remains usable.

If the physical device is unavailable, complete all independent work and open a **draft** PR with the specific pending criteria. Do not mark P0-1 complete or the PR ready until A8/A9 pass.

## PR and next stage

Branch: `feature/controller-lab`; target: `main`. Plan commit precedes code commits. The next separate task/PR is P0-2 (PTY bridge), with its own plan and acceptance matrix written before code.
