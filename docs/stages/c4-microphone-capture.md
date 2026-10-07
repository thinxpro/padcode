# C4: Microphone setup and capture

Status: implemented in dev.14; automated acceptance passes locally and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #14 (`feature/session-controls`, C3); retarget to `main` after #14 merges.

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

## Implementation notes

- Held-trigger rule: the plan's "held trigger at session start" case is implemented through routing, not a separate arming step. A trigger press that arrives while the controller is not routing to the Agent (C1 arming barrier, pause, menus) is tracked as pressed without recording, so it must be released and pressed again. An earlier draft that required observing the trigger below 0.35 first could miss a fast fresh press, because SDL reports axis changes only.
- `permission.m` now exposes a generic `preparePermissionOwner`; `padcode-bluetooth` behavior is unchanged.
- The macOS 27 SDK deprecates `installTapOnBus:bufferSize:format:block:`; the helper uses the replacement when the SDK and OS provide it and the old call otherwise.
- The setup microphone check and in-session recordings share the `pcv-` directory format with an owner record, so stale recovery covers both.

## Validation record

Plan commit: `91c77ba`. On macOS 27.0 arm64 with Node 24.21.0 and tmux 3.7c, `npm run check` passed 116 tests with zero failures or skips.

- C4-A1 to A4 and A6: `test/voice.test.mjs` (hysteresis, jitter, debounce, held trigger through the barrier, routing guard, one job, replacement, O cancel, helper errors and crashes, late results, playback, stale-directory recovery, v1 -> v2 migration, the setup voice step with a fake helper, and `NativeAudio` parsing).
- C4-A5: the real `padcode-audio` binary's synthetic mode writes a valid 16 kHz mono 16-bit WAV with mode 0600, refuses existing paths and symlinks, cancels on `cancel`, EOF and SIGTERM without leaving files, honors `--max-seconds`; `diagnose` reports self-responsibility and usage metadata, also from the installed package. On Linux the test asserts the helper is absent and voice is unsupported.
- C4-A4/A7 end to end: `test/panel_pty.py` `voice()` records with L2 in a real tmux session through a fake helper, keeps all controller presses away from the Agent while recording, plays back from the controls menu, cancels with O and on disconnect, and removes the mode-0700 session directory when the Agent exits mid-recording.
- `list` on this Mac returned two real input devices; no real microphone recording or permission request was made during automated testing.

Artifact `padcode-0.1.0-dev.14.tgz`, npm SHA-1 `adcdd8f0f4325b4f428260620fb0c20cce88e647`. C4-H1 to C4-H4 are pending physical testing.

### Player Hub voice entry (dev.15)

On 2026-10-07 the user reported that testing was fine but that voice could not be found again after the first setup. The voice step only existed as step 5 of `padcode config`, after re-running the controller link, input check, Agent and loadout steps; the user's saved configuration was still version 1 with voice off, so no voice setting had been saved through the wizard and the in-session L2 checks (C4-H2 to H4) cannot have run with that configuration. Scope addition with this reason: Player Hub gains **Voice / microphone settings**, which runs only the voice step (titled VOICE SETTINGS), saves the result while keeping every other setting, and returns to the Hub; O returns without changes. `test/hub-navigation-pty.py` covers choose, unchanged-on-O and turn-off through the real Hub with a fake helper. `npm run check` passed 116 tests with zero failures or skips. Artifact `padcode-0.1.0-dev.15.tgz`, npm SHA-1 `ea0e740ad3e2a4c01d014a0019cf397fc0d783ea`. C4-H remains pending until voice is configured and tested in a session.

### Bluetooth headset warm-up (dev.16)

User report (2026-10-07): the setup 3-second check played back fine, but recordings made with L2 in a Claude Code session played back silent from the menu. Evidence from the live session folder (statistics only; the audio was not played or kept): `rec-4.wav` was a valid 1.60 s, 16 kHz mono file whose first 1.0 s was entirely digital zeros, followed by a switching transient and low-level noise. The selected default microphone was MOMENTUM 4, a Bluetooth headset (`system_profiler`: Bluetooth transport, 16 kHz input). Opening its microphone switches the headset to its call profile, which delivers zeros for about a second, so short push-to-talk clips lost the speech; the 3-second check still had about 2 s of audio left.

