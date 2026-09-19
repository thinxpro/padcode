# P0-2: Transparent agent PTY sessions

## Scope and prior acceptance

The user confirmed the dev.5 connected-controller scan regression passed. The next independent stage launches the user's configured CLI and forwards its native terminal interaction. Gamepad-to-agent key injection remains P0-3; controller operation of Padcode menus remains available.

This PR stacks on PR #7 (`fix/retain-connected-controller`), with no implicit merges or registry publication. All repository and PR content remains English.

## Implementation plan

1. Evaluate and pin node-pty using registry metadata and official source. Verify a real PTY using shipped prebuilt artifacts with install scripts disabled. The local development package must include the runtime dependency and native artifacts, and install offline without a compiler. Document any development-time packaging repair; if this route fails, amend the plan before selecting a standalone native helper.
2. Add `padcode run` and an explicit Start agent session choice in Player Hub. Display the selected executable, literal arguments and current project directory before explicit launch confirmation. Saving/editing config never launches an agent. Missing configuration/executable, unsupported platform or non-TTY input fails clearly.
3. Spawn the executable directly with an argument array and inherited environment/cwd. Forward keyboard bytes, terminal responses, Unicode output and resize without parsing agent output as tool commands. Do not record session contents or credentials. Preserve the agent's own authentication, permissions and approvals.
4. Ctrl+C bytes go to the agent. Reserve Ctrl+] as a documented emergency detach/terminate control. External SIGINT/SIGTERM, EOF, output failure and spawn failure restore raw mode, cursor/screen state and stop the owned PTY process group with bounded escalation. Preserve normal child exit status and drain final output. Deliberately daemonized processes are outside the session contract.
5. Bound input/output flow and handle stream backpressure without dropping UTF-8 or control sequences. Verify subprocess cleanup, terminal restoration and installed-package behavior through actual PTYs and controlled local fixture programs; never launch a real agent automatically during development.
6. Bump to dev.6, update English docs/validation, open a Draft PR and ask for two-terminal/two-agent manual compatibility testing. No claim that automation establishes actual agent compatibility.

## Fixed acceptance matrix

| ID | Requirement | Evidence |
| --- | --- | --- |
| T1 | Explicit confirmed launch uses exact configured executable/args and invocation cwd; setup/save never runs it | entry/config integration + PTY |
| T2 | Bidirectional ASCII/Unicode/control bytes, colors, alternate screen, cursor queries and resize reach the real PTY child | real PTY fixtures |
| T3 | Ctrl+C reaches the child; Ctrl+] and external signals clean up owned group and restore terminal; normal exit status preserved | signal/exit/failure tests |
| T4 | Slow consumers, output/input limits, spawn failures and cleanup do not leak helpers or leave raw mode | backpressure/lifecycle tests |
| T5 | Offline tarball install with scripts disabled runs the PTY dependency without compilation on the tested OS/CPU | isolated npm package smoke + CI |
| T6 | Complete npm run check and macOS/Ubuntu CI pass, with applicable tests not skipped | local + CI |
| T7 | At least two terminals and two user-provided interactive CLIs pass the core flow, with versions and limitations recorded | manual compatibility checklist; Draft pending |

The PTY package must remain current-platform-only until broader release validation. No direct agent API integration or account/model service is introduced.

## Runtime packaging decision

Pin node-pty 1.1.0 as a development dependency and copy its Unix runtime, full license and current-platform native files into `build/pty`. macOS uses its shipped prebuild; Linux builds at development/CI time. The resulting package has no runtime npm dependency or install script. Normalize the macOS spawn-helper executable bit before packing.

Use the pinned Unix `fd` accessor with a bounded asynchronous writer to avoid node-pty's unbounded write queue. Pause terminal input at 64 KiB, reject more than 1 MiB queued input and terminate after 10 seconds without progress. Pause PTY output on stdout backpressure and enforce the same stall timeout. The final session-host handshake below preserves output before the PTY leader exits, keeping the upstream runtime unmodified. Cover the pinned fd accessor and lifecycle handshake with actual PTY and slow-consumer regression tests; retain upstream and native header dependency licenses.


