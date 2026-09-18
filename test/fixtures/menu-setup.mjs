import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setup } from '../../dist/onboarding.js';
import { TerminalPrompt } from '../../dist/prompt.js';
import { GamepadMenus } from '../../dist/menu-controller.js';
import { ControllerProbe } from '../../dist/probe.js';
const controller = new AbortController();
const menus = new GamepadMenus(() => new ControllerProbe(process.execPath, [resolve('test/fixtures/menu-helper.mjs'), process.argv[2]]));
const io = new TerminalPrompt(controller.signal, () => controller.abort(), menus);
const pad = { address: 'aa:bb:cc:dd:ee:ff', name: 'Test Pad', paired: true, connected: true };
process.on('SIGTERM', () => controller.abort());
try {
  if (process.argv[3] === 'text') {
    await menus.activate({ transport: 'bluetooth', address: pad.address, inputVerified: false }, controller.signal);
    await io.choose('Begin text test', [{ label: 'Begin', value: 'begin' }, { label: 'Alternative', value: 'alternative' }]);
    const value = await io.ask('Literal text:');
    io.say(`TEXT RESULT: ${value}`);
    const action = await io.choose('Return menu', [{ label: 'Continue', value: 'continue' }, { label: 'Back', value: 'back' }]);
    io.say(`ACTION: ${action}`);
  } else {
  await setup(io, { bluetooth: { list: async () => [pad] }, activateMenus: target => menus.activate(target, controller.signal), probe: () => menus.probe(), agents: async () => [{ label: 'My agent', command: '/opt/my-agent' }], resolve: async command => command, save: config => writeFile(process.argv[2] + '.config', JSON.stringify(config)) }, controller.signal);
  io.banner('PLAYER HUB');
  await io.choose('Ready when you are', [{ label: 'Continue', value: 'continue' }, { label: 'Exit', value: 'quit' }]);
  }
} catch (error) { io.say(error.message); process.exitCode = controller.signal.aborted ? 130 : 0; }
finally { await menus.stop(); io.close(); }
