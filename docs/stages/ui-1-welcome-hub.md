# UI-1: Welcome screen and Player Hub

Status: planned. This plan, its acceptance criteria and test matrix are committed before implementation.

Stacked on [UI-0](ui-0-tui-foundation.md) (`feature/tui-foundation`, PR #25), which is not merged yet. This PR targets that branch and is retargeted to `main` after UI-0 merges.

## Request

Running `padcode` should open a welcome screen with a terminal-drawn logo, like other modern CLI tools. The maintainer chose (2026-10-08): Unicode chrome, the "ANSI Shadow" block-letter wordmark, a short light-sweep animation, and one screen for the welcome and Player Hub. `--help` gets the same treatment.

## Findings

- The Hub (`hubStep` in `onboarding.ts`) prints a banner and five status lines with `TerminalPrompt.say`, then an inline `choose` menu. Every return to the Hub appends another copy below the previous output.
- `TerminalPrompt.choose` owns keyboard handling (arrows, digits + Enter, Escape, `q`, Ctrl+C/D) and gamepad actions (up, down, confirm, cancel) plus live gamepad status. The full-screen Hub needs the same input rules, so that logic is shared rather than copied.
- Menu input from the gamepad is up/down/confirm/cancel only, so the Hub menu stays a vertical list.
- PTY tests wait for `PLAYER HUB`, `GAMEPAD READY`, the inline `Select [n]` marker and the notices `SESSION OVER / ...`, `LAUNCH CANCELLED`, `VOICE ON / ...`, `VOICE UNCHANGED`, `VOICE OFF`.
- The setup flow, launch confirmation, voice settings and Controller Lab stay inline and are out of scope (UI-2 and UI-3).

## Design

1. **Logo (`src/tui/logo.ts`).** Three variants chosen by width and capabilities:
   - `full`: six-line ANSI Shadow `PADCODE` (57 columns, Unicode only);
   - `ascii`: five-line figlet-style `PADCODE` (42 columns, printable ASCII) for ASCII terminals, or when the full logo does not fit;
   - `wordmark`: one line `P A D C O D E` for narrow terminals.
   Coloured with the brand gradient. `logo(caps, width, shine?)` returns the lines; `shine` (0..1) places a white highlight band for the sweep.
2. **Gradient shine.** `gradient` takes an options object (`ramp`, `offset`, `bold`, `shine`). The shine band blends each column toward white by distance from its position; with 16 colours the band is bold bright white over the brand colour.
3. **Full-screen menu (`TerminalPrompt.screen`).** `choose` and the new `screen` share one input loop (keyboard and gamepad rules unchanged). `screen` draws on the alternate screen through `Screen`, repaints on every change and on resize, and always leaves the alternate screen before resolving or rejecting. Differences from `choose`: a digit moves the cursor to that item immediately (Enter confirms); an invalid number flashes a hint instead of printing a line.
4. **Intro sweep.** On the first Hub frame of a process, when `caps.motion` is true, the logo sweep runs for about 700 ms at about 30 frames per second, then settles on the static gradient. Any key or gamepad action ends it at once; input is never delayed or dropped. No sweep with `NO_COLOR`, non-TTY, `CI` or `PADCODE_NO_ANIM`, and none on later returns to the Hub.
5. **Hub view (`src/hub-view.ts`).** A pure `renderHub(model, view)` returning screen lines:
   - header frame titled `PLAYER HUB` with the logo, the tagline `YOUR CONTROLLER. YOUR AGENT.` and the version;
   - status card: `PLAYER 1` (controller name and link), `INPUT` (setup check passed / unverified, never claimed as live), `AGENT` (command name), `VOICE` (microphone, transcription, hold key, or off), two columns when wide, stacked when narrow;
   - optional notice line (session result, cancelled launch, voice change), coloured by kind;
   - menu with a `MENU n/total` rule, numbered items, a highlighted current item and a dim detail per item;
   - footer: hint bar with the controller's button names, then the live gamepad status with a status dot.
   Layout degrades by height and width: full logo, then ASCII logo, then wordmark; details and the tip line drop before menu items; under 40 columns the frames are omitted. Content is centred up to 78 columns wide.
6. **Help.** `help(caps)` prints the logo (ASCII or wordmark when piped or narrow), then `COMMANDS`, `IN A SESSION`, `OPTIONS` and `ENVIRONMENT` sections (the last documents `NO_COLOR`, `PADCODE_ASCII`, `PADCODE_NO_ANIM`). Piped output is plain ASCII text as before, so scripts and the package smoke test keep working.
7. **Version.** `src/version.ts` reads the package version once for `--version`, the Hub and help.

## Automated acceptance

- B1 Logo: each variant's lines have equal width; `full` is used only with Unicode and at least 57 columns; `ascii` output is printable ASCII; `wordmark` fits 13 columns; monochrome output has no escape sequences; visible text is the same with any shine position.
- B2 Shine: the highlight band changes colours near its position only; it wraps at 0 and 1; 16-colour and monochrome fallbacks.
- B3 Screen menu: arrows, digits, Enter, Escape, `q`, Ctrl+C, invalid numbers, gamepad up/down/confirm/cancel and status updates behave as in `choose`; the alternate screen is left on every exit path; resize repaints.
- B4 Sweep: plays only with motion on the first Hub frame, stops on input, never on later frames; frame timers are cleared on every exit path.
- B5 Hub view: snapshots at 40x24, 60x24, 80x24, 80x30, 100x40 and 120x40 in truecolor, monochrome and ASCII; every line fits the width and the frame fits the height; notices, unverified input, missing agent, voice on/off, long names (truncated with an ellipsis) and Korean/kana/emoji device names.
- B6 Help: snapshots for colour, monochrome and ASCII; piped output stays plain ASCII and lists every command.
- B7 PTY: the Hub navigation, Hub agent and onboarding PTY suites pass with Hub steps migrated to the new screen; the terminal mode is restored after every exit.
- B8 `npm run check` passes with no skipped tests.

## Manual acceptance

Display review, not hardware: run `padcode` in Terminal.app, iTerm2, Ghostty, the VS Code terminal and tmux; check the sweep, the logo at full width and at 60 and 40 columns, `NO_COLOR=1`, `PADCODE_ASCII=1`, and that returning from a session, Controller Lab and the demo redraws the Hub cleanly. Hub navigation with the DualShock 4 (D-pad, X, O) is a hardware check and is recorded separately.

## Validation record

Pending.
