# Terminal setup guide

The intended flow is npm installation → `padcode` → terminal configuration. Local development tarballs are installable; npm registry publication has not started.

## First launch

Run `padcode` in an interactive terminal. Select with number keys, confirm with Enter, cancel menus with q and interrupt operations with Ctrl+C.

1. **LINK CONTROLLER**: Bluetooth is the default; USB and configure-later are alternatives.
2. **Bluetooth devices**: list paired devices first. For a new controller, hold Share + PS until the light bar flashes rapidly, then choose scan. Select a device and explicitly confirm pairing/connection. Progress and errors appear in terminal.
3. **INPUT CHECK**: select the SDL controller and press a button. Only a fresh press from the selected device passes; pairing alone is insufficient. Devices with mismatched transport/serial metadata are not selected automatically; missing metadata requires manual selection.
4. **CHOOSE YOUR AGENT**: select an executable found on PATH or enter a custom command. Enter arguments individually; spaces remain part of each literal argument, with no shell expansion. Setup never executes the agent.
5. **LOADOUT**: review and select the basic key profile.
6. **SAVE POINT**: review and confirm configuration. Cancellation or failure preserves the previous file. System Bluetooth pairing is separate; cancelling setup does not undo an existing pairing.

Incomplete verification is labeled UNVERIFIED. Deferral is allowed but never reported as success.

## Later launches and changes

- `padcode`: open Player Hub when configuration exists; access live input checks, configuration, interface preview or exit.
- `padcode config`: rerun setup, optionally keeping the existing agent command and arguments.
- `padcode controllers`: live controller dashboard.
- `padcode controllers --json`: structured diagnostics. Connection events may contain device serial numbers; inspect logs before sharing.
- `padcode demo`: simulated interface preview.

Saving configuration never starts an agent. Select Start agent session in Player Hub or run `padcode run` from your project, review the executable/arguments/directory, then explicitly confirm. Keyboard PTY forwarding and the terminal-basic gamepad profile are available. Historical input verification does not prove a device is currently online.

## macOS system boundaries

The tool uses IOBluetooth to initiate discovery, pairing and connection from terminal. No additional Homebrew Bluetooth utility is required.

Initial Bluetooth authorization may display a system dialog. If denied, allow `padcode-bluetooth` under Privacy & Security → Bluetooth. If Bluetooth is off, enable it in macOS. These are system-controlled operations; Padcode cannot promise that every permission or radio setting can be changed from terminal. Product configuration and error recovery remain in terminal.

Native pairing currently supports flows without PIN/passkey comparison. Authentication challenges produce an explicit unsupported error and are never automatically approved. Actual PS4 pairing and permission behavior require physical validation on the target system.

## Local files

Configuration defaults to `~/.config/padcode/config.json`, or uses an absolute `XDG_CONFIG_HOME`. Atomic replacement writes use mode 0600; newly created parent directories use 0700. Configuration contains the selected device name/address, transport preference, historical input verification, agent executable/arguments and profile. It contains no account or API key.

npm uninstall preserves configuration. To reset, explicitly remove the configuration file; the next launch opens setup. Do not put secrets in agent arguments; the agent manages its own authentication.

## Recovery

If discovery finds no device, re-enter Share + PS pairing mode and scan again. If connection fails, wake the controller and retry, or explicitly choose USB/configure-later. If the system connects but no input appears, repeat SDL detection rather than skipping verification. For damaged configuration, choose reconfigure or preserve-and-exit; only final save confirmation overwrites the file.

### Warp Bluetooth permission crash (fixed in dev.2)

`dev.1` may show `Helper stopped (SIGABRT)` under Warp: macOS attributes privacy access to a host terminal without a Bluetooth usage declaration. Before Bluetooth access, `dev.2` establishes the helper's own permission identity and checks its usage metadata. Normal user consent remains required; the tool does not modify Warp, the permission database or radio settings.

This compatibility layer resolves private macOS responsibility APIs at runtime. Future OS versions may not support them. Missing APIs or failed ownership checks return a terminal error before Bluetooth access. The helper keeps the same PID, preserving timeout and Ctrl+C handling. Run `build/native/padcode-bluetooth diagnose-permission` from the installed package directory for a no-radio ownership diagnostic; it is not a physical pairing test.

### Incomplete Bluetooth scans (dev.3)

