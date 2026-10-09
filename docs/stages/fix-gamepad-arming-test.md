# Fix: intermittent failure in the gamepad Agent PTY test

Status: planned. This plan, its acceptance criteria and test matrix are committed before implementation.

## Evidence

`test/gamepad-agent-pty.py` (run by `test/agent-gamepad.test.mjs` and the installed-package test) failed twice in complete `npm run check` runs on 2026-10-09 (UI-3 branch and merged `main`) at `press('south'); quiet(); assert received()==b''`, and passed on every rerun.

The test waits for the Agent's `INFO:` line and the `ARMING` status, then presses X and expects nothing to reach the Agent, assuming the press lands inside the 250 ms neutral-arming window that starts when the controller connects. Investigation on macOS 27.0.1 arm64 (14 cores):

- Normally `INFO:` appears 20-30 ms after `ARMING`, so the press lands in the window; 32 runs of all four modes under heavy CPU load passed.
- With the session's event loop deliberately blocked for 400 ms after `ARMING`, `INFO:` appeared 401 ms after `ARMING`, `ACTIVE` was already shown before the press, and the press reached the Agent: the reported failure.
- With the same block but the press written right after `ARMING` (so it arrives while the loop is blocked), nothing reached the Agent in six runs: a press made during arming is consumed even when the arming timer and the press are processed in the same loop turn.

So the product behaves correctly: a press after arming is supposed to reach the Agent. The test depends on pressing within 250 ms of a slow process's output.

## Design

Make the arming check independent of timing, and closer to what the barrier exists for (a button already held when control starts must not leak):

1. Before starting the session, write `south` down into the fixture's event file; the fixture helper replays it right after `connected`, so the controller starts with X held.
2. Wait for `INFO:` and `ARMING`; press another button (O) while X is held; for 150 ms nothing may reach the Agent and `ACTIVE` must not appear. A held button keeps the session arming however long it takes.
3. Release X; `ACTIVE` follows after the 250 ms settle; the rest of the scenario is unchanged.

No product code changes.

## Acceptance

- G1: the four scenarios of `gamepad-agent-pty.py` pass, and the arming assertions hold with the session's event loop blocked for 400 ms after `ARMING` (the failure reproduction), checked locally with a temporary fixture that is not committed.
- G2: `npm run check` passes with no skipped tests.

## Validation record

Pending.
