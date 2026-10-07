# C6: Voice insertion and release candidate

Status: implemented in 0.1.0-rc.1; automated acceptance passes locally and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #16 (`feature/local-transcription`, C5); retarget after its prerequisites merge.

## Plan revision: insert automatically (decided 2026-10-07, before runtime code)

The P0-4 plan required the user to inspect each draft and confirm that the Agent's composer is focused before insertion. The user rejected that as too conservative: voice is opt-in and dictation is an explicit act, so a finished transcript should go straight into the input box, with menu actions to undo, rerecord or review. This plan adopts that, keeps every other P0-4 voice rule, and adds the safeguards below because a generic PTY still cannot tell a composer from an approval dialog that appears while a clip is being transcribed.

## Behavior

- **Automatic insertion (default).** When transcription succeeds, the text is written into the Agent's input as typed text. It is never followed by Enter: submitting stays a separate, fresh X or Enter from the user.
- **One line.** Line breaks in the transcript become spaces, so no inserted byte can act as Enter even if the Agent has not enabled bracketed paste. When the Agent has enabled bracketed paste (`CSI ? 2004 h`, tracked from its own output by the PTY bridge), the text is wrapped in paste markers; the cleaned transcript cannot contain ESC, so it cannot end the paste early.
- **Short-answer guard.** Transcripts of two or fewer characters, or made only of digits, punctuation, whitespace and y/n, open the VOICE DRAFT popup instead of being inserted, because a single key like `1` or `y` could answer an approval prompt that appeared during transcription.
- **Review mode (optional).** Voice settings offer "Insert automatically" (default) or "Review first". Review first uses the C5 draft popup with an added **Insert into Agent** item.
- **Voice actions in the controls menu** (after an insertion or when a draft exists):
  - **Undo voice insert:** deletes exactly the inserted characters with Backspace. Allowed only while nothing else has reached the Agent since the insertion (keyboard bytes, controller keys or another paste); otherwise the item is shown as unavailable with the reason. The bridge performs the check, so it cannot race with typing.
  - **Rerecord:** Undo (when allowed), then shows "Hold L2 to record again".
  - **Review voice draft:** shows the last text with Insert again / Discard.
  - Editing the inserted text is done in the Agent's own input box with the keyboard.
- Status notice after insertion: `INSERTED 24 chars / X or Enter sends, Options > Undo voice insert`.
- Insertion happens only in Agent context, while the controller is routing or arming, and never during a Padcode menu, history or another recording; a transcript that finishes then waits as a draft and the notice says so.

## Process and IPC

- New coordinator -> agent messages: `paste-part {data}` (UTF-8 chunks bounded by the IPC line limit) and `paste-end`, then `undo {count}`. Agent -> coordinator: `undo-result {ok, reason}`. The bridge writes paste and Backspace bytes through the same bounded `PtyWriter` as keyboard input (not cancellable as controller input), wraps pastes in markers only while bracketed paste is on, and records whether any other input arrived after the last paste.
- Drafts and inserted text are never logged or traced.

## Release candidate

- Update `--help`, README, setup guide and architecture for voice, the controls pane and Player Hub navigation.
- Version `0.1.0-rc.1` private artifact; packaged-install smoke tests include the voice helper and the controls pane.

## Automated acceptance

- C6-A1: insertion bytes: single-line flattening, bracketed vs plain mode, chunked pastes of large CJK/emoji text reassembled exactly, adversarial transcripts (ESC, paste terminators, CR/LF, C1) never produce control bytes other than the paste markers, and never a trailing CR/LF.
- C6-A2: short-answer guard cases (`1`, `y`, `是`, `OK`, `2.` -> popup; normal sentences -> insert) and review mode.
- C6-A3: undo: exact Backspace count for mixed CJK/ASCII/emoji, refused after keyboard input, controller keys or a second paste, refused after the Agent exits; rerecord flow.
- C6-A4: insertion deferred while a menu/history/recording is active; generation changes (new recording, session end, disconnect) discard pending insertions; nothing is inserted after Agent exit.
- C6-A5: end to end in tmux: L2 -> transcript appears in the Agent's input bytes (with paste markers when the fixture enabled bracketed paste) -> no Enter -> Undo removes it -> keyboard typing blocks a later undo.
- C6-A6: packaged-install smoke tests; `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance (C6-H)

- C6-H1: in Claude Code, dictate with L2; the text appears in the input box without being sent; X (Enter) sends it.
- C6-H2: Undo voice insert removes exactly the dictated text; after typing a character, Undo is refused.
- C6-H3: a one-character answer (for example "1") opens the draft popup instead of being inserted.
- C6-H4: launch -> dictate -> send -> read -> interrupt -> exit using only the controller.

## Implementation notes

- Undo availability is decided by the bridge when Undo is chosen; the menu offers the item after any insertion and reports `UNDO UNAVAILABLE / The input changed after the voice insert` when the bridge refuses, instead of predicting it.
- Backspace count is the number of Unicode code points inserted. That matches Claude Code's input for CJK and ASCII; text with multi-code-point emoji may need extra Backspaces and is listed for physical checking.
- Inserted text is chunked into 300-code-point `paste-part` messages and written by the bridge as one paste.

## Validation record

Plan commit: `32b7b58`. On macOS 27.0.1 arm64 with Node 24.21.0 and tmux 3.7c, `npm run check` passed 132 tests with zero failures or skips.

- C6-A1/A2: `test/insert.test.mjs` (one-line flattening of adversarial transcripts, short-answer guard, paste/undo IPC bounds, insertion-mode configuration).
- C6-A3/A4: `test/draft.test.mjs` (draft popup Insert default, keep, rerecord, discard, keyboard picks), settings flows with the insertion-mode step.
- C6-A5: `test/panel_pty.py` `insert()` in real tmux: an Agent with bracketed paste receives exactly `ESC[200~帮我修复登录页面的 bug，然后运行测试。ESC[201~` with no Enter; Undo writes exactly 21 Backspaces; undo is refused after a typed key and after a controller key, writing nothing; a plain Agent receives the multi-line, Unicode transcript as one control-free line; a one-character transcript opens the draft popup and X inserts it. The C5 review flow is covered in review mode.
- One run of `insert()` failed in 16 repetitions without a captured step; every wait in the scenario now names its step, and `menu_pick` waits for the controller to be active before pressing Options.
- C6-A6: packaged-install smoke tests pass as part of the gate.

Release candidate: help text, README, setup guide and architecture updated. Artifact `padcode-0.1.0-rc.1.tgz`, npm SHA-1 `1808e91c92e5b0f97de6b58bb437580b917e7d58`. C6-H1 to C6-H4 are pending physical testing.