Scanning now disables remote name updates and lists only devices returned by the current inquiry. Cached names may be unavailable; those entries retain their address and an explicit unnamed-device label. Do not select an unidentified device by guesswork.

macOS can delay, fail or omit the inquiry-completion callback. After a 20-second inquiry deadline, devices already found remain selectable with a SCAN INCOMPLETE warning; partial results are also preserved when macOS reports a native completion error. Neither case is labeled a complete scan or verified input. Cancellation and OS aborts remain failures. If no devices were found, the error distinguishes a missing start callback, active timeout or native error.

The process allows up to 35 seconds including macOS initialization, then is terminated if necessary. Before retrying, close other discovery windows, wait 15 seconds and re-enter SHARE + PS pairing mode. For direct native diagnostics, run `PADCODE_BLUETOOTH_DEBUG=1 build/native/padcode-bluetooth scan` from the installed package directory. Phase diagnostics on stderr contain no device identifiers; the normal JSON device list on stdout does contain identifiers, so inspect it before sharing. The terminal wizard captures native stderr internally rather than displaying debug traces.

## Controller-operated menus (dev.4)

After connecting over Bluetooth or choosing USB, the setup menus start the SDL input stream. Press **cross (X)** once on the intended controller to claim menu control. This first press does not confirm an option. When configuration already identifies a controller, startup also enables menu input in Player Hub and configuration editing.

| Input | Menu action |
| --- | --- |
| D-pad up/down | Move the highlighted selection; wrap at the ends |
| Cross (X) | Confirm the highlighted option |
| Circle (O) | Select an explicit Back/Cancel/Exit option when available; otherwise cancel setup without saving pending changes |
| Keyboard arrows | Move selection |
| Number + Enter | Select the numbered option |
| Enter | Confirm the highlighted/default option |
| q / Ctrl+C | Cancel; Ctrl+C returns an interrupted exit status |

Input-check choices, installed-agent selection, key profiles, save confirmation and Player Hub are all controller-operable. Custom executable paths and arguments remain keyboard text fields; controller actions are ignored there. This is menu navigation, not agent-session key injection.

Hold events do not repeat selections. Confirmations are not queued across menus. Input is restricted to the claimed compatible controller; missing identity metadata is resolved by the physical claim press instead of guessing a device. A disconnect leaves keyboard input available; reconnect and press X again to reclaim control. Helper failures provide keyboard recovery. The input check and menus share one helper, which is stopped before entering Controller Lab or exiting.

## Keep connected controllers visible (dev.5)

`Scan nearby` now combines fresh inquiry results with a refreshed list of known paired/connected devices. A controller that is already connected does not have to appear in a new inquiry to remain selectable. Entries are deduplicated by Bluetooth address, connected entries are prioritized, and labels distinguish `known`, `nearby` and `known + nearby`. The nearby count includes only inquiry results.

An empty or failed scan leaves known controllers in the same picker. Select a connected controller and choose `Use this connected controller` to continue without restarting configuration or repeating pairing/connection. SDL input verification remains separate.

If the known-device status refresh also fails, previously known entries remain labeled `status unknown / cached`. Selecting one checks its connection instead of assuming the old connected state is still true. Previous inquiry-only entries are not retained across later scans. Cancelling still stops the operation.


## Agent sessions (dev.6)

Install the current-platform dev.8 package, change into a project, then run `padcode run`. An existing configured Agent is required; use `padcode config` to choose another. The confirmation defaults to Cancel. A uniquely matched saved controller transfers from the menu and activates after its buttons are released; unidentified controllers still use Options to enable mapping.

- The Agent receives the current directory, inherited environment and literal configured arguments. No shell command string or Agent API proxy is used.
- Ctrl+C goes to the Agent, preserving its interrupt/approval behavior. Ctrl+] is reserved for ending the session and cannot be sent as literal input.
- Normal Agent exit returns its status. Emergency exit/external SIGINT return 130; external SIGTERM returns 143.
- On exit, Padcode restores terminal raw mode and common cursor/screen/input modes, and terminates its owned PTY process group with bounded escalation. Deliberately daemonized processes are outside this contract.
- Input is paused at 64 KiB and rejected above 1 MiB queued data. Input/output stalls lasting 10 seconds stop the session. Final output must drain within 10 seconds after the selected Agent exits; a lingering descendant that prevents drain causes an explicit failure. This is an interactive terminal bridge, not a bulk transfer tool.
- Padcode stores no session transcript. Agent accounts, network use and permissions remain the Agent's responsibility.