## Manual compatibility checklist (pending)

Use two terminal applications (for example Warp and Terminal.app) and two already installed/authenticated Agent CLIs. Record application and CLI versions and each combination tested.

1. Install dev.6 and change into a disposable project. Configure the first Agent. Confirm saving does not launch it.
2. Run `padcode run`; verify the executable, arguments and project shown. Cancel once, then launch explicitly.
3. Confirm the Agent renders normally; try navigation, text including Unicode, a terminal resize and its own approval flow. Use a harmless request rather than a destructive project change.
4. Verify Ctrl+C behaves as in the Agent directly. Exit normally; the terminal must accept input with normal echo/cursor. Relaunch and verify Ctrl+] stops the session and restores the terminal.
5. Repeat with the second terminal and Agent; report specific combinations and any missing output, redraw glitches or orphaned processes. Controller selection on Padcode menus remains supported, but gamepad-to-agent input is intentionally the next stage.

No real Agent was launched during implementation. This PR remains Draft until T7 passes.

## Automated evidence

- Plan commits before implementation: `7ab7c4b`, `853d5ce`.
- Local `npm run check`: 77 tests passed, zero failures/skips, on macOS 27 arm64 with Node 23.5.0. The tightened native-spawn assertion was also rerun successfully.
- T1–T6 local coverage includes explicit launch/cancel from `run` and Player Hub, literal arguments/cwd/environment, real child TTYs, Unicode/control sequences, resize, normal exit status, Ctrl+C delivery, Ctrl+], external signals, ignored-TERM process-group cleanup, input EOF, missing/spawn failures, input overflow/stalls, output failures/stalls and slow final-output drain.
- An empty-cache, offline npm installation with scripts disabled runs both onboarding and Agent PTY scenarios outside the checkout. No real Agent account or process is used by automation.
- CI runs the same gate on macOS and Ubuntu with Node 22; results are tracked on the PR. T7 is still pending and the PR remains Draft.

## Linux CI correction

This intermediate approach was superseded by the final-output handshake below. The maintained node-pty runtime is unmodified.

The first Linux run exposed PTY EOF reported as `EIO` and buffered output lost at close during backpressure. Keep the original byte-count/exit-status assertions. Treat only the PTY reader's `EIO` as EOF (as upstream does internally), not as an input/output stream failure. Extend the guarded upstream patch to drain already-buffered readable bytes before its error/close handling and defer forced close while buffered bytes remain. The buffer is bounded by the native read stream; normal stdout backpressure and stall handling still apply. Verify the unchanged full suite on both CI platforms before handing over dev.6.

## Final-output handshake amendment

The isolated Linux reproduction confirmed that the child wrote all 524,299 fixture bytes but closing the PTY session leader still lost the final bytes, even after readable-buffer fixes. Retaining a small supervisor until drain preserved every byte. Replace the upstream JavaScript patches with an unmodified node-pty runtime and a bundled Node session host. The host spawns the exact configured executable/argument array with inherited terminal descriptors, cwd and environment; no shell interpolation is introduced.

A private temporary Unix socket carries only child-exited/drained lifecycle messages, never terminal content. After child exit, the host retains the controlling terminal until Padcode has delivered pending output and observed a quiet read interval. Padcode then acknowledges drain and the host exits with the child's status. Ctrl+C reaches the child process group; the host ignores it. Emergency termination still uses group TERM/KILL. Add a 10-second final-drain deadline to bound a descendant that keeps producing output after the selected Agent exits; exceeding it is an explicit failure, never a successful truncated exit. This refines the original timeout criterion for an observed lifecycle issue. Remove the ineffective upstream timeout/buffer modifications and retain the existing full-byte assertions on both platforms.

The final handshake passed all 15 PTY tests in both local macOS and an isolated Linux arm64 / Node 22 container, including full 512 KiB output plus the final marker. The disposable container was removed after validation.
