import test from 'node:test';
import assert from 'node:assert/strict';
import { agentKind, quickCommands, validCustom, maxCustom } from '../dist/quick-commands.js';
import { SessionControls } from '../dist/session-controls.js';
import { parseToMenu, parseFromMenu } from '../dist/session-ipc.js';
import { validateConfig } from '../dist/config.js';
import { renderPopup } from '../dist/popup-view.js';
import { stripAnsi } from '../dist/tui/index.js';
import { fixture } from './agent-gamepad-fixture.mjs';

const keys = list => list.map(entry => entry.keys);

test('QC-A1 palette per Agent kind with custom commands appended', () => {
  assert.equal(agentKind('/opt/homebrew/bin/claude'), 'claude'); assert.equal(agentKind('C:\\tools\\Codex.EXE'), 'codex');
  assert.equal(agentKind('/usr/local/bin/gemini'), 'other'); assert.equal(agentKind('/usr/bin/claude-wrapper'), 'other');
  assert.deepEqual(keys(quickCommands('claude')), ['/', '@', '!', '/clear', '/compact', '/model', '/resume', '/rewind', '/plan', '/context', '/diff', '/usage']);
  assert.deepEqual(keys(quickCommands('codex')), ['/', '@', '$', '/clear', '/compact', '/model', '/resume', '/plan', '/diff', '/status', '/review', '/fork']);
  assert.deepEqual(keys(quickCommands('other')), ['/', '@']);
  const custom = ['/review staged', '/frontend:component', 'no-slash', '/x\x1b'];
  assert.deepEqual(keys(quickCommands('other', custom)), ['/', '@', '/review staged', '/frontend:component']);
  const full = quickCommands('claude', Array.from({ length: 12 }, (_, i) => `/custom${i}`));
  assert.equal(full.length, 12 + maxCustom); assert.ok(full.length <= 24);
  for (const entry of full) { assert.ok(entry.label.length <= 64, entry.label); assert.ok(entry.label.startsWith(entry.keys)); }
  assert.equal(quickCommands('claude')[3].label, '/clear     New conversation');
  // The # memory shortcut was removed from Claude Code and is never offered; no entry presses Enter.
  for (const kind of ['claude', 'codex', 'other']) for (const entry of quickCommands(kind)) { assert.notEqual(entry.keys, '#'); assert.ok(!/[\r\n]/.test(entry.keys)); }
});

test('QC-A4 config accepts bounded custom commands and keeps older files unchanged', () => {
  const base = { version: 2, controller: { transport: 'bluetooth', inputVerified: false }, profile: 'terminal-basic', voice: null };
  const agent = { command: '/usr/bin/claude', args: [] };
  assert.deepEqual(validateConfig({ ...base, agent }).agent, agent);
  const commands = ['/review', '/frontend:component', '/plan ship the fix'];
  assert.deepEqual(validateConfig({ ...base, agent: { ...agent, commands } }).agent, { ...agent, commands });
  assert.deepEqual(validateConfig({ ...base, agent: { ...agent, commands: [] } }).agent.commands, []);
  for (const bad of [Array(maxCustom + 1).fill('/x'), ['review'], ['/'], ['/x\n'], ['/' + 'x'.repeat(60)], ['/' + 'é'.repeat(30)], [7], '/x', null]) {
    assert.throws(() => validateConfig({ ...base, agent: { ...agent, commands: bad } }), /quick commands/, JSON.stringify(bad));
  }
  assert.ok(validCustom('/' + 'x'.repeat(59))); assert.ok(!validCustom('/' + 'x'.repeat(60)));
});

