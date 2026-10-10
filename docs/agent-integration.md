# Agent integration

## Principle

The user chooses what runs. Padcode does not install, authenticate or launch an unselected agent, submit tasks automatically or handle approvals on the user's behalf.

## Three integration levels

| Level | Capability | Limitation |
| --- | --- | --- |
| Generic PTY | Launch a configured command and forward keys/output | No agent semantics; actual TUI compatibility must be tested |
| Key profile | Configure submission, menu and cancellation keys for a CLI | Version-dependent; sending a key does not guarantee an action succeeds |
| Structured adapter | Read state, request interruption and present confirmations through official protocols | Implemented per tool; may require a different launch/rendering path |

Generic mode is the base entry point. Candidates include the user's installed Codex CLI, Claude Code and other interactive tools. Naming a tool is not a compatibility claim.

## Configuration concept

This is a conceptual schema, not a usable current configuration:

```json
{
  "version": 1,
  "agent": {
    "command": "/path/to/my-agent",
    "args": [],
    "mode": "pty"
  },
  "controller": {
    "profile": "terminal-basic"
  }
}
```

The working directory defaults to the directory where `padcode` was invoked. Allow an override, but show the actual directory before launch. If a command is unavailable, explain why and allow another selection; do not silently substitute an agent.

## Initial behavior boundaries

- Enter means Enter; do not universally label it "Approve".
- Escape means Escape; it is not guaranteed to interrupt an active task.
- A live process does not imply active generation, and its exit code does not prove the development task is correct.
- Do not bypass the selected agent's confirmations, permissions or sandbox settings.
- Authentication and permission handling stay in the agent's original interface.

## Quick commands

Share/View opens a palette that types `/`, `@`, an Agent-specific sigil or a common slash command into the Agent's input as keystrokes, never followed by Enter, so the Agent's own picker or command handles it. The Agent is recognised by its executable name: `claude` and `codex` get researched command lists (see [quick commands](stages/quick-commands.md)); other Agents get `/`, `@` and the custom list. Users add their own commands, such as skills, with `agent.commands` in `config.json`:

```json
"agent": { "command": "/opt/homebrew/bin/claude", "args": [], "commands": ["/review", "/frontend:component"] }
```

At most 8 entries, each starting with `/`, at most 60 bytes and without control characters. Padcode cannot see the input, so commands only run when typed at the start of an empty input.

## Future structured adapters

Adapters declare capabilities such as task launch, interruption, streaming output and confirmation requests. The interface only offers supported actions.

Codex app-server is one candidate; pin its version and verify its protocol. Its [official documentation](https://developers.openai.com/codex/app-server) describes a remote connection from the original Codex terminal UI, so structured integration does not necessarily require replacing that UI. Other adapters may require custom rendering. This remains a separate enhancement path, not a silent replacement for generic launch.

The next [continuous controller and voice plan](stages/p0-4-continuous-controller-and-voice.md) retains the PTY, separates Padcode controls from the Agent screen and treats voice as a reviewed draft. Generic PTY output cannot reliably identify a composer or approval prompt; profile verification and explicit destination confirmation are required before voice insertion.

The initial release does not automatically download or execute third-party adapters. If plugins are added later, require explicit installation and disclose their access to local processes and projects.

## Compatibility record

For each tested combination, record OS, CPU, terminal/version, Node version, controller/transport, agent command/version, profile, results and limitations.

Minimum cases: startup, ASCII and Unicode input, menu selection, submission, native cancellation, terminal resize, keyboard use after disconnection, normal exit and failure cleanup.
