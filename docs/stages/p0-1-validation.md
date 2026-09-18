# P0-1 validation record

Status: implementation and automated validation complete; physical acceptance pending. Required hardware criteria remain mandatory and are not weakened or made optional because testing is pending.

The user subsequently prioritized Bluetooth. The USB procedure below records the original plan; use the [Bluetooth setup and acceptance procedure](p0-config-validation.md) for current testing. Button/axis checks, three reconnections, background input and ten-minute stability requirements remain unchanged.

## Environment

- Local macOS 27.0 / arm64.
- Node.js 23.5.0 installed locally; CI uses Node.js 22.
- CMake 4.0.3 / AppleClang 21; build explicitly selects the SDK matching Xcode.
- SDL 3.4.16 static build; source SHA-256 pinned in CMakeLists.txt.
- TypeScript 5.9.3 with locked npm dependencies and no runtime npm dependencies.

## Automated evidence

Complete commands: `npm ci --ignore-scripts`, then `npm run check`.

The local gate passed: 22 tests, zero failures/skips; CLI JavaScript line coverage 100%, branch coverage 96.41%, function coverage 97.67%. These figures exclude C++/SDL coverage. Uncovered branches were reviewed: primarily terminal output error types, repeated cleanup and environment-state branches. Missing helpers, protocol failures, timeouts, signals, forced cleanup, slow consumers and EPIPE have dedicated tests.

Tests cover event schema/order/UTF-8/size limits, input state/deadzones, device isolation, narrow/plain rendering, CLI errors, SDL virtual devices, slow consumers/closed pipes, real PTY exit/error/signal restoration and helper cleanup.

[GitHub CI](https://github.com/thinxpro/padcode/actions/runs/35304321740): implementation commit `885423c` passed the complete Node 22 gate on macOS and Ubuntu. Later commits only updated validation documentation and stage status; see [latest PR checks](https://github.com/thinxpro/padcode/pull/1/checks).

The first Linux CI run showed that a headless SDL build requires explicit `SDL_UNIX_CONSOLE_BUILD=ON`. This was configured according to the pinned SDL README without removing tests or changing scope/acceptance.

The SDL virtual device exercises real SDL APIs, the production event loop and JSONL serialization. It validates the software path, not PS4 hardware compatibility. Real PTY tests verify termios and terminal sequences, not subjective interface quality.

## Acceptance status

| Criterion | Status |
| --- | --- |
| A1–A7 automation and interface checks | Local and macOS/Ubuntu CI passed |
| A8 PS4 USB buttons/axes (original transport; now Bluetooth first) | Physical testing pending |
| A9 reconnection, background input and ten-minute stability | Physical testing pending |
| A10 complete acceptance | Incomplete; PR remains draft |

A short local physical enumeration emitted SDL ready but no physical controller connection event. No permission or compatibility pass was inferred.

## Original user test procedure

Run from the built local checkout:

```sh
node dist/cli.js controllers
```

1. Connect the PS4 controller with a USB data cable; record whether PLAYER READY and the device name appear.
2. Press/release D-pad directions, four face buttons, L1/R1, L3/R3, Share and Options. Check HELD, the diagram and RECENT INPUT.
3. Move both sticks and squeeze L2/R2; check neutral values after release.
4. Hold X for five seconds, then release. BUTTON EDGES should increase twice, not continuously.
5. Unplug while holding a button; verify state clears. Reconnect and repeat three times.
6. Focus another app, use the controller, return and inspect RECENT INPUT. Continue for ten minutes and observe failures.
7. Test Q and Ctrl+C exit separately; verify normal terminal input and cursor restoration.

Report terminal/version, controller model/transport and each result. Include reproduction steps for failures; no agent credentials or project code are needed.

## Limitations at this stage

- No agent launch, key injection, configuration wizard, voice or desktop control in P0-1. Onboarding was added in a later PR.
- Initial installation used the source-development workflow; compilation-free distribution was unverified at this stage.
- Dashboard device names use safe ASCII; JSON preserves complete names.
- The dashboard selects the first connected device; JSON emits events for all devices.
- The SDL helper targets Unix; Windows lifecycle handling is not implemented.
