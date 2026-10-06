import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const { runPanelAgent, PanelFallback } = await import(pathToFileURL(join(root, 'dist/panel-session.js')));
const { runAgent } = await import(pathToFileURL(join(root, 'dist/agent-session.js')));
const { AgentGamepad } = await import(pathToFileURL(join(root, 'dist/agent-gamepad.js')));
const { ControllerProbe } = await import(pathToFileURL(join(root, 'dist/probe.js')));
const [events, mode = 'basic'] = process.argv.slice(2);
const agent = { command: process.env.PADCODE_PYTHON, args: [resolve('test/fixtures/pty-agent.py'), mode] };
const gamepad = new AgentGamepad(
  { transport: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff', inputVerified: true },
  { factory: () => new ControllerProbe(process.execPath, [resolve('test/fixtures/menu-helper.mjs'), events]), automaticHandoff: true },
);
try {
  process.exitCode = await runPanelAgent(agent, {
    tmux: process.env.PADCODE_TMUX, gamepad, onReady: ready => writeFileSync(events + '.ready', JSON.stringify(ready)),
  });
} catch (error) {
  if (!(error instanceof PanelFallback)) throw error;
  // Mirrors runConfiguredAgent: the same unstarted controller source continues in transparent mode.
  process.stdout.write(`FALLBACK:${error.constructor.name}\n`);
  process.exitCode = await runAgent(agent, { gamepad });
} finally { await gamepad.stop(); }
