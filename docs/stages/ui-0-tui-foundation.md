# UI-0: Terminal UI foundation

Status: implemented; automated acceptance passes locally, manual display review pending. This plan, its acceptance criteria and test matrix were committed before implementation.

## Request

The core features are in place; the CLI looks adequate but not polished. The user asked for a complete visual overhaul of the interactive CLI, starting with a welcome screen that draws a logo in the terminal like other modern tools. The user confirmed (2026-10-08):

1. Interface chrome uses Unicode (box drawing, block elements, status symbols) instead of ASCII only.
2. The logo is a block-letter `PADCODE` wordmark in the "ANSI Shadow" style.
3. The welcome screen plays a short light-sweep animation.
4. The welcome screen and Player Hub are one screen.
5. The product keeps the name Padcode.

## Program

The overhaul ships as one PR per stage, each with its own plan under `docs/stages/`:

| Stage | Scope |
| --- | --- |
| UI-0 (this stage) | Shared terminal UI layer in `src/tui/`, capability detection, snapshot tests and a component gallery. No visible change to existing screens. |
| UI-1 | Welcome screen merged with Player Hub (full screen, logo, sweep), restyled `--help`. |
| UI-2 | Setup wizard (stepper, cards, consistent status symbols). |
| UI-3 | Controller Lab (drawn controller, stick and trigger visuals). |
| UI-4 | Session status pane and controls popup. |

## Findings

- Styling is scattered: raw SGR sequences (`\x1b[1;96m` and similar) appear in `ui.ts`, `prompt.ts`, `panel.ts`, `pane-menu.ts`, `controller-map.ts` and `onboarding.ts`. There is no shared palette, component or layout code, so screens drift apart.
- Chrome text is forced to ASCII through `safeLabel`, chosen earlier so widths stay deterministic in CJK terminals. Box-drawing, block and geometric characters are East Asian *ambiguous* width: most terminals draw them one column wide, but a terminal set to "ambiguous characters are double width" draws them two columns wide and breaks frames.
- `text-width.ts` already measures CJK, full-width and emoji widths; it does not understand ANSI sequences.
- The project has no runtime dependencies. Its input stack (raw-mode prompts, gamepad menu feed, tmux panes, PTY forwarding) is custom, so a React-style framework such as Ink would fight it.

## Design

A small dependency-free layer in `src/tui/`. Components are pure functions from data plus capabilities to strings, so they are easy to snapshot. Callers keep sanitising untrusted text (`safeLabel`, `safeText`) before passing it in.

1. **Capabilities (`caps.ts`).** `detectCaps(env, stream)` returns `{ color, unicode, motion, width, height }`.
   - `color`: `0` (none), `16`, `256` or `24` (truecolor). None when the stream is not a TTY, `NO_COLOR` is set, `TERM=dumb` or `FORCE_COLOR=0`. Truecolor when `COLORTERM` is `truecolor` or `24bit`; 256 when `TERM` contains `256color`; otherwise 16.
   - `unicode`: true unless `PADCODE_ASCII` is set to a value other than `0`, `TERM` is `dumb` or `linux`, or the effective locale (`LC_ALL`, then `LC_CTYPE`, then `LANG`) is set and is not UTF-8. Unicode is the default, per the user's decision; `PADCODE_ASCII=1` is the documented escape hatch for terminals that draw ambiguous-width characters double wide.
   - `motion`: true only with a TTY, colour, no `CI`, no `PADCODE_NO_ANIM`.
   - `width` / `height`: from the stream, falling back to 80 x 24.
2. **Theme (`theme.ts`).** Semantic tones: `brand`, `accent`, `ok`, `warn`, `danger`, `info`, `text`, `muted`. Each tone has an RGB value, a 256-colour index and a 16-colour SGR code; `paint(caps, text, style)` picks the right one and adds bold, dim or inverse. `gradient(caps, text, from, to, offset?)` colours each visible column along a cyan-to-magenta ramp (truecolor and 256-colour), falling back to the brand tone with 16 colours and to plain text without colour. The ramp keeps the current brand look (bright cyan with magenta highlights).
3. **ANSI-aware text (`text.ts`).** `stripAnsi`, `visibleWidth` (uses `charWidth`), `truncate(text, width, ellipsis?)` that keeps escape sequences and closes them with a reset, `padEnd`, `padStart`, `center` and `wrapAnsi` built on visible width.
4. **Frames (`box.ts`).** Border sets `round` (`╭╮╰╯─│├┤`), `heavy` and `ascii` (`+-|`). `frame(rows, { width, caps, title?, tone?, padding? })` draws a box of exactly `width` columns; a title sits in the top border; a `DIVIDER` row draws `├──┤`; content is truncated or padded to fit. `rule(width, caps, label?)` draws a horizontal rule with an optional label. Without Unicode every set falls back to `ascii`.
5. **Widgets (`widgets.ts`).**
   - `keycap(label, caps, tone?)`: inverse padded label with colour, `[label]` without colour.
   - `dot(state, caps)`: status symbol for `ok`, `warn`, `off`, `error`, `active` (`●`, `▲`, `○`, `✕`, `◆`; ASCII `*`, `!`, `o`, `x`, `+`), coloured by state.
   - `stepper(current, total, caps)`: `●●○○○` / `##---`.
   - `meter(fraction, width, caps, tone?)`: block meter with eighth blocks (`█▉▊▋▌▍▎▏`) / `#` and `.`.
   - `hintBar(items, width, caps)`: `keycap + label` pairs fitted by priority (earlier items survive narrower widths), the controller-console footer used by later stages.
   - `columns(left, right, width, gap?)`: places two blocks side by side when both fit, otherwise stacks them.