Fix, within the C4 scope ("no clipping at onset"):
- `padcode-audio` drops leading digital silence and emits `live` with the first real sample; the 60-second limit and level meter start there. If no real audio arrives within 5 seconds it fails with `no-signal`. `list` now reports each device's transport.
- The session shows `MIC STARTING / Keep holding L2, speak at REC` until `live`, then `REC` with its clock. Recordings under 0.3 s (including releases before `live`) are discarded with `RECORDING TOO SHORT`.
- Setup labels devices with their transport, warns that Bluetooth headset microphones start slowly and lower call quality, and prompts "speak now" only after `live`.
- Tests: the native synthetic test asserts `live`; unit tests cover the warm-up status, the too-short path and transport parsing; the setup and PTY scenarios run the fake helper with a 300-400 ms warm-up.

`npm run check` passed 116 tests with zero failures or skips. Artifact `padcode-0.1.0-dev.16.tgz`, npm SHA-1 `beddc6cfb17d3d7f9b414c98acc691ad59e9d441`. Physical confirmation with the Bluetooth headset and with a USB or built-in microphone is pending.

### Microphone grant lost after updates (dev.17)

User report (2026-10-07): with voice configured, holding L2 in Claude Code showed `MIC ERROR | Microphone access has not been granted. Run padcode config and choose a microphone.` The installed dev.16 helper reported `not-determined`. Cause: `padcode-audio` is ad-hoc signed (no team identifier), and macOS records the grant against that exact code signature, which changes with every build. The grant made with the dev.15 helper did not apply to the rebuilt dev.16 helper, and the message pointed to a configuration flow the user had already completed.

Fix: when a recording fails with `permission-required`, the session asks macOS for access itself (`MIC PERMISSION / Answer the macOS dialog for Padcode Audio`), ignores L2 while the dialog is open, then shows `MIC READY / Hold L2 again to record` or, if declined, `MIC DENIED` with the System Settings path. An explicit denial is not re-requested. Unit test: "lost macOS grant". Known limit until release signing (Developer ID, tracked under distribution): each Padcode update asks for microphone access once more.

`npm run check` passed 117 tests with zero failures or skips. Artifact `padcode-0.1.0-dev.17.tgz`, npm SHA-1 `7022f18f5dff5acc76f0ca0406589ff326c2d92e`.

### User-reported physical acceptance

On 2026-10-07 the user reported that testing dev.17 passed: after the macOS dialog for Padcode Audio, L2 recording in a Claude Code 2.1.292 session and playback from the controls menu worked, with the DS4 over Bluetooth and the MOMENTUM 4 Bluetooth headset microphone configured. Per-item counts (10 recordings, cancel, disconnect, a non-Bluetooth microphone, L2 threshold ergonomics) were not reported individually; this record covers only the user's statement.

### Stuck MIC STARTING after reconnecting the microphone (0.1.0-rc.2)

User report (2026-10-07): with the saved Bluetooth headset microphone disconnected, Padcode correctly reported a microphone problem; after reconnecting it, holding L2 stayed on `MIC STARTING` indefinitely. Cause: `MIC STARTING` is shown until the helper reports real audio. The helper's 5-second no-signal check ran from the level timer, which only started after `AVAudioEngine` had started, so a device that hangs while opening (a Bluetooth headset that has just reconnected) kept the helper waiting forever; the session had no timeout of its own, and stopping the engine could block on the same device.

Fix:
- `padcode-audio` arms a start watchdog on its own dispatch queue as soon as recording begins (default 6 s, `--start-timeout`), fails with `no-signal` ("The microphone did not start. Reconnect it, or choose another microphone in Voice settings."), never stops an engine that produced no audio, and exits with `_exit` so a stuck audio thread cannot hold the process.
- The session keeps a backup limit (8 s without audio): it gives the controller back immediately with `MIC NOT RESPONDING / Reconnect it or choose another in Voice settings, then hold L2 again`, cancels the helper and escalates SIGTERM to SIGKILL; the late result only deletes its file. The next L2 press starts a fresh helper.
- Tests: the real helper's `--synthetic-silence` mode proves the native watchdog (error within the limit, no file); a fake helper that ignores stdin and SIGTERM proves the session limit, the kill and recovery on the next press.

`npm run check` passed 133 tests with zero failures or skips. Artifact `padcode-0.1.0-rc.2.tgz`, npm SHA-1 `9e4f0750f9d36629e14f154378906223f520b5f3`. The native helper changed, so macOS asks for microphone access once more. The real reconnect case needs physical confirmation.

### User-reported acceptance of the reconnect fix

On 2026-10-07 the user reported that the reconnect case passed with 0.1.0-rc.3: after disconnecting and reconnecting the saved Bluetooth headset microphone, L2 recording worked without staying on `MIC STARTING`. Whether the first press after reconnecting needed a retry was not reported.
