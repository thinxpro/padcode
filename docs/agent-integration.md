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

## Future structured adapters

Adapters declare capabilities such as task launch, interruption, streaming output and confirmation requests. The interface only offers supported actions.

Codex app-server is one candidate; pin its version and verify its protocol. Structured services usually require Padcode to render conversations and confirmations, so the original agent TUI may not be reusable. This is a separate enhancement path, not a silent replacement for generic launch.

The initial release does not automatically download or execute third-party adapters. If plugins are added later, require explicit installation and disclose their access to local processes and projects.

## Compatibility record

For each tested combination, record OS, CPU, terminal/version, Node version, controller/transport, agent command/version, profile, results and limitations.

Minimum cases: startup, ASCII and Unicode input, menu selection, submission, native cancellation, terminal resize, keyboard use after disconnection, normal exit and failure cleanup.
