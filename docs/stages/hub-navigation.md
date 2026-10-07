# Player Hub navigation

Status: implemented in dev.11; automated acceptance passes locally and physical acceptance is pending. This plan was committed before runtime changes. Stacked on PR #12 (`feature/isolated-terminal-controls`); retarget after its prerequisites merge.

## Problem

The user reported that after entering Padcode there is no way back to a previous screen without quitting and relaunching. In dev.10 every Player Hub action ends the process: cancelling the launch confirmation, leaving Controller Lab or the demo, and an Agent session exit all return to the shell. Controller Lab and the demo can be left only with the keyboard (Q / Esc).

## Scope

1. Player Hub becomes a loop. These return to Player Hub instead of exiting:
   - cancelling the Agent launch confirmation (O or the Cancel option);
   - an Agent session that ends (normal exit, Ctrl+], Agent launch failure);
   - leaving Controller Lab or the demo;
   - finishing or cancelling Edit configuration when a saved configuration exists.
2. Only the Hub's Exit option (O on the Hub, or q) leaves Padcode, with status 0. Ctrl+C and SIGTERM keep their 130/143 statuses. First-run setup cancelled without any saved configuration still exits.
3. After an Agent session the Hub shows `SESSION OVER / Agent exited with status N` (or the failure message) above the menu, then re-activates controller menus.
4. Controller Lab: holding O for 1 second returns to the Hub. A short O press is still displayed as test input. The footer shows `HOLD O 1S BACK`. Demo: O returns to the Hub, using the Hub's controller feed because the demo has no input helper.
5. `padcode run` keeps its single-session behavior and exit status. `padcode controllers` and `padcode demo` keep their keyboard exits; the hold-O exit applies to the live lab in every entry point.

Out of scope: stepping back between first-run setup steps, reordering Hub items, the C3 Options panel.

## Rules

- Exactly one SDL reader at a time: the Hub's menu feed is stopped (or handed off to the Agent session) before Controller Lab starts its helper, and re-activated when the Hub is shown again.
- The press that leaves a screen must not act on the Hub: menus re-activate with the existing 250 ms settling barrier, and the hold-O exit is only consumed after release.
- Every return to the Hub restores the terminal state first (raw mode, alternate screen, cursor, title).

## Automated acceptance

- N1: Hub -> Start agent session -> Cancel (O) returns to the Hub; X on Exit then ends with status 0.
- N2: Hub -> Agent session -> Agent exits with 23 -> Hub shows `SESSION OVER` with status 23; the next session launch again activates the controller automatically, and the helper starts once per Hub visit.
- N3: Ctrl+] in an Agent session returns to the Hub; Ctrl+C at the Hub exits 130.
- N4: Controller Lab returns to the Hub after O is held 1 second; a short O press stays in the lab; Q still works; the lab helper is reaped before the Hub helper starts.
- N5: Demo returns to the Hub on O and on Q.
- N6: Edit configuration -> cancel returns to the Hub with the previous configuration.
- N7: `padcode run` exit statuses and all existing suites are unchanged; `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance

- N-H1: with the DS4, go Hub -> Claude Code -> exit -> Hub -> Controller Lab -> hold O -> Hub -> Exit without touching the keyboard except to exit the Agent.
- N-H2: confirm that leaving each screen does not trigger an action on the Hub.

## Validation record

Plan commit: `c1769ad`. On macOS 27.0 arm64 with Node 24.21.0 and tmux 3.7c, `npm run check` passed 103 tests with zero failures or skips. `test/hub-navigation-pty.py` covers N1-N6 through the real onboarding Hub with a virtual controller, running the Agent journeys in transparent and panel modes and the Lab, demo and configuration journeys in transparent mode; N3's Ctrl+C case and N7 are covered by the same suite and the updated onboarding, Agent and Hub PTY suites. Existing tests that expected the process to end after a Hub action now expect the return to the Hub and then choose Exit. Behavior change: `padcode` (Player Hub) now exits with status 0 from its Exit option instead of returning the last Agent's status; `padcode run` still returns the Agent status. Artifact `padcode-0.1.0-dev.11.tgz`, npm SHA-1 `213ed9b6ac642cfaa5b11fcb40c2986d377e982c`. N-H1 and N-H2 are pending physical testing.

### User-reported physical acceptance

On 2026-10-07 the user reported that physical testing passed with the installed private artifact `padcode-0.1.0-dev.11.tgz` (npm SHA-1 `213ed9b6ac642cfaa5b11fcb40c2986d377e982c`) on macOS 27.0 arm64, tmux 3.7c, Node 23.5.0, DS4 over Bluetooth and Claude Code 2.1.292, launched from Player Hub in the user's terminal (`TERM_PROGRAM=Orca` 1.4.206 observed on the session process). Per-item counts, Warp/Terminal.app runs and Codex runs were not reported individually; this record covers only the user's statement, and the user authorized merging on that basis.