Manual compatibility is pending. See the [stage checklist](stages/p0-2-pty-session.md); automation uses local fixtures, not real Agent accounts.


## Gamepad Agent controls (dev.8)

A uniquely identity-matched configured controller works directly in Player Hub and launch confirmation; no extra X claiming press is required. Initial setup or missing identity metadata still uses explicit claiming; D-pad up/down can claim and navigate together. On startup/reconnection, allow 250 ms for initial device state to settle and release held buttons.

Agent mapping starts **PAUSED** to avoid carrying the launch confirmation into the Agent. Press and release **Options** to enable it. The terminal title shows ACTIVE, PAUSED, DISCONNECTED or INPUT LOST where title updates are supported; TERM=dumb prints status lines. Padcode restores the prior title on exit. Terminals that suppress title updates still accept Options and keyboard controls.

| PS4 control | Agent input |
| --- | --- |
| D-pad | Arrow keys (fixed CSI sequences) |
| X | Enter |
| O | Escape |
| L1 | Tab |
| R1 | Shift+Tab |
| Options | Pause/resume mapping; never sent to the Agent |

Each fresh button press sends one action; holding does not repeat. The X used to confirm Agent launch and every event during the 250 ms neutral barrier are consumed. Sticks, triggers and voice are not mapped. Keyboard input remains active while gamepad mapping is paused. After disconnect, release buttons, reconnect, then press/release Options; no buffered gamepad actions replay. Helper failure leaves keyboard operation available; restart the session to restore the input helper. Ctrl+] still terminates the session. For routing diagnosis, `PADCODE_INPUT_TRACE=1 padcode run` emits state, generation and device-number metadata without key bytes, typed text, controller serials or Agent output.

Complete the [physical checklist](stages/p0-3-gamepad-agent-input.md) before claiming PS4/Agent compatibility. This is separate from the still-pending two-terminal/two-Agent P0-2 matrix.

## Controls pane (dev.9)

When tmux 3.2 or newer is installed, `padcode run` shows the Agent in its normal interface with a two-row Padcode status pane underneath (one row in terminals shorter than 12 rows). The Agent cannot draw over the pane, and Padcode no longer writes status into the terminal title in this mode. The launch confirmation shows `DISPLAY / Controls pane (tmux x.y)` or explains why it is using transparent mode.

- Padcode never installs tmux. Install it yourself (`brew install tmux`, or `apt install tmux`). Set `PADCODE_PANEL=off` to keep the previous transparent mode.
- The session runs on a private tmux server with its own socket and no user tmux configuration. All tmux key bindings are cleared, so every key, including Ctrl+B, reaches the Agent. Ctrl+] still ends the session.
- Scroll with the mouse wheel to open tmux history for the Agent's output; press q or scroll back to the bottom to return. While history is open the status pane shows HISTORY and the gamepad is held. When you leave it, release all buttons; mapping resumes after 250 ms.
- Drag to select text in the Agent pane; on macOS the selection is copied with `pbcopy`. Your terminal's own selection may need its mouse-reporting bypass modifier. Inside the session, tmux history replaces your terminal's native scrollback.
- When the Agent exits, Padcode prints its final screen to your terminal before returning to the shell.
- If the controls pane cannot start before the Agent launches, Padcode reports the reason and continues in transparent mode with the same controller.

Manual Warp/Terminal.app and physical acceptance are pending; see the [C2 checklist](stages/c2-isolated-terminal-controls.md#physical-and-manual-acceptance-c2-h).

## Returning to Player Hub (dev.11)

Player Hub is now the home screen. Cancelling the launch confirmation, an Agent session ending (including Ctrl+]), leaving Controller Lab or the demo, and finishing or cancelling Edit configuration all return to Player Hub. After an Agent session the Hub shows `SESSION OVER / Agent exited with status N`.

- Controller Lab: hold **O** for one second, then release, to return. A short O press is still shown as test input. Q and Esc also return.
- Demo: press **O** or Q to return.
- Only the Hub's Exit option (O or q on the Hub) leaves Padcode. `padcode run` still runs one session and returns the Agent's status.

## Controls menu (dev.12)

In the controls pane (tmux) mode, **Options** opens the Padcode controls menu over the Agent instead of pausing. The Agent keeps running and is not resized.

