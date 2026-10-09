# Fix: Player Hub jumps between centre and left

Status: planned. This plan, its acceptance criteria and test matrix are committed before implementation.

## Request

Reported by the maintainer on 2026-10-09: the Player Hub is drawn centred, while everything printed in the terminal (the shell, the launch confirmation, setup and voice settings) is left-aligned. Starting a session or leaving Padcode therefore moves the interface from the centre back to the left every time. The maintainer asked for this to be fixed.

## Findings

- `renderHub` (UI-1) caps the Hub at 78 columns and adds a left margin of half the remaining width, so in a terminal wider than 79 columns the Hub is centred.
- Inline screens (`TerminalPrompt`) are left-aligned at column 0 and wrap at `min(72, columns - 1)`, so even their right edge differs from the Hub's 78.
- Centring the inline screens instead is not workable: they scroll with the terminal, wrap text through the terminal, and `ask` uses the terminal's own line editing.
- Controller Lab is already left-aligned.

## Design

1. The Hub is left-aligned: no margin, starting at column 0 like the shell and the inline screens.
2. One content width for both: `contentWidth(columns) = max(12, min(78, columns - 1))` in `src/tui/caps.ts`, used by the Hub and by `TerminalPrompt`, so frames and rules end at the same column when moving between them.
3. Nothing else changes: layout variants, wording and input are untouched.

## Automated acceptance

- A1: at 100 and 120 columns the Hub's first line starts at column 0; no line has leading padding added by the Hub.
- A2: `contentWidth` gives 12 at tiny widths, `columns - 1` up to 79 columns and 78 above; the Hub frame and the inline banner have the same width at 80, 100 and 120 columns.
- A3: Hub snapshots at 100x40 and 120x40 are regenerated (left-aligned); all other snapshots unchanged; Hub, onboarding and agent PTY suites pass.
- A4: `npm run check` passes with no skipped tests.

## Manual acceptance

In a terminal wider than 80 columns: open `padcode`, start a session and cancel, open Edit configuration, open Controller Lab, exit; the Hub and the inline screens share the same left edge and frame width.

## Validation record

Pending.
