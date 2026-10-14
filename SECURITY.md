# Security policy

## Supported versions

Padcode is pre-1.0. Security fixes go into the latest published version only: the npm `latest` tag, or a newer release candidate under `next`.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)). Include:

- the Padcode version (`padcode --version`), macOS version and CPU architecture;
- what an attacker can do, and the steps or a proof of concept to reproduce it;
- whether the issue is already public.

You should get an acknowledgment within 7 days. Once a fix is available, it is released with a GitHub security advisory that credits you unless you prefer otherwise.

## Scope

In scope: the `padcode` and `padcode-darwin` npm packages and this repository, for example the per-session IPC socket, the native helpers and their entitlements, input forwarding to the Agent PTY, configuration parsing and the whisper model download and checksum verification.

Out of scope: the coding Agents you run with Padcode (report those to their vendors), SDL, node-pty and macOS itself, unless Padcode uses them in an unsafe way.
