#!/usr/bin/env node
// Top pane of the scripted demo: "types" padcode, runs the real Player Hub from dist/ with the virtual
// controller and stand-in microphone, and plays the timeline. Usage: session.mjs <demo directory>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buttonNames, steps } from './timeline.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const dir = process.argv[2];
const load = path => import(pathToFileURL(join(root, 'dist', path)).href);
const [{ onboarding }, { GamepadMenus }, { ControllerProbe }, { NativeAudio }] = await Promise.all([
  load('onboarding.js'), load('menu-controller.js'), load('probe.js'), load('audio.js'),
]);

const speed = Number(process.env.PADCODE_DEMO_SPEED) || 1;
const sleep = ms => new Promise(done => setTimeout(done, Math.round(ms * speed)));
const events = join(dir, 'events'), hud = join(dir, 'hud.json'), agentState = join(dir, 'agent.json');
const trace = process.env.PADCODE_DEMO_TRACE;
const color = process.env.NO_COLOR === undefined;
const tmux = (...args) => execFileSync(process.env.PADCODE_DEMO_TMUX, ['-L', process.env.PADCODE_DEMO_SOCKET, ...args], { encoding: 'utf8' });
const capture = target => { try { return tmux('capture-pane', '-p', '-t', target); } catch { return ''; } };
const screen = () => capture('demo:0.0');
const agent = () => { try { return JSON.parse(readFileSync(agentState, 'utf8')); } catch { return { phase: 'none', input: '', submitted: [], answers: [] }; } };
const event = value => appendFileSync(events, JSON.stringify(value) + '\n');
// The last button stays on screen, dimmed, until the next press.
let caption = '', last = { at: 0 };
const show = (button, extra = {}) => {
  if (button) last = { button: buttonNames[button], at: Date.now(), ...extra };
  writeFileSync(hud, JSON.stringify({ caption, ...last }));
};
const log = entry => { if (trace) appendFileSync(trace, JSON.stringify(entry) + '\n'); };

async function until(step) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const text = step.until ? screen() : '';
    if ((!step.until || step.until.test(text)) && (!step.agent || step.agent(agent()))) return text;
    if (Date.now() > deadline) throw new Error(`Demo step "${step.name ?? 'unnamed'}" did not appear within 20 s.`);
    await new Promise(done => setTimeout(done, 100));
  }
}
async function play() {
  for (const step of steps) {
    const text = await until(step);
    if (step.name) log({ step: step.name, screen: text || screen(), hud: capture('demo:0.1'), agent: agent() });
    if (step.caption) { caption = step.caption; show(undefined); }
    await sleep(step.hold);
    if (step.press) {
      show(step.press);
      event({ type: 'button', device: 1, button: step.press, down: true });
      await sleep(90);
      event({ type: 'button', device: 1, button: step.press, down: false });
    }
    if (step.trigger) {
      show('l2', { holding: true });
      event({ type: 'axis', device: 1, axis: 'left_trigger', value: 32767 });
      await sleep(step.trigger);
      event({ type: 'axis', device: 1, axis: 'left_trigger', value: 0 });
      show('l2');
    }
  }
}

// A plain shell prompt, then padcode is typed in the project.
const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
const shellPrompt = `${paint('36', '~/my-app')} ${paint('2', '$')} `;
process.stdout.write(`\x1b[2J\x1b[H${shellPrompt}`);
writeFileSync(events, ''); caption = 'Open a project and start Padcode'; show(undefined);
await sleep(900);
for (const char of 'padcode') { process.stdout.write(char); await sleep(85); }
await sleep(350);
process.stdout.write('\r\n');

const menus = new GamepadMenus(() => new ControllerProbe(process.execPath, [join(here, 'controller.mjs'), events]));
const audio = new NativeAudio({ command: process.execPath, args: [join(here, 'audio.mjs')], player: '/usr/bin/true', supported: true });
let failure;
const driver = play().catch(error => { failure = error; log({ error: error.message }); process.kill(process.pid, 'SIGTERM'); });
let code = await onboarding(false, menus, {}, audio);
await driver;
if (failure) { process.stdout.write(`\r\nDemo stopped: ${failure.message}\r\n`); code = code || 1; }
else { process.stdout.write(shellPrompt); await sleep(2600); }
writeFileSync(join(dir, 'exit'), String(code));
try { tmux('kill-server'); } catch {}
process.exit(code);
