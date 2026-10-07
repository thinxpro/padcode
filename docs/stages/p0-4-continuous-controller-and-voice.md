# P0-4: Continuous controller sessions and voice drafts

Status: C1 continuous handoff is implemented in dev.8 with physical acceptance pending. C2 isolated terminal controls are implemented in dev.9 under their [stage plan](c2-isolated-terminal-controls.md) with automated acceptance passing and manual/physical acceptance pending. C3 (controls menu) is implemented in dev.12 under its [stage plan](c3-controller-session-controls.md) with automated acceptance passing and physical acceptance pending. C4 (microphone setup and push-to-talk capture) is implemented in dev.14 under its [stage plan](c4-microphone-capture.md) with physical acceptance pending. C5 (transcription tiers and draft review) is implemented in dev.18 under its [stage plan](c5-local-transcription.md) with physical acceptance pending. C6 (automatic voice insertion with undo, user-approved plan revision) is implemented in 0.1.0-rc.1 under its [stage plan](c6-voice-insertion.md) with physical acceptance pending.

## Problem and verified baseline

The user reports that controller navigation works in Padcode but appears to stop after entering Codex. This is an open end-to-end defect, not a completed compatibility test.

The current dev.7 source already launches the selected executable through `node-pty` and a session host. Keyboard bytes and mapped controller bytes share a bounded PTY writer. Agent mapping starts paused; a fresh Options press/release enables it after a release/settling barrier. Most mapping feedback is in the terminal title. The menu controller is closed before a separate session controller starts. These are investigation targets, not a proven root cause.

Existing synthetic tests do not establish real Codex compatibility. P0-2's real terminal/Agent matrix and P0-3's physical acceptance remain pending. Locally inspected Codex reports `codex-cli 0.150.1`; this is a diagnostic version record, not an accepted version.

## Product contract

After initial setup, the user can launch an Agent, navigate its native interface, dictate and review a draft, insert and explicitly submit it, interrupt using its documented key, read output, and return to Player Hub with the controller. Keyboard input remains available throughout.

Padcode remains an npm-installable local CLI. It supplies neither an Agent nor an account, model, transcription service or hosted backend. First-time account authentication, custom command text and operating-system permission dialogs can require a keyboard or system UI; do not promise controller automation of those boundaries.

Preserve the Agent's original TUI, authentication, approval prompts and sandbox settings. A controller key has the same meaning as the corresponding keyboard key. Never infer permission approval from a generic Enter mapping.

## Architecture decision

Retain the PTY bridge. Adding an intermediate zsh process alone would not solve input ownership, hidden pause state, rendering isolation or voice review.

```text
Controller -> one session input owner -> context router
                                       |-> Player Hub / control panel / voice review
                                       `-> tagged input queue -> Agent PTY -> original Agent TUI
Keyboard ---------------------------------------------------> Agent PTY
Microphone -> explicit capture -> user-selected transcriber -> private draft
                                                           -> review -> explicit insertion
