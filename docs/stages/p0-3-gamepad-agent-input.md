# P0-3: Gamepad input in Agent sessions

## Scope and prerequisites

Stack on PR #8 (`feature/pty-agent-session`), without merging or publishing. The user confirmed dev.6 menu operation after pressing X; P0-2's two-terminal/two-Agent manual compatibility matrix remains pending. The user authorized continuing implementation independently of that manual gate. Voice input remains out of scope.

## Implementation plan (before code)

1. Route a configured controller through the existing SDL feed into the owned Agent PTY. Map D-pad to CSI arrows, X to CR, O to Escape, L1 to Tab, R1 to Shift+Tab. No mouse, global keys, voice or automatic requests. Keyboard input remains available.
2. Start session mapping paused. A fresh Options press/release enables or pauses it. Require 250 ms of input settling before accepting actions, and ignore held/duplicate button downs. Disconnect/helper failure pauses immediately; reconnect requires a fresh Options cycle. Filter configured identity and keep multiple controllers isolated. No auto-repeat in this stage.
3. Keep controller bytes separate from keyboard data in the bounded writer. Pause/disconnect cancels queued controller bytes, preserving keyboard input. Bytes already accepted by the OS cannot be undone. Never replay canceled input. Clean up the SDL helper on normal exit, spawn error, signal and cancellation.
4. Show controls before launch; reflect active/paused/disconnected state in the terminal title using bounded constant text, restoring the previous title on exit. TERM=dumb uses plain status lines. Do not draw an overlay over the Agent TUI or interpret its output. Terminals that suppress title changes still have the explicit startup controls and Options toggle.
5. Improve saved-controller menus: a uniquely identity-matched configured controller works immediately, with X confirming. Unidentified/multiple controllers retain explicit claiming; D-pad up/down may claim and navigate in one press. Keep setup's initial physical-claim protection and held-button deduplication.
6. Add unit, real PTY integration, lifecycle/failure and offline-package regressions. Produce dev.7, run the complete gate and macOS/Ubuntu CI, submit a separate Draft PR and request physical acceptance.

## Acceptance matrix

| ID | Requirement | Tests |
| --- | --- | --- |
| G1 | Exact profile bytes reach only the owned PTY; keyboard and literal Unicode still work | mapping unit + real PTY |
| G2 | Startup is paused; fresh Options toggles; duplicate/held input never repeats or crosses pause/resume | state-machine unit + PTY |
| G3 | Disconnect/reconnect/helper failure stop injection; no stale queued bytes replay; other controllers cannot operate the session | failure/identity + writer queue tests |
| G4 | Helper cleanup on all session exits; no Agent output overlay; title restored and plain fallback documented | lifecycle + PTY |
| G5 | Configured matching controller navigates/ confirms menus immediately; ambiguous devices require claiming | menu unit + existing setup regressions |
| G6 | Full npm run check and macOS/Ubuntu CI pass; offline scripts-disabled install remains functional | full gate + package smoke |
| G7 | PS4 Bluetooth completes menu launch and Agent navigation, pause, held-button, disconnect/reconnect and keyboard coexistence checks | manual, pending |

## Physical checklist (pending)

Install dev.7. In Player Hub, use the configured PS4's D-pad and X without a separate claiming press. Start an Agent in a disposable project. Release all buttons, then press/release Options to enable mapping; check the terminal title where supported. Verify each mapped key, typing with the keyboard, a single Enter per X press, and no repeated submission while holding X. Pause with Options, press mapped keys and confirm nothing reaches the Agent; resume and verify no delayed actions. Disconnect/reconnect while paused or holding a button, then explicitly resume with Options. Exit with Ctrl+] and confirm the terminal and helper are restored/closed. Report terminal/Agent versions and observed results. P0-2's broader compatibility matrix remains separately pending.
