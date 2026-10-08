# Player Hub: Start agent session first

Status: planned. This plan is committed before runtime changes.

## Change

Player Hub lists items by how often they are used, and the cursor starts on the first one: **Start agent session** (default), Voice / microphone settings, Controller lab, Edit configuration, Preview arcade dashboard, Exit. Pressing X on entering the Hub therefore opens the launch confirmation, which still defaults to Cancel, so a single press never launches an Agent. O still chooses Exit. Without a configured Agent the list starts with Voice settings.

## Acceptance

- A1: the Hub PTY suites select items by their new positions; the launch confirmation still defaults to Cancel.
- A2: `npm run check` passes locally and in CI with no skipped tests.
- H1: on entering the Hub with the DS4, X then X (after moving to Start in the confirmation) launches the Agent.

## Validation record

Pending.
