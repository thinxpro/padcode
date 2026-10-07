import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentGamepad, terminalKeys } from '../dist/agent-gamepad.js';
import { PtyWriter } from '../dist/pty-writer.js';
import { GamepadMenus } from '../dist/menu-controller.js';
export const target = { transport: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff', inputVerified: true };
export const pad = { type: 'connected', device: 1, name: 'Fixture PS4', connection: 'wireless', serial: target.address };
export function fixture(startError) {
  let listener, clock = 0, stopped = 0;
  const feed = { start: async () => { if (startError) throw startError; }, stop: async () => { stopped++; }, snapshot: () => [pad], subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  const gamepad = new AgentGamepad(target, () => feed, () => clock), bytes = [], statuses = []; let cancellations = 0;
  gamepad.subscribe(data => bytes.push(data.toString()), text => statuses.push(text), () => cancellations++);
  const emit = event => listener?.(event);
  const edge = (button, down, device = 1) => emit({ type: 'button', device, button, down });
  const press = (button, device = 1) => { edge(button, true, device); edge(button, false, device); };
  return { gamepad, feed, bytes, statuses, edge, press, emit, advance: () => { clock += 300; }, fail: () => listener?.(undefined, new Error('lost')), stopped: () => stopped, cancellations: () => cancellations };
}
const signal = new AbortController().signal;
test('mapping starts paused, settles held Options and uses exact terminal key bytes', async () => {
  const f = fixture(); await f.gamepad.start(signal);
  f.edge('start', true); f.advance(); f.edge('start', false); f.press('south'); assert.deepEqual(f.bytes, []);
  f.press('start'); for (const key of Object.keys(terminalKeys)) f.press(key);
  assert.deepEqual(f.bytes, ['\x1b[A','\x1b[B','\x1b[C','\x1b[D','\r','\x1b','\t','\x1b[Z']);
  f.press('north'); f.press('guide'); assert.equal(f.bytes.length, 8);
  await f.gamepad.stop(); assert.equal(f.stopped(), 1);
});
test('held buttons do not repeat or replay across pause and resume', async () => {
  const f = fixture(); await f.gamepad.start(signal); f.advance(); f.press('start');
  f.edge('south', true); f.edge('south', true); assert.deepEqual(f.bytes, ['\r']);
  f.press('start'); f.edge('dpad_down', true); f.press('start'); f.edge('dpad_down', true); f.edge('south', true);
  assert.deepEqual(f.bytes, ['\r']);
  f.edge('south', false); f.press('south'); assert.deepEqual(f.bytes, ['\r','\r']);
  assert.ok(f.cancellations() >= 2); await f.gamepad.stop();
});
test('disconnect, same-ID reconnect and helper failure require explicit rearming', async () => {
  const f = fixture(); await f.gamepad.start(signal); f.advance(); f.press('start'); f.press('south');
  f.emit({ type: 'disconnected', device: 1 }); f.press('south'); f.emit(pad); f.press('start'); f.advance(); f.press('south');
  assert.deepEqual(f.bytes, ['\r']);
  f.press('start'); f.press('south'); assert.equal(f.bytes.length, 2);
  f.emit(pad); f.advance(); f.press('south'); assert.equal(f.bytes.length, 2);
  f.press('start'); f.fail(); f.press('south'); f.press('start'); assert.equal(f.bytes.length, 2);
  assert.match(f.statuses.at(-1), /INPUT LOST/); await f.gamepad.stop();
});
test('mismatched and unselected controllers cannot inject or toggle the selected device', async () => {
  const f = fixture(); await f.gamepad.start(signal);
  f.emit({ ...pad, device: 2, serial: '00:00:00:00:00:00' }); f.emit({ ...pad, device: 3, serial: undefined }); f.advance();
  f.press('start', 2); f.press('south', 2); assert.deepEqual(f.bytes, []);
  f.press('start'); f.press('start', 3); f.press('south', 3); f.press('south'); assert.deepEqual(f.bytes, ['\r']);
  await f.gamepad.stop();
});
test('input helper startup failure leaves keyboard-only operation available and releases helper', async () => {
  const f = fixture(new Error('missing helper')); await f.gamepad.start(signal);
  assert.match(f.statuses.at(-1), /UNAVAILABLE/); await f.gamepad.stop(); assert.equal(f.stopped(), 1);
});
test('canceling queued controller data preserves keyboard bytes and never retries canceled input', async () => {
  const writes = []; const writer = new PtyWriter(1, () => {}, () => {}, assert.fail, 1000, (_, bytes, cb) => writes.push({ bytes: bytes.toString(), cb }));
  writer.push(Buffer.from('keyboard')); writer.push(Buffer.from('\r'), true); writer.push(Buffer.from('more'));
  writer.discardController(); writes[0].cb(null, 8); assert.equal(writes[1].bytes, 'more'); writes[1].cb(null, 4); assert.equal(writes.length, 2);
  writer.push(Buffer.from('\x1b[A'), true); writer.discardController(); writes[2].cb(Object.assign(new Error('busy'), { code: 'EAGAIN' }), 0);
  await new Promise(r => setTimeout(r, 20)); assert.equal(writes.length, 3); writer.close();
});
test('configured uniquely matched menu controller confirms without a claiming press', async () => {
  const f = fixture(), menus = new GamepadMenus(() => f.feed), actions = [];
  menus.subscribeAction(a => actions.push(a)); await menus.activate(target, signal, true);
  assert.match(menus.statusText, /READY/); await new Promise(r => setTimeout(r, 260));
  f.press('dpad_down'); f.press('south'); assert.deepEqual(actions, ['down','confirm']); await menus.stop();
});
test('unidentified menu controller can claim and navigate in a single D-pad press', async () => {
  const f = fixture(), menus = new GamepadMenus(() => f.feed), actions = [];
  menus.subscribeAction(a => actions.push(a)); await menus.activate({ transport: 'bluetooth', inputVerified: false }, signal, true);
  await new Promise(r => setTimeout(r, 260)); f.press('dpad_down'); f.press('south'); assert.deepEqual(actions, ['down','confirm']); await menus.stop();
});
test('production controller protocol reaches a real Agent PTY with safe lifecycle and keyboard coexistence', { timeout: 40000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python3', ['test/gamepad-agent-pty.py'], { encoding: 'utf8', timeout: 35000, env: { ...process.env, PADCODE_NODE: process.execPath } });
  assert.equal(r.status, 0, `${r.error ?? ''}\n${r.stdout}\n${r.stderr}`);
});
test('status output failure still restores input mode and stops the gamepad helper', async () => {
  const { PassThrough, Writable } = await import('node:stream');
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const { runAgent } = await import('../dist/agent-session.js');
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false; input.setRawMode = raw => { input.isRaw = raw; };
  const output = new Writable({ write(_, __, cb) { cb(); } }); output.isTTY = true;
  output.write = () => { throw new Error('fixture status failure'); };
  const f = fixture();
  const python = spawnSync('which', ['python3'], { encoding: 'utf8' }).stdout.trim();
  await assert.rejects(runAgent({ command: python, args: [resolve('test/fixtures/pty-agent.py'), 'stall'] }, { input, output, gamepad: f.gamepad }), /fixture status failure/);
  assert.equal(input.isRaw, false); assert.equal(f.stopped(), 1);
});
