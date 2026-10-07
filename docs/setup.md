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

The current development build saves agent configuration and the key profile but does not execute them. Player Hub explicitly states that agent sessions are not implemented. Historical input verification does not prove a device is currently online.

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
