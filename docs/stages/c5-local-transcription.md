# C5: Local transcription and draft review

Status: planned. This plan is committed before runtime changes. Stacked on PR #15 (`feature/microphone-capture`, C4); retarget after its prerequisites merge.

## Scope

Turn an L2 recording into a text draft with a transcription command the user installed, and let the controller review it: keep, rerecord or discard. The draft stays outside the Agent: inserting it and submitting are C6. No network provider, no model download or installation by Padcode.

## Transcriber contract

- Configured as an executable (absolute path, resolved like Agent commands) plus literal arguments, never a shell string. Arguments may contain `{audio}` (required, at least once) and `{language}`, replaced by the recording path and the configured language before spawning.
- Input: the C4 recording, mono 16 kHz signed 16-bit PCM WAV.
- Output: UTF-8 text on stdout. Exit status 0 means success; any other status, a spawn error, invalid UTF-8, more than 64 KiB of stdout or more than 120 seconds is a failure. stderr is read (bounded to 4 KiB) only for a sanitized one-line failure reason.
- Text cleanup: CRLF to LF, tabs to spaces, every other C0/C1 control character and DEL removed (including ESC and bracketed-paste markers), leading/trailing whitespace trimmed per line, blank-line runs collapsed, the whole text trimmed. Ordinary Unicode is preserved. Empty text is reported as "no speech recognized".
- Jobs run one at a time with a generation; a result for an older recording, a cancelled job, a disconnect, Agent exit or session end is discarded. Cancelling kills the process (SIGTERM, then SIGKILL after 1 second). The recording is deleted after transcription unless it is the last recording kept for playback.

## Configuration

`voice.transcriber: null | { command, args, language }` is added to configuration version 2 (missing means null, so existing files stay valid). `language` is `auto` or a 2-3 letter code; default `zh`.

The voice settings flow (Player Hub "Voice / microphone settings" and the config wizard step) gains a transcription step after the microphone:

- Keep current / Turn transcription off / Use whisper.cpp / Custom command.
- "Use whisper.cpp" is offered when `whisper-cli` is on PATH and at least one `ggml-*.bin` model exists in `~/.local/share/whisper.cpp`, `~/models`, `~/.cache/whisper.cpp` or Homebrew's `share/whisper-cpp`. It proposes `whisper-cli -m MODEL -l {language} -nt -np -f {audio}`. Padcode never downloads models; without one it prints where to put one.
- Custom: executable, then arguments one per line; `{audio}` is required.
- Disclosure before enabling: the command runs on this Mac with the recording file; Padcode sends audio nowhere, but what the configured program does (including any network use) is up to that program.
- Self-test before saving: run the command on a generated one-second silent 16 kHz WAV with the full contract (timeout, cap, UTF-8). Failure explains why and offers retry or turning transcription off. Optionally transcribe the microphone check recording to show a real result.

## Session flow (controls-pane mode)

record (L2) -> `TRANSCRIBING... / O cancel` -> draft review popup.

- Draft review popup "VOICE DRAFT" shows the text (wrapped; long drafts are shortened with a "+N more characters" line) and actions: **Keep draft** (default; returns to the Agent), **Rerecord** (discards the draft and waits for L2), **Discard**. D-pad/X/O and keyboard work as in the controls menu; O equals Keep draft. Closing applies the neutral barrier.
- The kept draft can be reopened from the controls menu ("Review voice draft"). One draft exists at a time; a new transcription replaces it after review.
- Without a transcriber the C4 behavior (record and play back) is unchanged.
- Zero Agent PTY writes happen during recording, transcription or review. Drafts are never written to logs, traces or files other than the transient recording.

## Automated acceptance

- C5-A1: transcriber runner: valid, empty, Unicode (CJK, emoji), oversize, control/escape/paste-marker, CRLF output; invalid UTF-8; nonzero exit with stderr reason; spawn error; timeout; cancellation (process killed); placeholder substitution without a shell (arguments containing `;`, `$()`, spaces stay literal).
- C5-A2: job lifecycle: one job, late results after cancel/disconnect/session end/new recording discarded, recordings removed, no zombie processes.
- C5-A3: configuration validation and migration (missing transcriber, invalid placeholders, invalid language), whisper.cpp detection with fake executables/models, custom command entry, self-test pass/fail paths, disclosure text.
- C5-A4: session end to end with fake helper and fake transcriber in tmux: record -> TRANSCRIBING -> draft popup with the exact cleaned text -> keep/rerecord/discard via controller and keyboard -> reopen from the menu; zero Agent bytes throughout; O cancels transcription; disconnect during transcription discards it.
- C5-A5: `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance (C5-H)

- C5-H1: configure whisper.cpp (`whisper-cli`, `ggml-large-v3-turbo`, language `zh`) through Voice settings; the self-test passes.
- C5-H2: in a Claude Code session, dictate several Chinese and mixed Chinese/English requests with the DS4; review correct drafts; rerecord and discard with the controller.
- C5-H3: record transcription time for typical clips on this Mac; confirm no network use by Padcode and record whisper.cpp's behavior (local inference).

## Validation record

Pending.