function harness(list = quickCommands('claude', ['/frontend:component'])) {
  const calls = []; let handler;
  const controls = new SessionControls({
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' / ')[0]}`); },
    release: resume => { handler = undefined; calls.push(`release:${resume}`); },
    interrupt: () => calls.push('interrupt'), clear: () => calls.push('clear'),
    showMenu: view => calls.push(view ? `menu:${view.title}:${view.selected}:${view.items.length}` : 'menu:close'),
    history: command => calls.push(`history:${command}`), end: () => calls.push('end'),
    commands: () => list, type: text => calls.push(`type:${text}`),
  });
  return { controls, calls, press: button => handler?.(button), reset: () => { calls.length = 0; } };
}

test('QC-A2 every button has exactly one effect in Quick commands', () => {
  const expected = {
    dpad_up: ['menu:QUICK COMMANDS:12:13'], dpad_down: ['menu:QUICK COMMANDS:1:13'],
    south: ['type:/', 'menu:close', 'release:true'], east: ['menu:close', 'release:true'],
    start: ['menu:close', 'release:true'], back: ['menu:close', 'release:true'],
  };
  const buttons = ['dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'south', 'east', 'west', 'north', 'left_shoulder', 'right_shoulder', 'start', 'back', 'guide', 'left_stick', 'right_stick', 'touchpad'];
  for (const button of buttons) {
    const h = harness(); h.controls.openCommands();
    assert.equal(h.controls.context, 'commands'); assert.deepEqual(h.calls, ['capture:COMMANDS', 'menu:QUICK COMMANDS:0:13']);
    h.reset(); h.press(button);
    assert.deepEqual(h.calls, expected[button] ?? [], button);
  }
});

test('QC-A2 choosing types the command once, menu entry returns on O, keyboard picks, empty palettes stay closed', () => {
  let h = harness(); h.controls.openCommands();
  for (let i = 0; i < 4; i++) h.press('dpad_down');
  h.reset(); h.press('south'); assert.deepEqual(h.calls, ['type:/compact', 'menu:close', 'release:true']); assert.equal(h.controls.context, 'agent');
  h = harness(); h.controls.openCommands(); h.reset(); h.controls.key('confirm', 12);
  assert.deepEqual(h.calls, ['type:/frontend:component', 'menu:close', 'release:true']);
  h = harness(); h.controls.openCommands(); h.reset(); h.controls.key('confirm', 13); assert.deepEqual(h.calls, []);
  // From the controls menu: item 6 opens the palette, O goes back to that item, Options closes.
  h = harness(); h.controls.openMenu(); h.reset(); h.controls.key('confirm', 5);
  assert.deepEqual(h.calls, ['capture:COMMANDS', 'menu:QUICK COMMANDS:0:13']);
  h.press('east'); assert.equal(h.controls.context, 'menu'); assert.equal(h.calls.at(-1), 'menu:PADCODE CONTROLS:5:8');
  h.controls.key('confirm'); h.press('start'); assert.equal(h.controls.context, 'agent');
  // Opening with Share after the menu path closes on O again.
  h.controls.openCommands(); h.press('east'); assert.equal(h.controls.context, 'agent');
  // Share is ignored outside the Agent context, and lost() closes the palette without typing.
  h = harness(); h.controls.openMenu(); h.controls.openCommands(); assert.equal(h.controls.context, 'menu');
  h = harness(); h.controls.openCommands(); h.reset(); h.controls.lost(); assert.deepEqual(h.calls, ['menu:close', 'release:true']);
  h = harness([]); h.controls.openCommands(); assert.equal(h.controls.context, 'agent'); assert.deepEqual(h.calls, []);
  h.controls.openMenu(); assert.equal(h.calls.at(-1), 'menu:PADCODE CONTROLS:0:7', 'no Quick commands item without commands');
});

test('QC-A3 Share opens the palette only while routing; touchpad types @; nothing leaks while captured', async () => {
  const f = fixture(undefined, { automaticHandoff: true }); f.gamepad.enableMenu();
  const events = []; f.gamepad.onControl(event => events.push(event));
  await f.gamepad.start(new AbortController().signal); f.advance(); await new Promise(r => setTimeout(r, 275));
  f.press('back'); f.press('touchpad');
  assert.deepEqual(events, ['commands']); assert.deepEqual(f.bytes, ['@']);
  f.gamepad.capture(() => {}, 'COMMANDS'); f.press('back'); f.press('touchpad'); assert.deepEqual(events, ['commands']); assert.deepEqual(f.bytes, ['@']);
  f.gamepad.releaseCapture(false); f.press('back'); f.press('touchpad');
  assert.deepEqual(events, ['commands'], 'paused: Share does nothing'); assert.deepEqual(f.bytes, ['@']);
  await f.gamepad.stop();
});

test('QC-A5 long lists scroll around the selection; IPC carries 24 items', () => {
  const caps = { color: 0, unicode: false, motion: false, width: 46, height: 14 };
  const items = Array.from({ length: 24 }, (_, i) => `item ${i + 1}`);
  for (const rows of [8, 10, 14]) for (let selected = 0; selected < 24; selected++) {
    const lines = renderPopup({ t: 'menu', title: 'QUICK COMMANDS', items, selected, hint: 'h' }, caps, rows).map(stripAnsi);
    assert.ok(lines.length <= rows, `${rows}/${selected}`);
    assert.ok(lines.some(line => line.startsWith(`> ${selected + 1} `)), `selection visible ${rows}/${selected}`);
    const above = lines.find(line => /more above/.test(line)), below = lines.find(line => /more below/.test(line));
    assert.equal(Boolean(above), lines.every(line => !line.startsWith('  1  ') && !line.startsWith('> 1 ')), `top marker ${rows}/${selected}`);
    assert.equal(Boolean(below), lines.every(line => !/^(>| ) 24 /.test(line)), `bottom marker ${rows}/${selected}`);
  }
  // A list that fits the coordinator's popup (items + 4 rows inside the border) is never clipped.
  for (let count = 1; count <= 24; count++) {
    const list = items.slice(0, count), lines = renderPopup({ t: 'menu', title: 'Q', items: list, selected: 0, hint: 'h' }, caps, count + 4).map(stripAnsi);
    assert.equal(lines.length, count + 4); assert.ok(!lines.some(line => /more (above|below)/.test(line)), `count ${count}`);
  }
  const view = { t: 'menu', title: 'QUICK COMMANDS', items, selected: 23, hint: 'h' };
  assert.deepEqual(parseToMenu(JSON.stringify(view)), view);
  assert.throws(() => parseToMenu(JSON.stringify({ ...view, items: [...items, 'x'] })));
  assert.deepEqual(parseFromMenu('{"t":"action","name":"pick","index":23}'), { t: 'action', name: 'pick', index: 23 });
});
