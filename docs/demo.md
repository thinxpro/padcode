# Demo recording

The README demo (`docs/media/demo.gif`, with `demo.mp4` alongside) is a **scripted recording**. It shows real Padcode screens built from this repository: the Player Hub, the launch confirmation, the tmux controls pane, voice insertion, quick commands and the Options menu. Four parts are stand-ins, all in [`scripts/demo/`](../scripts/demo):

| Stand-in | File | What it does |
| --- | --- | --- |
| Virtual controller | `controller.mjs` | Speaks the controller helper protocol and replays the timeline's button and trigger events |
| Agent (`demo-agent`) | `agent.mjs` | A neutral prompt with canned replies and a Yes/No approval. It runs nothing |
| Microphone and transcriber | `audio.mjs`, `transcriber.mjs` | Record nothing and return a fixed sentence |
| Configuration and project | `run.mjs` | A temporary `XDG_CONFIG_HOME` and `my-app` directory, removed on exit |

The strip below the terminal always reads **VIRTUAL CONTROLLER / scripted demo** and shows each simulated press. The recording is not hardware evidence. Real-device acceptance lives in the [stage records](stages).

## Watch or re-record the scripted demo

Requirements: tmux 3.2+ for both commands, plus [VHS](https://github.com/charmbracelet/vhs) for recording (`brew install vhs tmux`).

```sh
npm run demo          # play it live in this terminal (about 40 s)
npm run demo:record   # regenerate docs/media/demo.gif and demo.mp4
```

The demo never touches your Padcode configuration, Bluetooth, microphone or network. The storyline, captions and timing are in [`scripts/demo/timeline.mjs`](../scripts/demo/timeline.mjs). Each step waits for its screen or Agent state before it holds and presses, so slow machines change the pace, not the result. Terminal size, theme and frame rate are in [`scripts/demo/demo.tape`](../scripts/demo/demo.tape). `demo:record` fails if the GIF grows beyond 5 MB. Re-record after changing any screen the demo shows; `test/demo.test.mjs` runs the same timeline in `npm run check`.

## Recording real footage

A real clip shows a physical controller driving a real Agent. It can replace the scripted GIF or sit next to it. Record it on the maintainer's Mac.

### Privacy

- Use a throwaway project (for example a fresh `create-vite` app), not a client or work repository.
- Use a clean terminal profile: no hostname, user name, email, tokens or paths outside the project in the prompt or title.
- Hide the Agent's account and plan details. Don't show `/usage`, `/status`, or login and billing screens. Trim them out if they appear.
- Close notifications (Focus mode on) and other windows. Record one window, not the full screen.
- Don't record real voice input you would not publish. Dictate only the sentence in the shot list.

### Setup

- Terminal: about 110×32, font size 16 or larger, a dark theme, and the window centered.
- Camera, optional: a top-down shot of the controller in the hands, recorded at the same time and placed picture-in-picture in a lower corner, or side by side.
- Screen capture: QuickTime Player (File > New Screen Recording > record selected window), or OBS with a window source at 30 fps.

### Shot list (30–45 s)

1. `cd my-app && padcode`. The Player Hub appears; D-pad moves, X selects **Start agent session**, D-pad up, X.
2. In the Agent, hold L2 and say "add a dark mode toggle to the settings page", then release. Pause on the inserted text, then press X to send.
3. When the Agent asks for approval, use the D-pad and X to answer.
4. Share opens quick commands. Pick one and press X twice.
5. Options > End session > End the Agent session. Back at the Hub, O exits.

Hold each result about a second so viewers can read it. Keep hands in frame when a camera is used.

### Export

```sh
# Trim and scale to the README width (1180 px); keep it under 5 MB.
ffmpeg -ss 00:00:01 -to 00:00:40 -i raw.mov -vf "fps=30,scale=1180:-2" -c:v libx264 -crf 26 -pix_fmt yuv420p -an docs/media/demo-real.mp4
ffmpeg -i docs/media/demo-real.mp4 -vf "fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" docs/media/demo-real.gif
```

The README embeds GIFs inline. For an MP4 with sound or higher quality, drag the file into a GitHub issue or PR comment and use the uploaded `user-attachments` URL in the README. Label real footage as such (for example, "DualShock 4 driving Claude Code on macOS") and note the Padcode version it shows.
