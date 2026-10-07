# C4: Microphone setup and capture

Status: planned. This plan is committed before runtime changes. Stacked on PR #14 (`feature/session-controls`, C3); retarget to `main` after #14 merges.

## Scope

Opt-in microphone configuration and bounded push-to-talk recording, with playback for inspection. No transcription and no text reaches the Agent in this stage (C5/C6).

Out of scope: transcription, drafts, insertion, network providers, the DualShock 4 headset microphone, Linux capture, transparent-mode capture.

## Platform and helper

- New macOS helper `padcode-audio` (Objective-C, CoreAudio + AVFoundation), built only on Apple platforms. Linux builds omit it; Padcode reports "Voice capture currently requires macOS" and keeps voice off.
- Like `padcode-bluetooth`, it embeds an Info.plist (`com.thinxpro.padcode.audio`, `NSMicrophoneUsageDescription`) and re-executes itself with disclaimed responsibility, so the macOS microphone prompt and the Privacy & Security entry name Padcode Audio instead of the terminal. If ownership cannot be established, it refuses to touch the microphone.
- Commands (JSON lines on stdout):
  - `list`: input devices from CoreAudio (`id` = device UID, `name`, `default`). Needs no permission.
  - `permission` / `request`: microphone authorization status (`authorized`, `denied`, `restricted`, `not-determined`); `request` shows the system prompt once.
  - `record --out PATH [--device UID] [--max-seconds N]`: events `started`, `level {peak}` about every 100 ms, then `stopped {seconds, bytes}`, `cancelled` or `error {code, message}` with codes `permission-denied`, `permission-required`, `no-device`, `device-lost`, `io`. stdin `stop` / `cancel` lines control it; SIGTERM or stdin EOF cancels. Recording requires `authorized`.
  - `record --synthetic`: the same protocol and WAV writer fed by a generated tone, for automated tests without a microphone. It is never used by the product and never counts as hardware evidence.
  - `diagnose`: usage metadata and permission-owner check, without touching the microphone.
- Output: mono 16 kHz signed 16-bit PCM WAV, created with `O_EXCL | O_NOFOLLOW`, mode 0600. Cancel, errors and device loss write no file.

## Configuration

- Config version 2 adds `voice: null | { microphone: { id, name } }`. Version 1 files load as version 2 with `voice: null`; the next save writes version 2. Invalid voice data is rejected like other invalid settings, without resetting the file.
- Setup gains an optional MISSION step "VOICE (optional)", defaulting to "Keep voice off". Choosing a microphone shows the disclosure before enabling capture: device name, capture backend (macOS AVAudioEngine), that audio stays on this Mac in a private temporary folder, and that transcription is not available yet. It then checks permission (requesting it if needed, with an actionable message when denied), lists devices, and offers a 3-second test recording played back with `afplay`.
- Voice is enabled only when a microphone is configured and the platform supports capture.

## Session behavior (controls-pane mode)

- Hold L2 to record; release to stop. Trigger hysteresis: start at 0.65, stop below 0.35, with 150 ms debounce between state changes. Recording stops at 60 seconds.
- While recording, controller input is captured (a Recording context): O cancels and discards; other buttons do nothing; nothing reaches the Agent. After the recording ends, the C1 neutral barrier applies before Agent routing resumes.
- The status pane shows `REC 00:03` with a level meter, then `RECORDED 3.2s / Options > Play last recording`, `CANCELLED`, or the error.
- Only one recording exists at a time. A new recording replaces the previous file. The controls menu gains "Play last recording" when one exists (playback with `afplay`; the menu waits for playback to end or O to stop it).
- Disconnect, helper loss, Agent exit, End session and Ctrl+] cancel an active recording. Recordings live in a per-session mode-0700 directory removed when the session ends. On startup, Padcode removes stale `pcv-*` directories in the temporary directory that are real directories (not symlinks), owned by the current user, mode 0700, and whose recorded owner process is gone.
- Recordings, levels and device UIDs are never written to traces or logs.

## Automated acceptance

- C4-A1: trigger handling: jitter around both thresholds, 150 ms debounce, rapid L2 presses, held trigger at session start (no recording until released), the 60-second cap (with an injectable clock), and O cancel.
- C4-A2: one job at a time; a new press while stopping is ignored; replacing a previous recording deletes it.
- C4-A3: permission `denied`, `restricted`, `not-determined`, no device, device removal during capture, helper spawn failure and helper crash give actionable statuses and leave no files.
- C4-A4: disconnect, Agent exit, End session, Ctrl+] and SIGTERM during capture cancel it; the session directory is removed; stale-directory recovery skips symlinks, foreign owners, wrong modes and live owners.
- C4-A5: the native helper's synthetic recording produces a valid 16 kHz mono 16-bit WAV with mode 0600, refuses existing paths and symlinks, stops on `stop`, writes nothing on `cancel`, EOF or SIGTERM; `diagnose` reports usage metadata and self-responsibility on macOS. `list` returns well-formed JSON.
- C4-A6: configuration v1 -> v2 migration, voice validation, setup voice step (keep off, choose device, permission denied, no devices, Linux unsupported) and the Hub/session flows with a fake audio helper.
- C4-A7: no Agent bytes are written while recording or during playback; all existing suites pass; `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance (C4-H)

- C4-H1: select a real Mac microphone in setup; grant permission; the prompt names Padcode Audio. Test recording plays back clearly.
- C4-H2: in a session, make 10 L2 recordings of varied length and play each back; the start is not clipped and the status indicator matches.
- C4-H3: cancel with O during recording; disconnect the controller during recording; both discard the recording.
- C4-H4: confirm the L2 thresholds feel right on the DS4; record any adjustment request.

## Validation record

Pending.
