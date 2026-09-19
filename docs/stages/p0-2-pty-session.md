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

Use the pinned Unix `fd` accessor with a bounded asynchronous writer to avoid node-pty's unbounded write queue. Pause terminal input at 64 KiB, reject more than 1 MiB queued input and terminate after 10 seconds without progress. Pause PTY output on stdout backpressure and enforce the same stall timeout. A narrowly checked runtime patch defers node-pty's 200 ms exit socket timer while output is paused, avoiding truncation during slow final-output delivery. Cover this coupling with actual PTY and slow-consumer regression tests; retain upstream copyright/license and document the modification.
