import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentGamepad, terminalKeys } from '../dist/agent-gamepad.js';
import { PtyWriter } from '../dist/pty-writer.js';
import { GamepadMenus } from '../dist/menu-controller.js';
import { target, pad, fixture } from './agent-gamepad-fixture.mjs';
const signal = new AbortController().signal;
test('mapping starts paused, settles held Options and uses exact terminal key bytes', async () => {
  const f = fixture(); await f.gamepad.start(signal);
  f.edge('start', true); f.advance(); f.edge('start', false); f.press('south'); assert.deepEqual(f.bytes, []);
  f.press('start'); for (const key of Object.keys(terminalKeys)) f.press(key);
  assert.deepEqual(f.bytes, ['\x1b[A','\x1b[B','\x1b[C','\x1b[D','\r','\x1b','\t','\x1b[Z']);
  f.press('north'); f.press('guide'); assert.equal(f.bytes.length, 8);
  await f.gamepad.stop(); assert.equal(f.stopped(), 1);
});
test('adopted menu feed activates after a neutral barrier without replaying launch buttons', async () => {
  let listener, starts = 0, stops = 0;
  const feed = { start: async () => { starts++; }, stop: async () => { stops++; }, snapshot: () => [pad], subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  const menu = new GamepadMenus(() => feed); const controller = new AbortController();
  await menu.activate(target, controller.signal, true); assert.equal(starts, 1);
  const adopted = menu.handoff(); assert.equal(adopted, feed); await menu.stop(); assert.equal(stops, 0);
  const traces = [], bytes = [], statuses = [];
  const gamepad = new AgentGamepad(target, { factory: () => adopted, feedStarted: true, automaticHandoff: true, trace: (...entry) => traces.push(entry) });
  gamepad.subscribe(data => bytes.push(data.toString()), text => statuses.push(text), () => {});
  await gamepad.start(controller.signal);
  listener({ type: 'button', device: 1, button: 'south', down: true });
  listener({ type: 'button', device: 1, button: 'start', down: true });
  listener({ type: 'button', device: 1, button: 'south', down: false });
  listener({ type: 'button', device: 1, button: 'start', down: false });
  await new Promise(resolve => setTimeout(resolve, 275));
  assert.deepEqual(bytes, []); assert.match(statuses.at(-1), /ACTIVE/);
  listener({ type: 'button', device: 1, button: 'south', down: true });
  listener({ type: 'button', device: 1, button: 'south', down: false });
  assert.deepEqual(bytes, ['\r']); assert.equal(starts, 1);
  assert.ok(traces.some(([event]) => event === 'feed-adopted'));
  assert.ok(traces.every(entry => !entry.join(' ').includes(target.address) && !entry.join(' ').includes('\r')));
  await gamepad.stop(); assert.equal(stops, 1);
});
test('automatic handoff requires one exact identity and reconnect still requires Options', async () => {
  let listener;
  const extra = { ...pad, device: 2 };
  const feed = { start: async () => {}, stop: async () => {}, snapshot: () => [pad, extra], subscribe: fn => { listener = fn; return () => {}; } };
  const bytes = [], statuses = [], gamepad = new AgentGamepad(target, { factory: () => feed, feedStarted: true, automaticHandoff: true });
  gamepad.subscribe(data => bytes.push(data.toString()), text => statuses.push(text), () => {});
  await gamepad.start(signal); await new Promise(resolve => setTimeout(resolve, 275));
  listener({ type: 'button', device: 1, button: 'south', down: true }); listener({ type: 'button', device: 1, button: 'south', down: false });
  assert.deepEqual(bytes, []); assert.doesNotMatch(statuses.at(-1), /ACTIVE/); await gamepad.stop();

  const f = fixture(undefined, { automaticHandoff: true, feedStarted: true, now: Date.now }); await f.gamepad.start(signal);
  await new Promise(resolve => setTimeout(resolve, 275)); f.press('south'); assert.deepEqual(f.bytes, ['\r']);
  f.emit({ type: 'disconnected', device: 1 }); f.emit(pad); await new Promise(resolve => setTimeout(resolve, 275));
  f.press('south'); assert.deepEqual(f.bytes, ['\r']); f.press('start'); f.press('south'); assert.deepEqual(f.bytes, ['\r', '\r']);
  await f.gamepad.stop();
});
test('late events from an ended routing generation are discarded', async () => {
  let listener; const traces = [], bytes = [];
  const feed = { start: async () => {}, stop: async () => {}, snapshot: () => [pad], subscribe: fn => { listener = fn; return () => {}; } };
  const gamepad = new AgentGamepad(target, { factory: () => feed, feedStarted: true, automaticHandoff: true, trace: (...entry) => traces.push(entry) });
  gamepad.subscribe(data => bytes.push(data.toString()), () => {}, () => {});
  await gamepad.start(signal); await gamepad.stop();
  listener({ type: 'button', device: 1, button: 'south', down: true });
  assert.deepEqual(bytes, []); assert.ok(traces.some(([event]) => event === 'stale-event-discarded'));
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
const wait = () => new Promise(resolve => setTimeout(resolve, 275));
test('C2-A4 history hold consumes controller input and re-arms only after a neutral barrier', async () => {
  const f = fixture(undefined, { automaticHandoff: true });
  await f.gamepad.start(signal); f.advance(); await wait();
  assert.match(f.statuses.at(-1), /ACTIVE/);
  f.press('south'); assert.deepEqual(f.bytes, ['\r']);
  const cancelled = f.cancellations();
  f.gamepad.hold(); assert.match(f.statuses.at(-1), /HISTORY/); assert.equal(f.cancellations(), cancelled + 1);
  f.press('south'); f.press('start'); f.edge('dpad_up', true); assert.deepEqual(f.bytes, ['\r']);
  f.gamepad.resume(); assert.match(f.statuses.at(-1), /ARMING/);
  f.advance(); await wait(); assert.match(f.statuses.at(-1), /ARMING/);
  f.edge('dpad_up', false); f.advance(); await wait();
  assert.match(f.statuses.at(-1), /ACTIVE/); assert.deepEqual(f.bytes, ['\r']);
  f.press('east'); assert.deepEqual(f.bytes, ['\r', '\x1b']);
  // Paused mapping stays paused after history; disconnect during history keeps the reconnect rule.
  f.press('start'); assert.match(f.statuses.at(-1), /PAUSED/);
  f.gamepad.hold(); f.gamepad.resume(); assert.match(f.statuses.at(-1), /PAUSED/); f.press('south'); assert.equal(f.bytes.length, 2);
  f.press('start'); f.gamepad.hold(); f.emit({ type: 'disconnected', device: 1 }); f.gamepad.resume();
  assert.match(f.statuses.at(-1), /DISCONNECTED/);
  f.emit({ type: 'connected', device: 1, name: 'Fixture PS4', connection: 'wireless', serial: 'aa:bb:cc:dd:ee:ff' }); f.advance();
  f.press('south'); assert.equal(f.bytes.length, 2);
  await f.gamepad.stop();
});