```

The router has exactly one foreground context: hub, launch handoff, Agent, controls, recording, transcribing or draft review. Controller events never reach two contexts. Keyboard shortcuts for emergency exit remain available independently. Agent output continues while a Padcode panel is open.

A persistent status/control region must be isolated from the Agent's screen. Do not append a status bar to raw Agent ANSI output: cursor addressing, alternate-screen changes and screen clears can overwrite it or corrupt the TUI. Terminal titles are supplemental feedback only.

The preferred prototype is a terminal multiplexer with separate Agent and Padcode panes, initially evaluating tmux. It remains a CLI dependency, not a desktop app. Stage C2 must validate this choice before production integration: preserve native rendering, focus, paste, resize, scrollback and cleanup in Warp and Terminal.app. If tmux is absent, explain the dependency and retain the existing transparent mode with its stated limitations; never silently install it. Controller-first acceptance requires the isolated panel path. If this prototype fails, commit a revised rendering decision and criteria before implementation; do not silently substitute a homegrown partial terminal emulator.

Keep exactly one SDL reader and one Agent PTY owner. If panes require separate workers, use private local IPC in a mode-0700 directory, restrict messages to a validated schema and session identifier, and clean up endpoints on exit. Input still targets the explicit Agent PTY writer, never global keyboard injection or a loosely targeted multiplexer session.

Codex app-server is an optional later integration, not required for basic controller input. Official documentation also describes connecting the original Codex TUI to a remote app-server; therefore a structured adapter does not inherently require replacing the TUI. Its transport/version and semantics would need a separate plan. This stage retains local, generic PTY launch.

## Interaction and ownership rules

- Transfer the already selected controller from the Hub into the session. After all mapped buttons are released and a 250 ms settling interval passes, activate it automatically and show `GAMEPAD ACTIVE` in the visible status region. Do not require discovering a hidden Options shortcut.
- Launch-confirmation X must not become Enter inside the Agent. Tag queued events with a routing generation; discard stale controller events when context, device identity or session changes. Preserve queued keyboard data.
- Disconnect pauses injection and cancels recording. Reconnection requires a fresh, visible rearm confirmation; the rearm press is consumed. Never replay buffered inputs. An unidentified replacement controller must be claimed explicitly.
- Options opens the Padcode controls panel. That panel offers resume, pause, voice setup, scrollback, send interrupt and end session. This replaces the old silent pause toggle; show a migration hint. Closing a panel consumes the closing press and waits for release before routing to the Agent.
- D-pad sends arrows, X sends Enter, O sends Escape, L1 sends Tab and R1 sends Shift+Tab in Agent context. In Padcode panels they navigate/confirm/back locally. Enter and Escape retain native Agent semantics.
- Interrupt is a clearly labeled profile action (initially Ctrl+C where verified). End session requires a separate confirmation. Neither voice completion nor disconnect invokes either action.
- Scrollback is an explicit local context with visible exit instructions; controller navigation there cannot submit to the Agent. Its supported multiplexer behavior is part of C2/C3 acceptance.
- Start with press edges, without automatic Enter repeats. Additional repeats and stick mappings require separate criteria.

## Voice contract

Voice is opt-in and disabled until terminal setup selects a microphone and a user-installed transcription command. Do not assume a DualShock 4 microphone is available over Bluetooth. Show microphone name, backend, language and local/network processing disclosure before enabling capture. System permission denial returns an actionable terminal message.

Proposed default: hold L2 to record, release to stop. Use trigger hysteresis (start at 0.65, stop below 0.35) and 150 ms debounce; confirm ergonomics with the physical controller. Limit each recording to 60 seconds and allow O to cancel. Only one recording/transcription job may exist. Disconnect, session exit and explicit cancellation stop capture and invalidate outstanding results.

The first adapter uses a user-configured local executable with literal arguments and an audio-path placeholder, without shell evaluation. Specify its audio format, UTF-8 stdout contract, exit codes, timeout and output size cap in the C5 plan before code. The reference contract is mono 16 kHz PCM WAV, a 120-second transcription timeout and a 64 KiB text cap. Backend setup must test these requirements with a fixture before enabling it. Do not install a model automatically. A network provider needs its own later PR and explicit data-handling configuration; an Agent subscription is not assumed to include a speech API.

Keep audio and intermediate files in a private temporary directory with mode-0600 files. Delete them after success, failure or cancellation; recover stale files owned by Padcode on the next launch without following symlinks. Do not store recordings, transcripts, credentials or Agent screen content in diagnostics. Changing backend never uploads an existing draft automatically.

The flow is `record -> transcribe -> review -> insert -> explicit submit`. The draft panel supports rerecord, discard, return to the Agent and insert. X in review inserts only after the user confirms the native composer is focused; it never appends Enter. A later, fresh X in Agent context submits using the native mapping.

A generic PTY cannot reliably distinguish a composer from an approval dialog. Bracketed paste is not proof of composer focus. Enable insertion only for a version-tested profile with verified paste behavior, require the user to inspect and confirm the destination, and clearly state this limitation. Unknown profiles keep the draft in the panel instead of injecting it. A future structured adapter may provide stronger destination guarantees. Never label heuristic ANSI parsing as semantic approval detection.

Strip terminal control characters from recognized text, preserve ordinary Unicode and supported line breaks, enforce the output cap, and test embedded escape/paste terminators. Job/session generations prevent a late transcript from reaching a restarted Agent, a different session or a shell after Agent exit. Opening another context or a connection change invalidates insertion confirmation. Ordinary Agent output alone cannot establish or invalidate semantic focus reliably; the final user confirmation remains required.

## Implementation sequence and acceptance

Each row is one scoped PR. Commit any expanded stage plan before code. Dependencies are sequential except where explicitly stated. Do not merge pending prerequisite PRs as part of this work.

| Stage | Deliverable | Automated acceptance | Physical/manual acceptance |
| --- | --- | --- | --- |
| C1: Diagnose and continuous handoff | Reproduce the report; record installed Padcode path/version, terminal, Agent version, controller identity and pause state. Add opt-in metadata-only routing diagnostics. Implement one input owner and neutral-barrier handoff. | C1-A: trace each input hop without recording text; verify held launch X, held Options, stale generations, wrong device, helper failure, queue cancellation and reconnect. Existing PTY/keyboard tests pass. | C1-H: 20 Hub-to-Codex launches with no keyboard rearm, no accidental Enter and visible activation feedback; 10 disconnect/reconnect cycles with no replay. Record the actual root cause, or keep the defect open. |
| C2: Isolated terminal controls | Prototype and select the multiplexer path; document dependency/version, process ownership and fallback. Integrate the status/control pane only after the prototype passes. | C2-A: exercise pane/worker exit, IPC validation, stale session IDs, resize, alternate screen, cursor queries, paste and cleanup with a controlled TUI; no Agent bytes overwritten by status rendering. | C2-H: Warp and Terminal.app preserve Codex rendering, keyboard input, selection/copy, resize and scrollback; status remains visible during output and native approvals. Missing dependency produces useful recovery. |
| C3: Complete controller session | Add context-aware Options panel, explicit interrupt, pause/rearm, scrollback and confirmed end-session flow. Document the changed Options mapping. | C3-A: context transition matrix covers every button; 100 simulated X presses produce exactly 100 intended key events, with no repeats or cross-context delivery. Cancellation, normal exit and crash restore the terminal and remove helpers. | C3-H: use only the DS4 after launch to navigate, interrupt a fixture task, read history, pause/resume and return to Hub. Verify real Codex native approval choices without automatic selection. Run a 10-minute session without stuck input. |
| C4: Microphone setup and capture | Add terminal configuration, versioned migration, microphone selection, permission feedback and bounded push-to-talk recording. No transcription yet. | C4-A: test trigger jitter, cap, rapid presses, permission denial, no device, device removal, cancellation, invalid configuration, cleanup and migration from existing config. Fake audio devices must not count as hardware evidence. | C4-H: select a real Mac microphone; run 10 L2 recordings and playback inspection, verify start/stop indicators, cancel and disconnect. Confirm controller trigger ergonomics and absence of clipping at onset. |
| C5: Local transcription and draft review | Implement the executable adapter, bounded job lifecycle and controller-operated draft panel. Keep text outside the Agent until explicit insertion. | C5-A: valid/empty/Unicode/oversize/control-character output, nonzero exit, spawn error, timeout, cancellation, late results, restart and temp-file cleanup. Assert zero PTY writes during recording/transcription/review. | C5-H: configure a user-installed transcriber; dictate, rerecord and discard with the DS4, then review a correct draft. Confirm no audio upload by Padcode and document the chosen backend's own behavior. |
| C6: Verified insertion and release candidate | Add supported profile insertion, fresh-press submission, final setup/help and installation documentation; package a private test artifact. | C6-A: test multiline and adversarial text, unsupported profile, changed generation, exit during insertion, held confirmation and queue pressure; inserting a draft never adds submit bytes. Complete packaged-install smoke tests. | C6-H: complete launch -> dictate -> review -> confirm composer -> insert -> fresh submit -> read -> interrupt -> exit using only the controller. Run in both terminals with Codex and a second available user-selected CLI; record profile limitations rather than claiming universal support. |

C1 may use temporary explicit launch-state feedback before the isolated panel exists; persistent in-session visibility is not accepted until C2. Voice work starts only after C1-C3 pass for the initial Codex combination. If the second CLI is unavailable, keep the wider P0-2/C6 matrix pending and label any artifact as a limited private test build.

## Test and evidence requirements

For every implementation PR, run `npm run check` locally and the repository's macOS/Linux CI gate. Add unit, PTY integration and failure/lifecycle tests for the acceptance IDs above. A skipped required test is pending, not passing. Keep hardware-dependent PRs draft until their required physical checks pass.

Use controlled children for deterministic byte, rendering and process assertions; use actual CLIs and hardware for compatibility claims. Test keyboard operation alongside the controller, Unicode, narrow widths, `NO_COLOR`, missing dependencies, process crashes and permission denial. Measure controller-to-write latency locally and record the distribution; target p95 under 100 ms after activation, without making shared CI timing a flaky correctness gate.

Each stage evidence record includes commit/package checksum, OS/CPU, Node, terminal, Agent, multiplexer and backend versions, controller transport, reproduction steps, expected/actual results and unresolved limits. Never include credentials or real session transcripts. User-reported passes apply only to the exact steps they tested.

Current acceptance ledger: on 2026-10-07 the user reported physical testing passed for C1, C2 and Player Hub navigation with dev.11 and Claude Code 2.1.292, and authorized merging; per-item counts and Codex/Warp/Terminal.app runs were not reported individually. Earlier ledger: C1 automated acceptance passes locally in dev.8 and C2 automated acceptance passes locally in dev.9; C1 and C2 physical/manual acceptance and C3-C6 remain pending. The user's loss-of-control report remains open until the dev.8 physical procedure passes. Previous Bluetooth/menu successes do not close these criteria.

## Documentation PR acceptance

- D1: This plan is committed before runtime changes and linked from the roadmap and README.
- D2: The existing PTY implementation, pending compatibility evidence and proposed behavior are distinguished.
- D3: Every implementation step has automated and physical criteria, dependencies and a separate PR boundary.
- D4: Repository content and PR text remain English; relative documentation links resolve.

This PR changes documentation only. It does not fix controller handoff, enable recording or publish an npm package.

## References

- [Existing PTY plan](p0-2-pty-session.md)
- [Existing gamepad mapping plan](p0-3-gamepad-agent-input.md)
- [Agent integration boundaries](../agent-integration.md)
- [Official Codex CLI documentation](https://developers.openai.com/codex/cli)
- [Official Codex app-server documentation](https://developers.openai.com/codex/app-server) (including remote terminal UI; consulted 2026-09-21)
