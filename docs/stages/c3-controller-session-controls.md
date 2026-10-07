# C3: Complete controller session

Status: implemented in dev.12; automated acceptance passes locally and physical acceptance is pending. This plan was committed before runtime changes. Branch `feature/session-controls` from `main` after C1, C2 and Player Hub navigation merged.

## Scope

Let the controller operate a whole Agent session after launch: an Options controls menu, explicit interrupt, pause/resume, controller-driven history and a confirmed end-session flow. This applies to the controls-pane (tmux) mode. Transparent mode keeps the dev.11 Options pause toggle, because it has no isolated surface to draw a menu on; the launch confirmation states which behavior applies.

Out of scope: voice setup (C4; the menu shows no voice entry until it exists), text entry, new key profiles, automatic repeats, stick mappings and Agent-specific approval detection.

## Contexts

The coordinator routes every controller event to exactly one context:

| Context | Entered by | D-pad | X | O | L1 / R1 | Options |
| --- | --- | --- | --- | --- | --- | --- |
| Agent | launch, closing a menu | arrows | Enter | Escape | Tab / Shift+Tab | open menu |
| Menu | Options in Agent | move selection | choose item | close menu | none | close menu |
| End confirmation | menu item | move selection | choose | back to menu | none | close menu |
| History | menu item, or mouse wheel | up/down scroll one line | none | leave history | page up / page down | leave history |

- Only fresh press edges from the selected controller act. Every context change cancels queued controller bytes; leaving any Padcode context re-applies the 250 ms neutral barrier (all buttons released) before Agent routing resumes, so the closing press never reaches the Agent.
- Paused mapping (from the menu's Pause item, a reconnect or an unidentified controller) is unchanged from C1: Options press/release resumes it and Options does not open the menu while paused.
- Disconnect, helper loss or Agent exit close any open menu or history view and keep the C1 reconnect rule.
- Keyboard input is never blocked by Agent context. While the menu popup is open, keyboard arrows, Enter, Escape, q and number keys operate the menu (tmux routes the keyboard to the popup); Ctrl+] in the Agent pane remains the emergency exit.

## Menu

Rendered in a tmux `display-popup` over the Agent pane, so the Agent is neither resized nor overwritten and its output continues underneath. Items:

1. Resume Agent controls (closes the menu; default)
2. Pause gamepad mapping (Options resumes later)
3. Browse history (enters the History context)
4. Send interrupt (Ctrl+C) (writes one `0x03` to the Agent, then closes)
5. End session... (opens End confirmation: "Keep the session running" (default) / "End the Agent session")

Ending the session stops the Agent process group exactly like Ctrl+] (status 130) and returns to Player Hub or the shell. Neither interrupt nor end session is ever triggered by disconnects, timeouts or Agent output.

History uses tmux copy mode on the Agent pane (`copy-mode -e`), driven by explicit coordinator commands (`send -X scroll-up/scroll-down/page-up/page-down/cancel`); nothing reaches the Agent while it is open. Mouse-wheel history now enters the same History context, so the controller can scroll it too; this replaces the C2 hold-only behavior.

## Process and IPC changes

- A new menu worker (`pane-menu.js`) runs inside the popup, joins IPC with role `menu` (replaceable, like the status pane), renders `menu` messages and sends keyboard `action` messages (`up`, `down`, `confirm`, `back`, or `pick` with an index). The coordinator owns all menu state; workers only render and report keys.
- The popup receives its private channel through the private session environment (`set-environment`), not command-line arguments.
- New IPC messages: coordinator -> menu `menu {title, items, selected, hint}` and `close`; menu -> coordinator `action {name, index?}`; coordinator -> agent `interrupt` is not added: interrupt uses the existing bounded `keys` path tagged as controller input.

## Automated acceptance

- C3-A1: the context transition matrix (Agent, Menu, End confirmation, History, Paused) is exercised for every DualShock button with press and release edges; each cell has exactly one expected effect and no other context receives the event.
- C3-A2: 100 simulated X presses in Agent context produce exactly 100 Enter bytes; 100 presses in Menu/History contexts produce none.
- C3-A3: closing the menu or leaving history with a still-held button emits nothing until all buttons are released for 250 ms.
- C3-A4: Send interrupt writes exactly one `0x03`; End session requires the confirmation and ends with status 130; the default confirmation choice keeps the session.
- C3-A5: History scrolls the Agent pane's tmux history from the controller, mouse-wheel entry routes to the same context, and O leaves it; Agent bytes stay unchanged throughout.
- C3-A6: disconnect while the menu or history is open closes it, cancels queued controller bytes and requires the C1 rearm; Agent exit while the menu is open closes the popup and cleans up.
- C3-A7: keyboard operates the popup menu (arrows, Enter, Escape, number keys); menu IPC rejects malformed or wrong-role messages.
- C3-A8: normal exit, Ctrl+], SIGTERM and coordinator crash still restore the terminal and remove helpers, popups and the private server; transparent mode keeps the Options pause toggle; `npm run check` passes locally and in CI with no skipped tests.

## Physical acceptance (C3-H)

- C3-H1: after launching from Player Hub, use only the DS4 to open the menu, browse history, return, send an interrupt to a running Agent task, pause/resume, end the session with confirmation and return to the Hub.
- C3-H2: verify a real Agent approval prompt is answered only by an explicit X on the intended choice, never by opening/closing the menu.
- C3-H3: run a 10-minute session mixing menu use, history and Agent input without stuck input or accidental submissions.
- Record the Agent (Claude Code and/or Codex) and terminal versions.

## Validation record

Plan commit: `1d572a1`. On macOS 27.0 arm64 with Node 24.21.0 and tmux 3.7c, `npm run check` passed 108 tests with zero failures or skips.

- C3-A1/A2/A3/A6: `test/session-controls.test.mjs` runs the full context x button matrix (15 buttons in Agent, Menu, End confirmation and History), 100 presses per context through a real `AgentGamepad`, the release barrier on close, pause through the barrier and disconnect inside the menu.
- C3-A2 to A8 end to end: `test/panel_pty.py` `controls()` drives a real tmux session: 100 X presses give exactly 100 Enter bytes, every menu press stays out of the Agent, the popup does not resize the Agent pane, Pause and Options resume, Send interrupt writes one `0x03` (from the controller and from the popup keyboard's number key), history scrolls the Agent pane's tmux history with the D-pad and leaves on O, a disconnect closes the menu and needs the rearm, End session keeps running on the default choice and ends with status 130 after confirmation. SIGTERM with the popup open removes the popup client with the session.
- The C2 history hold is replaced by the History context; mouse-wheel entry routes there too. Transparent mode keeps the Options pause toggle (existing suites).

Artifact `padcode-0.1.0-dev.12.tgz`, npm SHA-1 `51f1c2b15a83e5bcf5bcc22c710cef7f3c9751cb`. C3-H1 to C3-H3 are pending physical testing.
