# C2: Isolated terminal controls

Status: implemented in dev.9; automated acceptance passes locally and physical/manual acceptance is pending. This plan was committed before runtime changes. Stacked on PR #11 (`feature/continuous-controller-handoff`, C1); retarget to `main` after C1 merges. Do not merge C1 as part of this work.

## Scope

Show controller state in a persistent Padcode status pane that the Agent cannot overwrite, without changing the Agent's native TUI or the C1 input rules. Use a private tmux server as the multiplexer, validate it with a controlled prototype, document dependency and process ownership, and keep the existing transparent mode as an explicit fallback.

Out of scope: the Options controls panel, interrupt/end-session actions and controller-driven scrollback (C3); voice (C4-C6); changing the key profile; installing tmux; publishing a package.

## Dependency decision

- tmux 3.2 or newer is required for the panel. It is a user-installed CLI dependency, detected with `tmux -V`. Padcode never installs it. Development and CI install it explicitly (`brew install tmux`, `apt-get install tmux`).
- Missing or older tmux, `TERM=dumb`, a non-interactive terminal or `PADCODE_PANEL=off` selects transparent mode. The launch confirmation states the display mode and, when tmux is missing, the install command. Transparent mode keeps dev.8 behavior and its title-only status limitation.
- If a panel launch fails before the Agent starts, Padcode removes the private server, reports the reason and continues in transparent mode with the same controller feed. After the Agent starts, a failure ends the session normally instead of relaunching the Agent.

The prototype passes when the C2-P criteria below pass with tmux 3.7c on macOS and the CI tmux version on Ubuntu. If C2-H later shows that tmux cannot preserve Codex in Warp or Terminal.app, revise this decision in a committed plan before replacing it; do not substitute a homegrown terminal emulator.

## Process ownership

```text
padcode run (coordinator, child of the user's terminal)
 |- SDL helper (the C1 feed; still exactly one reader)
 |- private IPC server   <dir>/i   (mode-0700 dir, per-session token)
 |- tmux server          <dir>/t   (-f /dev/null, private socket, no user config)
 |   |- Agent pane: node pane-agent.js -> node-pty -> agent-host -> Agent  (only Agent PTY writer)
 |   `- Status pane: node pane-panel.js (input disabled, fixed height)
 |- tmux control client  (-C, no-output, ignore-size, read-only: pane-mode notifications)
 `- tmux client          (foreground, inherits the terminal)
```

1. The coordinator keeps the SDL feed so controller and Bluetooth permissions stay attributed to the user's terminal, not the daemonized tmux server.
2. The Agent pane runs the existing `runAgent` bridge. Keyboard bytes reach it through tmux; controller bytes arrive over IPC and enter the same bounded `PtyWriter` tagged as controller input. Padcode never uses `tmux send-keys` for Agent input. Ctrl+] remains the bridge's emergency exit.
3. The Agent launch specification (executable, literal arguments, directory) is sent over IPC after the bridge authenticates, so tmux never parses Agent arguments. The bridge removes the private server's `TMUX`/`TMUX_PANE` and restores the user's original values, so Agent tools cannot target the private server.
4. The status pane renders only IPC status messages and is input-disabled. It is the only Padcode output on screen during the session; nothing is appended to Agent output, and title updates are not emitted in panel mode.
5. tmux runs with `status off`, `prefix None`, prefix and root key tables cleared, and only Agent-pane mouse bindings for wheel history and drag selection. Pane focus cannot move to the status pane. A `window-resized` hook keeps the status pane at its fixed height.
6. While the Agent pane is in tmux history/copy mode, the coordinator holds controller input: events are consumed and no controller bytes reach the Agent. Leaving the mode re-applies the C1 neutral barrier (all buttons released for 250 ms) before routing resumes; no Options press is needed if mapping was active before. Keyboard input in copy mode belongs to tmux, as usual.
7. Exit: the bridge reports the Agent's status and waits. The coordinator captures the Agent pane's final visible screen, detaches the client silently, kills the private server, prints the captured screen to the user's terminal, restores terminal modes and returns the Agent status. The capture is printed only to the user's own terminal and is never logged.
8. Failure: a lost coordinator closes IPC, which makes the bridge stop the Agent process group and the panel exit; the private server then exits because no session remains (`exit-empty`, `exit-unattached`). A crashed status worker is replaced with a new status pane up to three times; after that the session continues without a status pane. The Agent continues in every case. A bridge that disconnects without an exit report ends the session with status 1.

## IPC schema

Newline-delimited JSON, at most 4 KiB per line, over a Unix socket in a mode-0700 directory. The first message is `{"t":"hello","role":"agent"|"panel","session":"<128-bit hex>"}`. A wrong token, unknown role, duplicate role, malformed JSON, oversize line or an unknown message type destroys that connection. Messages:

| Direction | Message |
| --- | --- |
| coordinator -> agent | `launch {command,args,cwd,env}` once; `keys {data:base64}`; `cancel` (discard queued controller bytes); `close` |
| agent -> coordinator | `exit {code}` once |
| coordinator -> panel | `status {text}` |

Messages from the wrong role or after `exit`/`close` are protocol violations. Keys and status text are bounded; key payloads are limited to 64 bytes per message.

## Status pane

Two rows (one when the terminal has fewer than 12 rows), ASCII text for deterministic width, colors only when `NO_COLOR` is unset:

