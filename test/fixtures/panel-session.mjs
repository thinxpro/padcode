import { resolve, join } from 'node:path';
import { writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const { runPanelAgent, PanelFallback } = await import(pathToFileURL(join(root, 'dist/panel-session.js')));
const { runAgent } = await import(pathToFileURL(join(root, 'dist/agent-session.js')));
const { AgentGamepad } = await import(pathToFileURL(join(root, 'dist/agent-gamepad.js')));
const { ControllerProbe } = await import(pathToFileURL(join(root, 'dist/probe.js')));
const { NativeAudio } = await import(pathToFileURL(join(root, 'dist/audio.js')));
// Opt-in fake microphone; never microphone evidence.
const transcriber = process.env.PADCODE_TRANSCRIBER ? { kind: 'command', command: process.execPath, args: [resolve('test/fixtures/fake-transcriber.mjs'), process.env.PADCODE_TRANSCRIBER, '{audio}'], language: 'zh' } : null;
const voice = process.env.PADCODE_VOICE === '1' ? { voice: { microphone: { id: 'mic-1', name: 'Fixture Mic' }, transcriber, insert: process.env.PADCODE_INSERT ?? 'auto' }, audio: new NativeAudio({ command: process.execPath, args: [resolve('test/fixtures/audio-helper.mjs')], player: resolve('test/fixtures/fake-player.sh'), supported: true }) } : {};
const [events, mode = 'basic'] = process.argv.slice(2);
const agent = { command: process.env.PADCODE_PYTHON, args: [resolve('test/fixtures/pty-agent.py'), mode], ...(process.env.PADCODE_COMMANDS ? { commands: JSON.parse(process.env.PADCODE_COMMANDS) } : {}) };
const gamepad = new AgentGamepad(
  { transport: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff', inputVerified: true },
  { factory: () => new ControllerProbe(process.execPath, [resolve('test/fixtures/menu-helper.mjs'), events]), automaticHandoff: true, editing: process.env.PADCODE_EDITING ?? 'basic',
    ...(process.env.PADCODE_TRACE_FILE ? { trace: (event, generation) => appendFileSync(process.env.PADCODE_TRACE_FILE, `${Date.now()} ${event} ${generation}\n`) } : {}) },
);
try {
  process.exitCode = await runPanelAgent(agent, {
    tmux: process.env.PADCODE_TMUX, gamepad, onReady: ready => writeFileSync(events + '.ready', JSON.stringify(ready)),
    ...voice,
  });
} catch (error) {
  if (!(error instanceof PanelFallback)) throw error;
  // Mirrors runConfiguredAgent: the same unstarted controller source continues in transparent mode.
  process.stdout.write(`FALLBACK:${error.constructor.name}\n`);
  process.exitCode = await runAgent(agent, { gamepad });
} finally { await gamepad.stop(); }