6. **Screen (`screen.ts`).** `Screen` owns a full-screen view on a TTY: `enter()` switches to the alternate screen and hides the cursor; `draw(lines)` repaints from home and clears leftovers; `leave()` shows the cursor and restores the main screen. `leave()` is idempotent and also runs on process `exit`, so a crash or signal never leaves the terminal hidden. On a non-TTY, `enter`/`leave` write nothing and `draw` prints plain lines once per call.
7. **Gallery (`scripts/tui-gallery.mjs`).** `npm run gallery` renders every component at the current terminal size and capabilities, for manual review in real terminals. It respects `NO_COLOR`, `PADCODE_ASCII` and `COLUMNS`.

Existing screens do not change in UI-0. Later stages migrate them onto this layer and remove the scattered SGR codes.

## Automated acceptance

- A1 Capabilities: colour depth for TTY/non-TTY, `NO_COLOR`, `FORCE_COLOR=0`, `TERM=dumb`, `COLORTERM`, `256color`; Unicode for UTF-8, non-UTF-8 and unset locales, `LC_ALL` precedence, `PADCODE_ASCII`, `TERM=linux`; motion with `CI` and `PADCODE_NO_ANIM`; size fallback.
- A2 Theme: every tone emits the right SGR form at 16, 256 and 24-bit depth and nothing at depth 0; gradient emits per-column colours at 24/256, a single tone at 16, plain text at 0, and its visible text equals its input.
- A3 Text: `stripAnsi`, `visibleWidth` with ANSI, Korean, kana and emoji fixtures (no Chinese, per repository rules); `truncate` never splits a wide character, never exceeds the width, keeps styles and closes them; padding and centering reach the exact width; `wrapAnsi` lines never exceed the width.
- A4 Frames: every line of a frame has visible width exactly `width` for widths 4 to 120, with titles, dividers, wide characters and overlong rows; ASCII mode contains only printable ASCII; colour 0 contains no escape sequences.
- A5 Widgets: each widget in colour, monochrome and ASCII; meter extremes and clamping (below 0, above 1, NaN); `hintBar` never exceeds the width and drops the latest items first; `columns` side by side and stacked.
- A6 Screen: on a fake TTY, enter/draw/leave emit alternate-screen, cursor and clear sequences in order, `leave` runs once even when called twice and on `exit`; on a non-TTY no control sequences are written.
- A7 Snapshots: golden files under `test/snapshots/tui/` cover the gallery at widths 40, 60, 80 and 120 in truecolor, monochrome and ASCII. SGR sequences are stored in a readable escaped form. `UPDATE_SNAPSHOTS=1` regenerates them; otherwise any difference fails the test.
- A8 Existing suites pass unchanged; `npm run check` passes with no skipped tests.

## Manual acceptance

Display review, not hardware: run `npm run gallery` and confirm that frames close and line up, colours are readable on dark and light themes, and ASCII and `NO_COLOR` output are clean in Terminal.app, iTerm2, Ghostty, the VS Code terminal and inside tmux, at 40 columns and at full width. Record the terminal versions and anything that misrenders. No controller is involved in UI-0.

## Implementation notes

- `truncate` holds escape sequences until a visible character follows, so a cut never leaves an empty styled span (the first gallery snapshot caught one).
- Callers' own styling and user data pass through frames unchanged: in ASCII mode only the chrome is ASCII, and a row of Korean, kana and emoji keeps its characters and width.
- The gradient is a cyan-magenta-cyan triangle, so moving `offset` from 0 to 1 sweeps across and wraps without a jump; UI-1 uses it for the welcome sweep.
- `npm run gallery` builds and prints the gallery; piping it (non-TTY) prints monochrome output.

## Validation record

Plan commit: `4ff8059`. On macOS 27.0.1 arm64 with Node 24.21.0, `npm run check` passed 172 tests (17 new in `test/tui.test.mjs`) with zero failures or skips; `src/tui/` has 100% line coverage. CI is disabled by the maintainer's decision, so Linux was not exercised.

- A1-A6: covered by `test/tui.test.mjs` as listed above.
- A7: twelve golden files in `test/snapshots/tui/` (40/60/80/120 columns x truecolor/monochrome/ASCII).
- A8: all existing suites pass unchanged; no existing screen imports `src/tui/` yet.

On 2026-10-08 the maintainer approved continuing to UI-1 after this stage was presented; no per-terminal display results were reported, so the terminal-by-terminal review stays open.