```text
PADCODE // GAMEPAD ACTIVE                         OPTIONS PAUSE | CTRL+] END
D-PAD ARROWS  X ENTER  O ESC  L1 TAB  R1 SHIFT+TAB   WHEEL HISTORY
```

State colors: ACTIVE green, ARMING cyan, PAUSED/HISTORY/RECONNECTED yellow, DISCONNECTED/INPUT LOST/UNAVAILABLE red. Low-priority segments drop first on narrow widths; the state word never truncates before the `PADCODE` label.

## Automated acceptance

- C2-P1: a controlled TUI in the Agent pane receives exact controller and keyboard bytes (including Unicode), and tmux answers its cursor-position query.
- C2-P2: alternate-screen entry/exit and color output from the Agent are preserved in the Agent pane; capture of the Agent pane after repeated status updates contains Agent text and no Padcode status text.
- C2-P3: resizing the outer terminal resizes the Agent PTY to the pane size and keeps the status pane height fixed.
- C2-A1: IPC rejects wrong tokens, stale session IDs, duplicate roles, malformed JSON, oversize lines, unknown types and wrong-role messages; valid sessions are unaffected.
- C2-A2: status rendering: every state word, narrow widths down to 20 columns, one-row mode and `NO_COLOR` output.
- C2-A3: tmux detection: missing binary, unparsable and old versions, `PADCODE_PANEL=off` and `TERM=dumb` select transparent mode with a recovery message.
- C2-A4: copy mode holds controller input; leaving it re-arms only after a neutral barrier; queued controller bytes are cancelled on entry.
- C2-A5: normal Agent exit, Ctrl+] and SIGTERM return the correct status, restore termios, print the final screen without tmux exit messages, stop the SDL helper and remove the private directory and server.
- C2-A6: killing the coordinator with SIGKILL terminates the Agent process group and the private tmux server within 5 seconds.
- C2-A7: a killed status worker is respawned and the Agent keeps receiving input.
- C2-A8: startup failure before Agent launch falls back to transparent mode with the same feed and no Agent relaunch.
- C2-A9: existing transparent-mode, C1 handoff and PTY suites remain green; `npm run check` passes locally and in macOS/Linux CI with tmux installed and no required test skipped.

Record fixture-path controller-to-Agent latency (helper event to Agent read, including the fixture's 10 ms polling) as p50/p95. This is not hardware latency.

## Physical and manual acceptance (C2-H)

- C2-H1: record artifact checksum, macOS/CPU, Warp and Terminal.app versions, tmux version, Codex version and controller transport.
- C2-H2: in Warp and Terminal.app, Codex renders natively in the Agent pane; keyboard typing, paste, Enter, Escape and Ctrl+C behave as without Padcode.
- C2-H3: the status pane stays visible and correct during streaming output and Codex approval prompts; status changes for arm, pause, disconnect and reconnect.
- C2-H4: resize the window repeatedly; Codex reflows and the status pane keeps its height.
- C2-H5: wheel history scrolls Codex output; drag selection copies text to the clipboard; controller input is held while history is open and resumes after release.
- C2-H6: exiting Codex, Ctrl+] and closing the terminal window leave no `tmux` or Agent processes; the final Codex screen remains readable after a normal exit.
- C2-H7: uninstall tmux temporarily or set `PADCODE_PANEL=off`; launch shows the recovery message and transparent mode works.

The PR stays draft until C2-H passes and C1-H is recorded. Known limits to verify: native terminal scrollback is replaced by tmux history inside the session; the outer terminal's own selection may require its mouse-reporting bypass modifier.

## Implementation notes

- Plan adjustment (status worker recovery): the plan first proposed respawning the dead status pane in place and falling back to a border message. Keeping a dead pane (`remain-on-exit`) prevents the private server from exiting when every Padcode process is gone, which failed C2-A6 in the prototype. The status pane is therefore never kept dead; the coordinator splits a new one instead, and after three replacements the session continues without it. No border message is drawn.
- tmux prints `[exited]`/`[server exited]` when a client loses its server. The coordinator detaches the client with `detach-client -E 'exit 0'` before stopping the server, so normal exits print only the captured Agent screen.
- macOS sets the `PENDIN` termios state bit whenever canonical mode is re-enabled. The PTY suites compare terminal modes with that kernel state bit masked; all configuration flags are still compared exactly.
- The packaged-install suite (`agent_pty.py`) now runs confirmation, Unicode input, Ctrl+C, normal exit, Ctrl+], SIGTERM and SIGINT in both panel and transparent (`PADCODE_PANEL=off`) modes.

## Validation record

Plan commit: `7c0c676`. On macOS 27.0 arm64 with Node 24.21.0 and tmux 3.7c (Homebrew), `npm run check` passed 101 tests with zero failures or skips. C2-P1 through C2-P3 and C2-A1 through C2-A9 pass locally; the prototype criteria therefore pass on macOS. Fixture-path controller-to-Agent latency over 20 presses: p50 11.0 ms, p95 11.3 ms (includes the fixture helper's 10 ms polling; not hardware latency). The current-platform artifact is `padcode-0.1.0-dev.9.tgz`, npm SHA-1 `490346f7010f18c84b2f2a27f68fd09f6f6370f4`. macOS/Ubuntu CI with tmux installed is required and tracked on the PR. C2-H1 through C2-H7 have not been performed: no Warp, Terminal.app, Codex or physical controller session was run, so the PR stays draft.
