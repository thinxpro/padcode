# Roadmap and acceptance

The current priority is [Bluetooth-first terminal setup](stages/p0-config-bluetooth.md), built on P0-1 Controller Lab. Check items only after their full acceptance criteria pass; simulated tests do not replace physical validation.

## P0: Technical validation

### P0-1: Controller input

- [ ] Record the actual Mac model, CPU, OS version, controller model and transport.
- [ ] Read DualShock 4 Bluetooth buttons and axes through SDL3; retain USB as an alternative.
- [ ] Verify background events, reconnection, deadzones and press/release behavior.
- [ ] Identify required permissions when no system-wide mouse control is used.

Acceptance: sustained use and repeated reconnections produce no stuck keys, repeated submissions or crashes; event logs explain state changes.

### P0-2: Transparent terminal forwarding

- [ ] Validate node-pty launching a user-configured executable and arguments.
- [ ] Forward keyboard/Unicode input, output, colors, window resizing and exit status.
- [ ] Test TUI cursor-position queries, alternate screen and control characters.
- [ ] Test exit, signals, exceptions and child cleanup.
- [ ] Confirm a prebuilt native distribution route; change the PTY implementation if it fails this requirement.

Acceptance: core interactions work in at least two terminals with two user-provided CLIs. The terminal remains usable after exceptional exits, with no orphaned helper. Record exact versions and limitations.

### P0-3: Minimal controller development workflow

- [ ] Route controller input to the PTY independently of foreground window focus.
- [ ] Let users select or customize the command.
- [ ] Support arrows, Enter and Escape while keeping keyboard input available.
- [ ] Stop injection when mapping is paused; never replay stale actions on resume.

Acceptance: in a test project, the user can start, enter a request, submit, read output, continue and exit. Observe accidental actions and terminal failures. Finish P0 with a validation record and a decision on entering P1.

## P1: Installable personal-use release

- [ ] CLI entry point, setup, schema validation and configuration migrations.
- [ ] `config` and `doctor` commands.
- [ ] Native packaging and clean-environment installation.
- [ ] Clear missing-device, missing-command and helper-failure feedback.
- [ ] Key configuration and reconnection recovery.
- [ ] Installation, usage, upgrade and uninstall documentation.

Acceptance: installation follows the documentation on a fresh environment without build tools; users complete the basic flow with their own agent. Private artifacts may validate this stage before public npm publication.

## P2: Compatibility and interaction improvements

- [ ] Validate additional controllers; Bluetooth stability was moved into the first stage.
- [ ] Agent-specific profiles and version records.
- [ ] Optional desktop mode with explicit switching and permission guidance.
- [ ] Optional external voice interface with user-selected transcription tools.
- [ ] Evaluate structured adapters against real needs.
- [ ] Validate Windows/Linux feasibility and platform artifacts.

## P3: Public release

Complete the [release checklist](distribution.md#public-release-checklist), then let the maintainer decide when to go public. Publish npm, Homebrew and installation scripts as needed; all three channels are not an initial release gate.

## Testing strategy

Unit tests cover edges, deduplication, deadzones, mode transitions and configuration validation. PTY integration tests use controlled children to check data, resize, exit and cleanup. Physical tests cover controllers and actual CLI/TUI combinations. Mocks alone do not support compatibility claims.

## Initial development sequence

Build the minimal CLI and SDL3 helper for P0-1, then connect the PTY for P0-2/P0-3, with the user-prioritized onboarding stage in between. Do not start with a plugin marketplace, voice models or desktop UI.
