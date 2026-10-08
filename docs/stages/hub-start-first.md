# Player Hub: Start agent session first

Status: implemented; automated acceptance passes and physical acceptance is pending. This plan was committed before runtime changes.

## Change

Player Hub lists items by how often they are used, and the cursor starts on the first one: **Start agent session** (default), Voice / microphone settings, Controller lab, Edit configuration, Preview arcade dashboard, Exit. Pressing X on entering the Hub therefore opens the launch confirmation, which still defaults to Cancel, so a single press never launches an Agent. O still chooses Exit. Without a configured Agent the list starts with Voice settings.

## Acceptance

- A1: the Hub PTY suites select items by their new positions; the launch confirmation still defaults to Cancel.
- A2: `npm run check` passes locally and in CI with no skipped tests.
- H1: on entering the Hub with the DS4, X then X (after moving to Start in the confirmation) launches the Agent.

## Validation record

`npm run check` passed 133 tests with zero failures or skips on macOS 27.0.1 arm64. The onboarding, Agent, Hub Agent and Hub navigation PTY suites now select Hub items by their new positions (Start 1, Voice 2, Lab 3, Config 4, Demo 5, Exit 6). H1 is pending.
