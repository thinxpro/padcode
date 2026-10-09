# UI-2: Setup wizard and inline prompts

Status: implemented; automated acceptance passes locally; maintainer accepted the display. This plan, its acceptance criteria and test matrix were committed before implementation.

Stacked on [UI-1](ui-1-welcome-hub.md) (`feature/welcome-hub`, PR #26), which is stacked on UI-0 (PR #25); neither is merged yet. This PR targets `feature/welcome-hub` and is retargeted after its prerequisites merge.

## Request

Third stage of the interface overhaul requested by the maintainer: the setup wizard (`padcode` first run and `padcode config`) should match the new welcome screen: a step indicator, clear section headers and consistent status symbols. The maintainer accepted UI-1 on 2026-10-08 and asked to continue.

## Findings

- Setup is a long, mostly linear flow with live progress (Bluetooth scan, pairing, input check, microphone check, model download), keyboard text fields (custom command, arguments, language code) and recovery menus. A scrolling log suits it better than a full screen: progress and results stay visible, and keyboard text entry keeps the terminal's native line editing.
- Everything the wizard shows goes through three `TerminalPrompt` primitives: `banner(title)`, `say(text)` and `choose(message, choices)`, plus `ask` for text. The launch confirmation (`MISSION START`), Hub voice settings and transcription setup use the same primitives, so restyling them restyles every inline screen at once without touching flow logic.
- Messages already follow conventions: `TAG  value` key-value lines (`PRIVACY  ...`, `LINK    ...`), `TAG / text` lines (`DISPLAY / Controls pane ...`), progress lines ending in `...`, and outcomes containing `PASSED`, `COMPLETE`, `NOT READY`, `NOT VERIFIED` or `FAILED`.
- Banner titles carry the step number (`MISSION 02 / INPUT CHECK`); the total is 6 with voice support (macOS) and 5 without.
- PTY tests match literal strings such as `Select [n]`, `Choose one of the displayed numbers.`, `MISSION 05 / VOICE (optional)`, `VOICE / TRANSCRIPTION`, `DISPLAY / Controls pane`, `Audio stays on this Mac` and `VOICE   off`, and require zero escape bytes with `TERM=dumb`. The onboarding PTY's colour check looks for the old 16-colour code `\x1b[1;96m`, which the theme no longer emits at 256 colours.

## Design

1. **Banner.** `banner(title, progress?)` draws a framed header (title `PADCODE`): the title on the left and, when `progress` (`[current, total]`) is given, a stepper `●●○○○○ 2/6` on the right. Setup passes progress to its mission banners; other banners (launch confirmation, voice settings, transcription) have no stepper. The title text is kept verbatim.
2. **Messages.** `say(text)` classifies each message and renders it with a status symbol and tone, word-wrapped with a hanging indent:
   - error (`NOT READY`, `NOT VERIFIED`, `FAILED`, `STOPPED`): `✕`, danger;
   - success (`PASSED`, `COMPLETE`, `Bluetooth connected`): `●`, ok;
   - warning (`UNVERIFIED`, `NOTE`, `start PAUSED`): `▲`, warn;
   - progress (ends in `...`, or `DOWNLOAD n%`): `◆`, accent; `DOWNLOAD n%` also shows a block meter;
   - `TAG  value` lines (two or more spaces): the tag column is highlighted and the value aligned after it;
   - everything else: plain text, indented.
   Each recognised phrase stays one contiguous run of text (one style per span), so log searches and tests keep matching. An empty message prints a blank line.
3. **Menus.** `choose` renders the question with a `◆` marker, items as `▶ 1  label` (current, highlighted) or `  2  label`, splits a label at its first ` / ` into a bright main part and a dim detail, then the live gamepad status with a status dot and the existing `> Select [n] (q to cancel):` line. Input behaviour is unchanged (UI-1 shares the loop).
4. **Text input.** `ask` shows the keyboard hint with a `KEYBOARD` key cap and a highlighted prompt; behaviour unchanged.
5. **Capabilities.** `TerminalPrompt` uses `detectCaps` (colour depth, Unicode, width) instead of the old boolean colour switch. `TERM=dumb` and `NO_COLOR` produce no escape sequences; non-UTF-8 locales and `PADCODE_ASCII=1` use ASCII symbols and frames.

Out of scope: wording and order of setup steps, Controller Lab (UI-3), the session pane and popup (UI-4).

## Automated acceptance

- C1 Banner: framed at the prompt width; stepper for `[2, 6]`, `[6, 6]`, `[1, 5]`; no stepper without progress; ASCII and monochrome variants; long titles truncate; title text contiguous.
- C2 Messages: each kind gets its symbol and tone; `TAG  value` alignment; hanging-indent wrapping never exceeds the width; Korean, kana and emoji keep their characters; download meter; `TERM=dumb` output has no escape bytes; empty messages print a blank line.
- C3 Menus: selected marker and highlight; label detail split; status dot; `Select [n]` line unchanged; snapshots in truecolor, monochrome and ASCII.
- C4 Setup passes progress `[n, 6]` with voice support and `[n, 5]` without, matching the mission numbers in the titles.
- C5 PTY: onboarding, Hub navigation, Hub agent, agent and voice-related suites pass. The onboarding colour check is updated to look for a theme colour sequence instead of the retired `\x1b[1;96m` (documented reason: the palette moved to theme tokens in UI-0).
- C6 `npm run check` passes with no skipped tests.

## Manual acceptance

Display review, not hardware: run `padcode config` through every step (Bluetooth scan can be skipped with USB or "later"), the launch confirmation and Hub voice settings in a colour terminal, with `NO_COLOR=1` and with `PADCODE_ASCII=1`, at full width and about 50 columns. The physical controller flow itself is unchanged and needs no new hardware evidence beyond the existing setup acceptance.

## Implementation notes

- Rendering lives in `src/prompt-view.ts` as pure functions (`renderBanner`, `renderMessage`, `renderMenu`, `selectLine`, `askHint`, `askPrompt`); `TerminalPrompt` only picks capabilities and writes. The old `wrapText`/`colorEnabled` path in the prompt is gone.
- When the title and the stepper do not fit on one row (about 50 columns and below), the stepper moves to a second row instead of truncating the title, so `MISSION nn / ...` stays searchable.
- Messages and menus wrap on words (`wrapAnsi`) with hanging indents; the inline menu still counts its physical rows for redraw, and every rendered line stays within the prompt width (tested down to 12 columns).
- `TAG / text` lines (`DISPLAY / Controls pane ...`) are rendered as one span, so the phrase stays contiguous; only `TAG  value` lines (two or more spaces) get a separate tag colour.
- The download meter appears only when at least four columns are free after the text.
- `onboarding_pty.py`'s colour check now looks for a 256-colour or truecolor sequence; the reason (palette moved to theme tokens in UI-0) is recorded in the test.

## Validation record

Plan commit: `38c32f7`. On macOS 27.0.1 arm64 with Node 24.21.0, `npm run check` passed 186 tests with zero failures or skips; `src/prompt-view.ts` has 100% line and branch coverage. CI is disabled by the maintainer's decision, so Linux was not exercised.

- C1-C3: `test/prompt-view.test.mjs`, with snapshots `test/snapshots/prompt/wizard-{truecolor,mono,ascii}-{44,72}.txt`.
- C4: `test/onboarding.test.mjs` checks progress `[n, 5]` without voice support and `[n, 6]` with it, matching each mission number.
- C5: onboarding, Hub navigation, Hub agent, agent session (including `agent_pty.py`), voice, draft and panel suites pass; `TERM=dumb` still produces no escape bytes.

### Maintainer review

On 2026-10-08 the maintainer ran setup with this styling (first from the `ui` worktree, then from a local test build) and reported "界面没问题" (the interface is fine). No terminal-by-terminal or `NO_COLOR` / `PADCODE_ASCII` results were given.