| Menu item | Effect |
| --- | --- |
| Resume Agent controls | Close the menu (default) |
| Pause gamepad mapping | Stop sending controller keys; press Options to resume |
| Browse history | D-pad scrolls one line, L1/R1 page up/down, O or Options leaves |
| Send interrupt (Esc) | Send one Esc to the Agent, which stops the running task in Claude Code |
| End session... | Asks again; "End the Agent session" ends it and returns to Player Hub |

In the menu, D-pad moves, X confirms, O or Options closes. The keyboard works too: arrows, Enter, Esc, q and the number keys. After the menu or history closes, release all buttons; controller keys reach the Agent again after 250 ms, so the closing press never does. Scrolling with the mouse wheel opens the same history view. Transparent mode (`PADCODE_PANEL=off` or no tmux) keeps Options as pause/resume.

## Voice capture (dev.14, macOS)

Voice is off until you turn it on: in Player Hub choose **Voice / microphone settings** (dev.15), or use step **VOICE (optional)** of `padcode config`. Choosing a microphone shows what capture does, asks macOS for microphone access for **Padcode Audio**, lists your input devices and offers a 3-second check that plays back with `afplay`. If access is denied, allow Padcode Audio in System Settings > Privacy & Security > Microphone and choose Retry.

In an Agent session (controls pane mode), hold **L2** to record and release to stop; recordings stop at 60 seconds. The status pane first shows `MIC STARTING`; start speaking when it changes to `REC`. Bluetooth headset microphones take about a second to start and switch the headset to call quality, so a wired, USB or built-in microphone works best. Releasing L2 before `REC` (or after less than 0.3 s) discards the clip. While recording, the status pane shows `REC` with a level meter, controller buttons do nothing except **O**, which cancels. Afterwards, Options > **Play last recording** plays it back. Transcription is not available yet, so nothing is typed into the Agent.

Development builds are not signed with a Developer ID, so macOS treats every Padcode update as a new Padcode Audio and asks for microphone access again; the first L2 press after an update shows the macOS dialog, and you hold L2 again once you have allowed it. Recordings are 16 kHz mono WAV files in a private temporary folder that is deleted when the session ends; folders left by a crash are removed on the next session. Linux and transparent mode do not support voice capture.

## Voice drafts (dev.18)

In Player Hub > **Voice / microphone settings**, after the microphone, choose how clips become text:

| Option | Install | Notes |
| --- | --- | --- |
| macOS on-device speech | Nothing | Apple's on-device recognizer; asks for Speech Recognition permission for Padcode Audio. Languages without an on-device model are refused, never sent to a server. |
| whisper.cpp | `brew install whisper-cpp` | Best accuracy for Chinese and mixed speech. Padcode finds existing models or, after you confirm, downloads a pinned official model (574 MB or 1.6 GB) to `~/.local/share/padcode/models` and verifies its SHA-256. |
| Custom command | Your choice | Any program that reads the WAV path given by `{audio}` and prints UTF-8 text; arguments are literal, never shell code. |
| No transcription | - | Record and play back only. |

Each option runs a self-test, and you can record 5 seconds to see the text. In a session, release L2 to see `TRANSCRIBING...` (O cancels), then a **VOICE DRAFT** popup: Keep draft (default, also O), Rerecord or Discard. Reopen a kept draft from Options > Review voice draft. Since 0.1.0-rc.1 drafts are typed into the Agent automatically; see below.

## Voice insertion (0.1.0-rc.1)

After transcription the text is typed into the Agent's input box and **never sent**: press X (Enter) when it looks right. It is always one line, wrapped in bracketed-paste markers when the Agent enabled them (Claude Code does), so it cannot submit by itself. The status pane shows `INSERTED N chars`.

- Options > **Undo voice insert** removes exactly the inserted characters; **Undo and rerecord** does the same and waits for L2. Undo is refused once anything else reached the Agent after the insertion (you typed, pressed a controller key or sent it), so it never deletes your own text.
- Very short transcripts (two characters or fewer, or only digits, punctuation and y/n) open the VOICE DRAFT popup instead, because a single key such as `1` or `y` could answer an approval prompt that appeared while the clip was being transcribed. X there inserts it.
- To check every draft before it is typed, choose **Show the draft first** in Voice / microphone settings; the popup then offers Insert into Agent, Keep draft, Rerecord and Discard.
- Edit inserted text with the keyboard in the Agent's own input box.

