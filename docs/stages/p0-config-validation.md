# Bluetooth-first onboarding validation

Status: implementation, local automation and macOS/Ubuntu CI complete; physical PS4 Bluetooth acceptance pending. [PR #2](https://github.com/thinxpro/padcode/pull/2) remains Draft. The subsequent Warp permission failure and fix are recorded in the [permission ownership stage](fix-bluetooth-permission-host.md).

## Scope and dependency

The pre-implementation plan commit is `37ce2c0`. Branch `feature/bluetooth-onboarding` builds on unmerged Controller Lab and initially targets `feature/controller-lab`, without implicitly merging PR #1.

The user explicitly prioritized Bluetooth over USB. Button/axis, three reconnects, background input and ten-minute stability criteria remain. Power-cycle the Bluetooth controller instead of unplugging a USB cable.

## Automated results

Local environment: macOS 27.0 / arm64 / Node 23.5.0 / SDL 3.4.16. Run `npm ci --ignore-scripts`, then `npm run check`.

The local gate passed all 45 tests with zero failures/skips. Repository CLI JavaScript line coverage was 98.72%, branch coverage 93.10%; Objective-C/SDL coverage is excluded. Coverage was reviewed. For example, the installed-package platform-mismatch test exercises the entry-point exception handler, but installed-copy execution does not count toward checkout `dist` coverage.

Tests retain all Controller Lab checks and add persistence, executable discovery without execution, Bluetooth adapter errors/identity, subprocess timeout/cancellation, fresh SDL press validation, complete real PTY setup (colored narrow and plain modes) and local npm installation. CI status is tracked through PR checks.

[CI for implementation commit `0c64c93`](https://github.com/thinxpro/padcode/actions/runs/35321800645) passed the full Node 22 gate on macOS and Ubuntu. Later commits only recorded evidence; see [latest PR checks](https://github.com/thinxpro/padcode/pull/2/checks).

Test harness correction: colored exit tests must continuously drain PTY output like a real terminal. Otherwise macOS terminal restoration can block while waiting for output to drain, causing a false timeout. Ctrl+C, termios restoration and exit-code assertions were retained; exit criteria were not relaxed.

The npm integration test uses temporary prefix/cache directories, installs the current-platform tarball, then runs help, the native SDL virtual device and full first-run/restart flow outside the checkout. It does not change global npm installation or real configuration. It also verifies that mismatched platform packages reject native helper execution.

Bluetooth unit tests use simulated adapters. At this stage, native automated checks only validated arguments without radio access. Actual discovery, permission dialogs, pairing and connection require physical evidence. CI never automatically pairs devices or counts simulation as B9 acceptance.

## Acceptance status

| Criterion | Status |
| --- | --- |
| B1–B8 automated/install/terminal checks | Local and macOS/Ubuntu CI passed |
| Physical portions of B2/B4 | User validation pending |
| B9 actual PS4 workflow and stability | User validation pending; PR remains Draft |

## Physical procedure: product interaction in terminal

Run `node dist/cli.js` in the built checkout, or `padcode` after installing the test package. First launch enters setup; use `padcode config` when configuration already exists.

1. Disconnect USB. With the controller off, hold Share + PS until the light bar flashes rapidly.
2. Select the default Bluetooth route. Allow the macOS Bluetooth prompt and record whether it appears. From dev.2, permission belongs to `padcode-bluetooth`; enable the radio in system settings if it is off.
3. Scan in terminal, confirm the PS4 name/address, then select pairing/connection. Record success, failure or unsupported authentication mode; do not skip errors.
4. Select the corresponding SDL controller and press a button. Confirm INPUT CHECK PASSED.
5. Choose an installed agent or custom command, confirm the profile and save.
6. Exit and restart. Confirm Player Hub and persistent settings. Historical verification is not current online status.
7. Open Controller Lab. Test D-pad, face buttons, L1/R1, L3/R3, Share, Options, both sticks and L2/R2. A five-second X hold/release should produce exactly two button edges.
8. Turn the controller off and wake it with PS. If necessary, reconnect the paired device through terminal setup. Repeat three times; state must clear and recover.
9. Operate the controller while another app has focus, then inspect input on return. Continue for ten minutes; check for stuck state, repeated submissions or crashes.
10. Test q, Q, Esc (dashboard) and Ctrl+C, confirming the terminal remains usable. Setup menus use q/Ctrl+C for cancellation.

Report terminal/version, controller model, permission behavior, each result and failure reproduction steps. No agent credentials are needed.

## Explicit limitations

- Product configuration stays in terminal; system permission and radio settings may require system UI.
- PIN/passkey comparison is unsupported and never auto-approved.
- Built-in Bluetooth pairing is macOS-only; other platforms receive an explicit explanation and USB/configure-later options.
- Agent commands and the basic profile are saved only; execution/key mapping await the PTY stage.
- No npm registry publication; local tarballs are current-platform development packages, not universal releases.
