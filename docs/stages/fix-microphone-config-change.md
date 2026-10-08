# Fix: microphone check fails once with "configuration changed"

Status: implemented; automated acceptance passes locally, physical acceptance H1-H3 pending. This plan, its acceptance criteria and test matrix were committed before implementation.

Independent of the UI overhaul stack and of the Bluetooth permission fix (PR #28); branched from `main`.

## Evidence

On 2026-10-08, with a local test build installed, the maintainer granted microphone access for the first time and chose "Record 3 seconds and play it back". Setup showed `MIC STARTING...` and then `VOICE NOT READY: The microphone configuration changed during recording.` Retry then worked. A Bluetooth headset was connected at the time; which microphone was chosen was not recorded.

`padcode-audio record` subscribes to `AVAudioEngineConfigurationChangeNotification` and fails the recording on the first notification, whatever the state. macOS posts this notification when the input device's hardware format changes, which happens routinely while capture is starting: a Bluetooth headset switching from its music profile to its call profile changes the sample rate, and the first capture after a privacy grant can reinitialise the device. At that point no audio has been recorded yet (the recorder only goes live on the first non-zero sample), so nothing is lost by reconfiguring, yet the user gets an error and must retry by hand.

## Design

1. **Reconfigure while starting.** Building the input chain (select the device on the input node, read its current input format, create the converter to 16 kHz mono, install the tap, prepare and start the engine) becomes one routine that can run again. On a configuration change before the recorder is live, the helper stops the engine, removes the tap and runs the routine again with the new format, up to 3 times per recording. If the routine fails, or a fourth change arrives, the recording fails with the existing message.
2. **Live recordings unchanged.** A configuration change after audio has started still fails the recording with the same message: switching formats mid-clip would splice audio and must not be hidden.
3. **Start limit unchanged.** The existing start watchdog still ends a microphone that never delivers audio (`no-signal`), so restarts cannot keep the helper waiting forever.
4. **Testable decision.** The restart-or-fail rule is a header-only function in `native/recording.h`, compiled into a C test harness.

## Automated acceptance

- M1 Decision harness: not live with 0-2 previous restarts → restart; not live with 3 → fail; live with any count → fail.
- M2 Existing voice, audio helper fixture and native build tests pass; synthetic recordings are unaffected.
- M3 `npm run check` passes with no skipped tests.

Automated tests cannot open a real microphone (no permission in the test environment) or change a device's format; they are not microphone evidence.

## Physical acceptance

- H1: fresh microphone grant, then "Record 3 seconds and play it back" with the built-in microphone works on the first try.
- H2: the same with a Bluetooth headset microphone that switches profiles works on the first try (the start may take about a second).
- H3: hold-to-record in an Agent session still works with both microphones, and unplugging or disconnecting the microphone during a recording still reports a disconnection.

## Implementation notes

- `attach` (in `record`) selects the device, reads the input format, builds the converter and tap, prepares and starts the engine, and returns an error message or nil. The first call keeps the previous failure codes (`no-device` for device and format problems, `io` for tap and start problems).
- The configuration-change observer hops to the recorder queue, where `live` is read and written, so the decision and the restart never race the audio appends.
- A restart stops the engine and removes the tap before attaching again with the new format; a failed restart reports its own message as `device-lost`.
- The first combined run of the native and voice suites was started in parallel by mistake and failed once in the native audio test; the repository runs suites serially (`--test-concurrency=1`), and three serial runs plus the full gate passed.

## Validation record

Plan commit: `9198f73`. On macOS 27.0.1 arm64 with Node 24.21.0, `npm run check` passed 156 tests with zero failures or skips. CI is disabled by the maintainer's decision, so Linux was not exercised.

- M1: `test/native.test.mjs` compiles `test/fixtures/recording-harness.c` and checks the ten states.
- M2: native audio tests (synthetic WAV, stop, cancel, EOF, SIGTERM, cap, diagnose) and voice suites pass; a synthetic 1-second recording still produces 32,044 bytes.

Physical acceptance H1-H3 is pending.
