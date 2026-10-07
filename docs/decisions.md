# Decisions

Confirmed decisions are product constraints. Proposed decisions require technical validation. Open decisions do not block initial documentation.

| Decision | Status | Rationale |
| --- | --- | --- |
| Terminal-installed developer tool | Confirmed | A CLI rather than a standalone app/DMG |
| Users bring and select their agent | Confirmed | The tool provides input and session connectivity |
| No hosted accounts, models or cloud service | Confirmed | Preserve local use and the tool's scope |
| Existing terminal handles rendering | Confirmed | No replacement terminal or embedded xterm.js |
| Generic PTY as the base integration | Proposed | Support custom CLIs without vendor-specific interfaces |
| Node.js/TypeScript + SDL3 helper | Proposed; prototype implemented | Combine npm distribution with native controller events |
| node-pty | Proposed | Native distribution and TUI compatibility require validation |
| npm as the first installation channel | Proposed; local tarball tested | Validate one complete installation path first |
| macOS + DualShock 4, Bluetooth first | Confirmed | Explicit user requirement; USB remains an alternative and Bluetooth belongs in terminal onboarding |
| Optional voice, desktop mode and structured adapters | Confirmed | Avoid extra base installation and agent-selection requirements |
| Padcode name | Provisional | Package ownership and public naming require confirmation |
| Open-source license | Confirmed | Maintainer selected MIT; see LICENSE; dependencies retain their own licenses |
| npm publishing account | Available | Maintainer has an account; verify login and package ownership before release |
| Initial public release date | Open | Repository remains private until the maintainer decides otherwise |
| English repository and PR content | Confirmed | Prepare for public collaboration; applies to future contributions |

## Superseded approaches

The early Electron/React desktop app, embedded xterm.js terminal, mandatory Codex app-server and bundled whisper.cpp are not part of the initial architecture. Any future addition requires an optional module and a separate decision.

## Questions for experiments

The user moved [Bluetooth-first terminal setup](stages/p0-config-bluetooth.md) ahead of the PTY bridge. Stage criteria changed to reflect that explicit priority, not to accommodate failed tests.

1. Can native dependencies install without developer build tools?
2. How do different TUIs handle terminal queries and scrolling?
3. Are background controller events and disconnect behavior stable on target systems?
4. Which tool shortcuts are memorable and avoid accidental exits or submissions?
5. Does voice need a built-in interface, or are existing dictation tools sufficient?

Physical controller acceptance and actual agent compatibility remain unverified. The Bluetooth permission fix has passed a real status query; that is not a pairing or input acceptance result.
