import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[3] ?? process.cwd();
const { runAgent } = await import(pathToFileURL(join(root, 'dist/agent-session.js')));
const { AgentGamepad } = await import(pathToFileURL(join(root, 'dist/agent-gamepad.js')));
const { ControllerProbe } = await import(pathToFileURL(join(root, 'dist/probe.js')));
const gamepad = new AgentGamepad({ transport: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff', inputVerified: true }, () => new ControllerProbe(process.execPath, [resolve('test/fixtures/menu-helper.mjs'), process.argv[2]]));
process.exitCode = await runAgent({ command: process.env.PADCODE_PYTHON, args: [resolve('test/fixtures/pty-agent.py'), 'basic'] }, { gamepad });
