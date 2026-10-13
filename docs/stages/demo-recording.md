# Demo recording

Status: implemented; automated acceptance passes. No hardware acceptance required for the scripted recording; the optional real-footage clip is maintainer work recorded separately.

The README has a demo slot (`docs/media/demo.gif`) left by [R1](release-ready-content.md). This stage fills it with a reproducible, scripted terminal recording and documents how the maintainer records a real controller clip later. The maintainer chose this approach on 2026-10-13: a scripted recording now, plus a guide for real footage that can replace or join it, recorded with [VHS](https://github.com/charmbracelet/vhs).

## Approach

- The recording runs the real Padcode code from `dist/`: Player Hub, launch confirmation, the tmux controls pane, voice insertion, the quick commands palette and the Options menu.
- Only four parts are stand-ins, all under `scripts/demo/`:
  - **Virtual controller**: a helper that speaks the controller protocol and replays a scripted timeline of button, trigger and stick events.
  - **Stand-in Agent** (`demo-agent`): a small, neutral interactive CLI with a prompt, canned replies and a Yes/No approval. It does not imitate any vendor's interface or branding.
  - **Microphone helper and transcriber**: return a fixed sentence. Nothing is recorded.
  - **Configuration**: a temporary `XDG_CONFIG_HOME` and a temporary `my-app` project directory. The user's configuration, Bluetooth, microphone and network are never touched.
- A one-line HUD below the terminal shows each simulated button press and a caption. It always reads "VIRTUAL CONTROLLER / scripted demo", so the recording is never mistaken for hardware evidence. The README caption says the same.
- VHS records an outer tmux layout: Padcode on top, the HUD below. The HUD and the virtual controller read the same timeline, so captions match the input.
- Hub-launched sessions get the Hub's `AudioPort` instead of creating `new NativeAudio()`, so the demo (and tests) can inject a microphone. Real users get the same `NativeAudio` as before.

## Storyline (about 40 s)

1. Type `padcode` in `my-app`. The welcome sweep plays and the Player Hub appears.
2. D-pad moves through the Hub. X selects Start agent session, D-pad picks Start on the confirmation, X launches.
3. The session opens with the controls pane. Hold L2 to dictate: the sentence is typed into the Agent's input and not sent. X sends it.
4. The Agent proposes an edit and asks for approval. D-pad picks an option and X confirms. The Agent reports passing tests.
5. Share opens quick commands. D-pad picks a custom command and X types it into the Agent.
6. Options opens the controls menu. End session returns to the Hub, and O exits.

## Acceptance

- D1: `npm run demo:record` builds Padcode and regenerates `docs/media/demo.gif` and `docs/media/demo.mp4` from `scripts/demo/demo.tape`. It needs `vhs` and `tmux` and fails with a clear message when either is missing. The GIF is at most 5 MB.
- D2: `npm run demo` plays the same scripted demo live in the current terminal without VHS.
- D3: The demo uses the real Hub, confirmation, panel session, voice insertion, quick commands and Options menu. Only the controller helper, microphone helper, transcriber, Agent and configuration location are stand-ins. It writes nothing outside its temporary directory and removes that directory on exit.
- D4: Every recorded frame after launch shows the HUD label "VIRTUAL CONTROLLER / scripted demo". The README labels the GIF as a scripted recording with a virtual controller and a stand-in Agent and links to the recording guide.
- D5: Player Hub sessions use the Hub's `AudioPort`. Default behavior is unchanged.
- D6: An automated test runs the full demo timeline in a pseudo-terminal, without VHS and without recording. It asserts the Hub, confirmation, controls pane, dictated text, approval, quick command and Options menu all appear, the Agent receives the expected input, and the process exits 0 with the temporary directory removed. It runs in `npm run check` on macOS and Linux.
- D7: `docs/demo.md` explains how to re-record the scripted demo and gives a shot list and settings for real footage of a physical controller with a real Agent. The guide covers privacy (a throwaway project, no real session content or account details on screen) and conversion to GIF and MP4 within size limits.
- D8: `npm run check` passes with no failures or skips.

## Test matrix

| Area | Automated | Manual |
| --- | --- | --- |
| Hub uses injected audio (D5) | `test/demo.test.mjs` voice step through the Hub path | — |
| Full storyline (D3, D6) | `test/demo.test.mjs` PTY run of `scripts/demo/run.mjs` | watch `npm run demo` |
| Stand-in Agent behavior | `test/demo.test.mjs` (prompt, send, approval, exit) | — |
| Cleanup and failure paths | `test/demo.test.mjs`: temporary directory removed; HUD and driver exit when Padcode exits | — |
| Missing tools (D1) | `test/demo.test.mjs`: recorder reports a missing `vhs` | — |
| Recording output (D1, D4) | — | `npm run demo:record`, check size and HUD label in frames |
| Real footage (D7) | — | Maintainer, optional, outside this PR |

No hardware acceptance is required: the scripted demo uses no hardware and is not hardware evidence.

## Validation evidence

Environment: macOS 27.0 (Apple silicon), Node 24.21, tmux 3.7c, VHS 0.12.1, 2026-10-13.

- Plan committed before implementation: `9e16e22`.
- D1: `npm run demo:record` wrote `docs/media/demo.gif` (1.34 MB) and `docs/media/demo.mp4` (0.74 MB), 37 s long. The recorder exits 2 and names `vhs` and `tmux` when they are missing (`test/demo.test.mjs`).
- D2: `npm run demo` plays the same timeline; the PTY test runs it at 0.35x hold times.
- D3, D6: `test/demo.test.mjs` asserts the Hub, confirmation, controls pane, the 43-character dictated sentence (typed, not submitted), approval, quick command `/test`, Options menu, END SESSION? and SESSION OVER screens; the stand-in Agent received the sentence and `/test` and answered `yes`; exit code 0; no `padcode-demo-*` directory is left.
- D4: the same test checks the HUD label on every captured step. Frames from the recording were reviewed at 3 s intervals: the label is visible throughout. The README caption names the virtual controller and stand-ins.
- D5: `launchConfigured` takes the Hub's `AudioPort` (default `new NativeAudio()`); the demo's voice step goes through it.
- D7: `docs/demo.md`.
- D8: `npm run check`: 208 tests, 208 pass, 0 fail, 0 skipped.

Implementation notes:
- VHS's `Wait+Screen` only reads the normal screen buffer, and tmux draws on the alternate screen. The tape therefore waits for a marker the shell prints after the demo exits, then hides the rest.
- The virtual controller starts at the end of the event file. The Hub starts a new helper after each session, and it must not replay earlier presses.
- "Agent exited with status 130" on the Hub after End session is Padcode's normal report for an Agent ended from the menu.

The optional real-footage clip is still pending; it is maintainer work and is not hardware acceptance.
