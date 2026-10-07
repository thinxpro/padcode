# C5: Local transcription and draft review

Status: implemented in dev.18; automated acceptance passes locally and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #15 (`feature/microphone-capture`, C4); retarget after its prerequisites merge.

## Scope

Turn an L2 recording into a text draft and let the controller review it: keep, rerecord or discard. The draft stays outside the Agent: inserting it and submitting are C6. No network transcription provider.

### Plan revision: three transcription tiers (decided 2026-10-07, before runtime code)

The first draft only supported a user-configured command, with no model download by Padcode. The user asked how other people would use voice once Padcode is open source: finding, installing and wiring a transcriber and a 0.5-1.6 GB model is a barrier most users would not pass. Revised scope, approved by the user:

1. **macOS on-device speech (default, nothing to install).** `padcode-audio transcribe` uses Apple's Speech framework (`SFSpeechRecognizer`) with `requiresOnDeviceRecognition`; if the language has no on-device model it reports "unsupported" and never falls back to network recognition. Adds punctuation (macOS 13+). Requires the macOS Speech Recognition permission for Padcode Audio (`NSSpeechRecognitionUsageDescription`). Apple's newer SpeechAnalyzer API is Swift-only and is left for a later stage.
2. **whisper.cpp (guided, better accuracy).** Padcode detects `whisper-cli`; when it is missing it shows the install command (`brew install whisper-cpp`) and never installs it. Models can be downloaded **only after explicit confirmation** that shows source, size and destination, from pinned official URLs (`huggingface.co/ggerganov/whisper.cpp`) with pinned SHA-256 values; the file is written as `.part`, verified, then renamed, under `$XDG_DATA_HOME/padcode/models` or `~/.local/share/padcode/models`. Offered: `ggml-large-v3-turbo-q5_0.bin` (574 MB, default) and `ggml-large-v3-turbo.bin` (1.6 GB). Existing models in known folders are detected and used without downloading. This replaces the earlier "no model download" rule with "no download without explicit consent and verification"; nothing is bundled in the npm package.
3. **Custom command (advanced).** Any executable reading the WAV and printing text, as specified below.

## Command transcriber contract (tiers 2 and 3)

- Configured as an executable (absolute path, resolved like Agent commands) plus literal arguments, never a shell string. Arguments may contain `{audio}` (required, at least once) and `{language}`, replaced by the recording path and the configured language before spawning.
- Input: the C4 recording, mono 16 kHz signed 16-bit PCM WAV.
- Output: UTF-8 text on stdout. Exit status 0 means success; any other status, a spawn error, invalid UTF-8, more than 64 KiB of stdout or more than 120 seconds is a failure. stderr is read (bounded to 4 KiB) only for a sanitized one-line failure reason.
- Text cleanup: CRLF to LF, tabs to spaces, every other C0/C1 control character and DEL removed (including ESC and bracketed-paste markers), leading/trailing whitespace trimmed per line, blank-line runs collapsed, the whole text trimmed. Ordinary Unicode is preserved. Empty text is reported as "no speech recognized".
- Jobs run one at a time with a generation; a result for an older recording, a cancelled job, a disconnect, Agent exit or session end is discarded. Cancelling kills the process (SIGTERM, then SIGKILL after 1 second). The recording is deleted after transcription unless it is the last recording kept for playback.

## Configuration

`voice.transcriber: null | { kind: 'system', language } | { kind: 'command', command, args, language }` is added to configuration version 2 (missing means null, so existing files stay valid). `language` is `auto` or a 2-3 letter code; default `zh`. The system tier maps `zh` to `zh-CN`, `en` to `en-US`, other codes to their locale, and `auto` to the current system locale.

The voice settings flow (Player Hub "Voice / microphone settings" and the config wizard step) gains a transcription step after the microphone:

- Keep current / macOS on-device speech / whisper.cpp / Custom command / No transcription (record and play back only), then the language (Chinese, English, auto, or a code).
- macOS on-device speech: checks on-device support for the language and requests Speech Recognition permission.
- whisper.cpp: finds `whisper-cli` (PATH and Homebrew), lists detected models (Padcode's model folder, `~/.local/share/whisper.cpp`, `~/.cache/whisper.cpp`, `~/models`, Homebrew `share/whisper-cpp`) and the pinned downloads, and builds `whisper-cli -m MODEL -l {language} -nt -np -f {audio}`. Download shows progress, can be cancelled with O/Esc/Ctrl+C, and removes partial files on failure or checksum mismatch.
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

- C5-A0: system tier: `padcode-audio transcribe --language L --file F` contract (JSON result, unsupported language without network fallback, permission states) with the real helper where the OS allows, and parsing/failure paths with a fake helper.
- C5-A1: command transcriber runner: valid, empty, Unicode (CJK, emoji), oversize, control/escape/paste-marker, CRLF output; invalid UTF-8; nonzero exit with stderr reason; spawn error; timeout; cancellation (process killed); placeholder substitution without a shell (arguments containing `;`, `$()`, spaces stay literal).
- C5-A2: job lifecycle: one job, late results after cancel/disconnect/session end/new recording discarded, recordings removed, no zombie processes.
- C5-A3: configuration validation and migration (missing transcriber, both kinds, invalid placeholders, invalid language), whisper.cpp detection with fake executables/models, consented download against a local test server (progress, cancel, checksum mismatch, partial-file cleanup, refusal without consent), custom command entry, self-test pass/fail paths, disclosure text.
- C5-A4: session end to end with fake helper and fake transcriber in tmux: record -> TRANSCRIBING -> draft popup with the exact cleaned text -> keep/rerecord/discard via controller and keyboard -> reopen from the menu; zero Agent bytes throughout; O cancels transcription; disconnect during transcription discards it.
- C5-A5: `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance (C5-H)

- C5-H1: configure macOS on-device speech (language `zh`) and, separately, whisper.cpp (`whisper-cli`, `ggml-large-v3-turbo`, language `zh`) through Voice settings; both self-tests pass; compare accuracy and latency.
- C5-H2: in a Claude Code session, dictate several Chinese and mixed Chinese/English requests with the DS4; review correct drafts; rerecord and discard with the controller.
- C5-H3: record transcription time for typical clips on this Mac; confirm no network use by Padcode and record whisper.cpp's behavior (local inference).

## Implementation notes

- Download cancellation: the plan said O, Esc or Ctrl+C cancel a model download. No menu reads keys while the download streams, so only Ctrl+C (which aborts setup) cancels it; the partial file is removed. Declining the consent prompt is the controller-friendly way to avoid a download.
- whisper.cpp detection is injectable through `SetupServices.whisper` so tests never pick up a real `whisper-cli` or model on the developer's machine.
- The draft popup is wider than the controls menu and is reopened when switching between the two. Its body is a bounded preview (2400 UTF-8 bytes plus a "+N more characters" line) so each popup message fits one IPC line; the full draft stays in the coordinator. Text wrapping counts CJK and emoji as two columns.
- A draft that finishes while the controls menu is open is offered as "Review voice draft" in the menu instead of interrupting it.

## Validation record

Plan commits: `14464ef` (first draft) and `93e11b9` (three-tier revision). On macOS 27.0.1 arm64 with Node 24.21.0 and tmux 3.7c, `npm run check` passed 128 tests with zero failures or skips.

- C5-A0/A1: `test/transcribe.test.mjs` covers cleanup, the command runner (literal argv with `;`, `$()` and spaces, Unicode, control and paste markers, CRLF, empty, oversize, invalid UTF-8, nonzero exit, spawn error, timeout, cancellation with the process gone), the macOS tier through a fake helper and, on macOS, the real helper's unsupported-language and permission paths.
- C5-A2: `test/draft.test.mjs` covers record -> transcribe -> draft, empty/failed/cancelled/late results, speech permission request, and the draft review context for every button, keyboard picks, reopening from the menu and drafts that arrive while the menu is open.
- C5-A3: configuration validation, whisper.cpp detection, consented download against a local server (progress, redirect, checksum, size limit, HTTP error, abort, no partial files), and all setup tiers (macOS speech with permission, whisper.cpp found/declined/failed download/not installed, custom command, placeholder validation, self-test failure).
- C5-A4: `test/panel_pty.py` `draft()` runs L2 -> TRANSCRIBING -> VOICE DRAFT with the cleaned Chinese text in a real tmux popup, keeps, reopens, discards with the popup keyboard, and cancels a slow transcriber with O (process gone); zero Agent bytes throughout.
- Real-tool smoke test: macOS `say` produced a Chinese sentence converted to 16 kHz WAV; Padcode's runner with Homebrew whisper-cpp 1.8 and `ggml-large-v3-turbo.bin` (downloaded from the pinned URL, SHA-256 verified) returned `请帮我修复登录页面的Book,然后运行测试。` in 6.9 s including model load ("bug" was the synthetic voice's pronunciation). No microphone was used.

Artifact `padcode-0.1.0-dev.18.tgz`, npm SHA-1 `c23ab1a320fd7971a2fbf7593a1a028192e60bd7`. C5-H1 to C5-H3 are pending physical testing.

### Try-it after keeping the microphone (dev.19)

User report (2026-10-07): in Voice settings, after "Keep microphone" and macOS on-device speech, choosing "Record 5 seconds and show the text" printed `TRY FAILED: Microphone access has not been granted to Padcode Audio yet.` and returned straight to Player Hub. Cause: only the "Choose a microphone" path checked microphone access; the rebuilt dev.18 helper had lost its macOS grant, and the try offered no retry. Fix: a shared `microphoneReady` check runs on the keep path and before every try recording (requesting access when not determined, with guidance when denied), and the try step repeats as "Try again" / "Done" until the user finishes. `test/draft.test.mjs` covers both. `npm run check` passed 128 tests with zero failures or skips. Artifact `padcode-0.1.0-dev.19.tgz`, npm SHA-1 `e4e9565247a56d6565ff5308761ccd7d7c8af667`. The native helper is byte-identical to dev.18, so a grant made now carries over.

### Unicode in terminal menus (dev.20)

User report (2026-10-07): both macOS on-device speech and whisper.cpp showed `HEARD  ????????????` in Voice settings. Transcription worked (the number of `?` matched the spoken characters); `TerminalPrompt` replaced every non-ASCII character with `?` (an early rule for predictable column widths), which also garbled Unicode device names such as `Studio Display麦克风`. Fix: terminal prompts use `safeText`, which keeps Unicode but removes C0/C1 controls, bidi override/isolate characters and lone surrogates, and wrap by display columns (CJK and emoji count as two). Status lines, the controls pane and Controller Lab keep the ASCII `safeLabel`. Tests: `ui.test.mjs` (safeText) and the text-entry PTY test now types and expects `literal 帮我修复 🎮`. `npm run check` passed 128 tests with zero failures or skips. Artifact `padcode-0.1.0-dev.20.tgz`, npm SHA-1 `11f8530783f3a2fdecf6c77b5afabdec9e095db8`; native helpers unchanged from dev.18.
