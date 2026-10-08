# Controller families: PlayStation, Xbox, Nintendo and standard gamepads

Status: implemented in 0.1.0-rc.8; automated acceptance passes locally and physical acceptance is pending (only a DualShock 4 is available). This plan was committed before runtime changes.

## Request

Before open-sourcing, Padcode should work with more controllers than the DualShock 4: at least PlayStation and Xbox, with automatic detection for others, and the interface must stop assuming PlayStation buttons. The user can only test a DualShock 4 physically. Scope for this stage: detection, family-specific button names everywhere, family-specific pairing hints and an optional Nintendo-style confirm button. A learning wizard for unrecognised controllers and custom mappings are later stages.

## Findings

- SDL3 already normalises every recognised gamepad to positional buttons (south, east, west, north, shoulders, triggers, sticks). Padcode's logic is positional, so input works unchanged; what is PlayStation-specific is about 60 visible strings, the Bluetooth pairing hint, the lab's face-button row and the controller map drawing.
- `SDL_GetGamepadType` reports the family (PS3/PS4/PS5, Xbox 360/One, Switch Pro and Joy-Cons, standard, unknown) from the device's vendor/product IDs and SDL's mapping database.
- Nintendo controllers print B on the south button and A on the east button.

## Design

1. **Detection.** `padcode-controller` adds `"family"` to `connected` events: `playstation`, `xbox`, `nintendo` or `standard` (standard covers SDL's generic and unknown types). The field is optional in the protocol for compatibility. Setup stores the verified controller's family in configuration (`controller.family`, optional).
2. **Button names.** One table (`glyphs.ts`) gives each family's names for confirm, back, west, north, menu, view, L1/R1, L2/R2, L3/R3, the guide button, the controller's display name and its pairing hint:

   | Role | PlayStation | Xbox | Nintendo | Standard |
   | --- | --- | --- | --- | --- |
   | south / east | X / O | A / B | B / A | A / B |
   | west / north | SQ / TRI | X / Y | Y / X | X / Y |
   | menu / view | OPTIONS / SHARE | MENU / VIEW | + / - | START / BACK |
   | shoulders | L1 R1 | LB RB | L R | LB RB |
   | triggers | L2 R2 | LT RT | ZL ZR | LT RT |
   | stick press | L3 R3 | LS RS | LS RS | LS RS |

   Visible strings use role placeholders (`{confirm}`, `{back}`, `{west}`, `{north}`, `{menu}`, `{view}`, `{l1}`, `{r1}`, `{l2}`, `{r2}`, `{l3}`, `{r3}`, `{pad}`) and are formatted where they are shown: terminal menus and setup, the status pane, controls popups, Controller Lab, titles in transparent mode and the launch confirmation. The family comes from the active controller, then the saved configuration, then `standard`. ASCII only, as for the controller map.
3. **Controller map.** Two drawings: PlayStation (symmetric sticks, touchpad) and an offset-stick layout used for Xbox, Nintendo and standard gamepads, each labelled with its family's names.
4. **Pairing hints.** The Bluetooth step lists how to enter pairing mode for each family (PS4: SHARE + PS; PS5: CREATE + PS; Xbox: hold the pair button until the logo flashes fast; Switch Pro: hold the sync button), and names the matching hint once a device is chosen, using its Bluetooth name.
5. **Confirm position.** Confirm stays positional (south) for every family by default. Configuration `controller.confirm: 'south' | 'east'` (default south); setup offers it for Nintendo controllers ("B confirms like other controllers" / "A confirms, Nintendo style"). When `east`, Padcode swaps east and south as events arrive (menus, Agent keys, controls), so every later rule is unchanged, and the button names follow the swap.
6. **Support claims.** Documentation lists DualShock 4 as tested, other families as "SDL-supported, not yet tested by the maintainer", and controllers SDL does not recognise as unsupported for now (keyboard always works). The guide/PS/Xbox button stays unused (macOS can take it for the Game overlay).

## Automated acceptance

- A1: protocol accepts and validates `family`; old helper events without it still parse.
- A2: the native helper reports the right family for virtual gamepads created with PlayStation, Xbox, Nintendo and unknown vendor/product IDs (simulated, not hardware evidence).
- A3: glyph formatting for every family and role, the confirm swap, unknown placeholders left untouched, ASCII output; every visible string that names a button uses placeholders (a test scans the sources for literal PlayStation names outside `glyphs.ts`).
- A4: menus, Agent keys and controls honour `confirm: 'east'`; configuration validation and migration of `family`/`confirm`.
- A5: controller map variants per family; Controller Lab shows the family's names; pairing hints in setup.
- A6: existing suites pass unchanged in behaviour; `npm run check` passes locally with no skipped tests (CI is disabled by the maintainer's decision).

## Physical acceptance

- H1: with the DualShock 4 nothing changes: names stay PlayStation, setup, Hub, sessions, map and voice behave as before.
- H2 (when hardware is available): an Xbox and a Nintendo controller show their own names, map and pairing hints.

## Implementation notes

- Formatting happens where text is shown: `TerminalPrompt` (setup, Hub, launch confirmation), `GamepadMenus` statuses, `AgentGamepad` statuses (status pane and terminal title), the coordinator for notices and popup views, the status-pane worker for its legend (it receives a `names` message), the popup worker for the map, and Controller Lab per device. State machines (`SessionControls`, `VoiceCapture`) keep templates.
- The controller map places every element at a fixed column, so the PlayStation and offset layouts stay aligned for any button names. The coordinator sizes the map popup with the family-specific view; the e2e Xbox scenario caught it sizing with the PlayStation drawing, which made the taller Xbox drawing fall back to the compact legend.
- The source scan (A3) found one leftover: Controller Lab's trigger meters were labelled L2/R2; they now use the family's names.
- `controllers` Lab shows standard names for devices that report no family (older helpers).

## Validation record

Plan commit: `2119f52`. On macOS 27.0.1 arm64, `npm run check` passed 151 tests with zero failures or skips. CI is disabled by the maintainer's decision, so Linux was not exercised.

- A1: protocol accepts the four families and old events without one, and rejects other values.
- A2: the real `padcode-controller` reports `playstation`, `xbox`, `nintendo` and `standard` for SDL virtual gamepads created with Sony, Microsoft, Nintendo and unknown vendor/product IDs, and rejects an unknown family argument (simulated devices, not hardware evidence).
- A3: names for every family and role, the Nintendo-style swap, untouched unknown braces, ASCII output, Bluetooth-name family guesses, pairing hints, and a scan of `src/` showing no visible string hard-codes PlayStation button names outside the name table and documented exceptions.
- A4: with `confirm: 'east'` a Nintendo controller's A sends Enter and B Escape in the Agent and confirms/cancels in menus, with names swapped; configuration validates and keeps `family` and `confirm`.
- A5: the controller map uses the PlayStation drawing or the offset drawing per family with closed frames, the legend follows the swap, the status legend uses the family's names, Controller Lab shows each family's names, and setup prints pairing hints for every family, stores the verified family and asks the confirm question only for Nintendo controllers.
- E2E: `panel_pty.py` `xbox_names()` runs a session with a simulated Xbox controller: status pane, legend, menu hints and the controller map (offset layout, XBOX WIRELESS CONTROLLER) use Xbox names. All existing scenarios run with a simulated PlayStation controller and pass unchanged.

Artifact `padcode-0.1.0-rc.8.tgz`, npm SHA-1 `3604a9580620c09072f8c811b169c4f2160882d9`. The native controller helper changed; the audio helper did not. H1 (DualShock 4 unchanged) is pending; H2 needs Xbox and Nintendo hardware.

### User-reported physical acceptance

On 2026-10-08 the user reported that with 0.1.0-rc.8 the DualShock 4 works as before (H1). H2 (Xbox and Nintendo hardware) remains open because no such controller is available.
