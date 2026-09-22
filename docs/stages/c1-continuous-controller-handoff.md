# C1: Continuous controller handoff

Status: implemented in dev.8; automated acceptance passes and physical acceptance is pending. The plan was committed before runtime changes.

## Scope

Fix the reported loss of controller control when Player Hub launches an Agent. Reuse the menu's live controller feed, transfer it to the Agent session, wait for a neutral input barrier and activate mapping without a hidden Options step. Keep the original Agent PTY and keyboard behavior.

This PR does not add the isolated controls pane, change the Options mapping, add voice, infer Agent state or publish a package.

## Root cause

The dev.7 launch path stopped `GamepadMenus`, including its SDL helper, before `runAgent` created a new `AgentGamepad` and helper. `AgentGamepad` always started paused and exposed its state mainly through the terminal title. Consequently, a working controller in Player Hub appeared inactive inside Codex until a fresh Options press/release.

Source inspection and the controlled end-to-end PTY trace confirm this lifecycle. The user's physical Codex report remains open until C1-H passes; if it persists, retain trace evidence and investigate another cause instead of claiming physical resolution.

## Design

1. Add an explicit one-use handoff from `GamepadMenus`. It detaches menu listeners and transfers the already-started feed without stopping the helper. Cancelled launches continue to stop it normally.
2. Let `AgentGamepad` adopt that feed. Establish a new routing generation, subscribe before activation and wait until all observed mapped buttons are released for 250 ms.
3. Automatically select only one exact configured identity. Manual or ambiguous identities remain paused and require Options. A reconnect always remains paused and consumes a fresh Options press/release.
4. Consume every event received during the neutral barrier. In particular, the X used to confirm launch cannot become Agent Enter. Controller queue cancellation never removes keyboard bytes.
5. Print one bounded pre-launch status line so activation is visible even when a terminal or Agent replaces its title. Keep title updates as secondary feedback until C2 provides an isolated panel.
6. Add opt-in `PADCODE_INPUT_TRACE=1` routing metadata. Record event names, generations, state and device numbers only; never record key bytes, typed text, Agent output, controller serials or command arguments.

## Automated acceptance

- C1-A1: a live menu feed is started once, transferred once and stopped once after Agent exit; cancellation and failures still stop it.
- C1-A2: exact configured identity activates after a 250 ms neutral barrier without Options.
- C1-A3: held launch X and Options, duplicate edges and all barrier events emit zero Agent bytes.
- C1-A4: stale generations, mismatched devices and unselected devices cannot inject or toggle mapping.
- C1-A5: disconnect cancels queued controller bytes; same-identity reconnect stays paused until a fresh Options press/release, with no replay.
- C1-A6: helper startup/failure paths preserve keyboard-only operation and clean up once.
- C1-A7: opt-in traces contain routing metadata and no terminal key bytes, controller serial or Agent content. Tracing disabled produces no trace output.
- C1-A8: the controlled PTY fixture receives exact mapped bytes after automatic activation; keyboard Unicode, resize, output, exit, signal and cleanup coverage remain green.
- C1-A9: `npm run check` passes locally and in macOS/Linux CI with no required test skipped.

## Physical acceptance

- C1-H1: install the private artifact and record artifact checksum, macOS/CPU, terminal/version, Codex version and DS4 Bluetooth identity status without sharing its address.
- C1-H2: perform 20 `padcode` or `padcode run` launches into Codex. Each launch shows activation, needs no Options/keyboarding, and the confirmation X never submits inside Codex.
- C1-H3: in each launch, D-pad navigates and X/O operate the native Codex TUI while keyboard input remains available.
- C1-H4: perform 10 disconnect/reconnect cycles. No input replays; each reconnect visibly requires and consumes a fresh Options rearm before mapped buttons work.
- C1-H5: run one launch with `PADCODE_INPUT_TRACE=1` if the issue persists. Inspect the trace before sharing it and confirm it contains no typed prompt or Agent output.

The PR remains draft until C1-H1 through C1-H4 pass. C1-H5 is conditional diagnostic evidence, not a routine acceptance requirement.

## Validation record

Plan commit: `f54721d`; implementation commit: `1916def`. On macOS 27.0 arm64 with Node 24.21.0, `npm run check` passed 93 tests with zero failures or skips. The controlled real-PTY fixture passed automatic neutral handoff, exact key delivery, Unicode keyboard coexistence, disconnect/rearm, helper failure, signals and cleanup. The current-platform artifact is `padcode-0.1.0-dev.8.tgz`, npm SHA-1 `ab2ccbb3d465ed9a89078166c8fd3b708aa433b4`. C1-A1 through C1-A9 pass locally; CI remains required. C1-H1 through C1-H4 remain pending, so the implementation PR stays draft.
