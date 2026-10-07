import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionControls, menuItems, confirmItems } from '../dist/session-controls.js';
import { parseToMenu, parseFromMenu } from '../dist/session-ipc.js';
import { fixture } from './agent-gamepad-fixture.mjs';

const buttons = ['dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'south', 'east', 'west', 'north', 'left_shoulder', 'right_shoulder', 'start', 'back', 'guide', 'left_stick', 'right_stick'];
function harness() {
  const calls = []; let handler;
  const controls = new SessionControls({
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' / ')[0]}`); },
    release: resume => { handler = undefined; calls.push(`release:${resume}`); },
    interrupt: () => calls.push('interrupt'), clear: () => calls.push('clear'),
    showMenu: view => calls.push(view ? `menu:${view.title}:${view.selected}` : 'menu:close'),
    history: command => calls.push(`history:${command}`),
    end: () => calls.push('end'),
  });
  const press = button => { if (handler) handler(button); };
  return { controls, calls, press, reset: () => { calls.length = 0; } };
}
function at(context) {
  const h = harness();
  if (context !== 'agent') h.controls.openMenu();
  if (context === 'confirm') { for (let i = 0; i < 5; i++) h.press('dpad_down'); h.press('south'); }
  if (context === 'history') { h.press('dpad_down'); h.press('dpad_down'); h.press('south'); }
  assert.equal(h.controls.context, context); h.reset(); return h;
}

test('C3-A1 every button has exactly one effect in every context', () => {
  const expected = {
    agent: {},
    menu: { dpad_up: ['menu:PADCODE CONTROLS:5'], dpad_down: ['menu:PADCODE CONTROLS:1'], south: ['menu:close', 'release:true'], east: ['menu:close', 'release:true'], start: ['menu:close', 'release:true'] },
    confirm: { dpad_up: ['menu:END SESSION?:1'], dpad_down: ['menu:END SESSION?:1'], south: ['capture:MENU', 'menu:PADCODE CONTROLS:5'], east: ['capture:MENU', 'menu:PADCODE CONTROLS:5'], start: ['menu:close', 'release:true'] },
    history: { dpad_up: ['history:up'], dpad_down: ['history:down'], left_shoulder: ['history:page-up'], right_shoulder: ['history:page-down'], east: ['history:exit', 'release:true'], start: ['history:exit', 'release:true'] },
  };
  for (const [context, effects] of Object.entries(expected)) {
    for (const button of buttons) {
      const h = at(context);
      if (context === 'agent') h.controls.button(button); else h.press(button);
      assert.deepEqual(h.calls, effects[button] ?? [], `${context} / ${button}`);
    }
  }
});

test('C3 menu items: resume, pause, history, interrupt and confirmed end', () => {
  const pick = index => { const h = at('menu'); for (let i = 0; i < index; i++) h.press('dpad_down'); h.reset(); h.press('south'); return h; };
  assert.deepEqual(pick(0).calls, ['menu:close', 'release:true']);
  assert.deepEqual(pick(1).calls, ['menu:close', 'release:false']);
  assert.deepEqual(pick(2).calls, ['capture:HISTORY', 'menu:close', 'history:enter']);
  assert.deepEqual(pick(3).calls, ['interrupt', 'menu:close', 'release:true']);
  assert.deepEqual(pick(4).calls, ['clear', 'menu:close', 'release:true']);
  assert.deepEqual(pick(5).calls, ['capture:END SESSION?', 'menu:END SESSION?:0']);
  const h = at('confirm'); h.press('dpad_down'); h.reset(); h.press('south');
  assert.deepEqual(h.calls, ['menu:close', 'end']); assert.equal(h.controls.context, 'agent');
  assert.equal(menuItems.length, 6); assert.equal(menuItems[4], 'Clear input'); assert.deepEqual(confirmItems, ['Keep the session running', 'End the Agent session']);
});

test('C3 popup keys, mouse history, history exits and lost contexts', () => {
  let h = at('menu'); h.controls.key('confirm', 3); assert.deepEqual(h.calls, ['interrupt', 'menu:close', 'release:true']);
  h = at('menu'); h.controls.key('confirm', 9); assert.deepEqual(h.calls, []);
  h = at('menu'); h.controls.key('back'); assert.deepEqual(h.calls, ['menu:close', 'release:true']);
  h = at('agent'); h.controls.key('confirm'); assert.deepEqual(h.calls, []);
  h = at('agent'); h.controls.historyEntered(); assert.deepEqual(h.calls, ['capture:HISTORY', 'menu:close']); assert.equal(h.controls.context, 'history');
  h.reset(); h.controls.historyEntered(); assert.deepEqual(h.calls, []);
  h.controls.historyLeft(); assert.deepEqual(h.calls, ['release:true']); assert.equal(h.controls.context, 'agent');
  h = at('history'); h.press('east'); h.controls.historyLeft(); assert.deepEqual(h.calls, ['history:exit', 'release:true']);
  for (const context of ['menu', 'confirm']) { h = at(context); h.controls.lost(); assert.deepEqual(h.calls, ['menu:close', 'release:true']); }
  h = at('history'); h.controls.lost(); assert.deepEqual(h.calls, ['history:exit', 'release:true']);
  h = at('agent'); h.controls.lost(); assert.deepEqual(h.calls, []);
  h = at('menu'); h.controls.openMenu(); assert.deepEqual(h.calls, []);
});

test('C3-A2/A3 real gamepad routing: 100 presses per context and a release barrier on close', async () => {
  const f = fixture(undefined, { automaticHandoff: true }); f.gamepad.enableMenu();
  const controls = new SessionControls({
    capture: (fn, status) => f.gamepad.capture(fn, status), release: resume => f.gamepad.releaseCapture(resume),
    interrupt: () => {}, showMenu: () => {}, history: () => {}, end: () => {},
  });
  f.gamepad.onControl(event => { if (event === 'menu') controls.openMenu(); else controls.lost(); });
  await f.gamepad.start(new AbortController().signal); f.advance(); await new Promise(r => setTimeout(r, 275));
  assert.match(f.statuses.at(-1), /ACTIVE \/ Options menu/);
  for (let i = 0; i < 100; i++) f.press('south');
  assert.equal(f.bytes.length, 100); assert.ok(f.bytes.every(b => b === '\r'));
  f.press('start'); assert.equal(controls.context, 'menu'); assert.match(f.statuses.at(-1), /MENU/);
  for (let i = 0; i < 100; i++) { f.press('dpad_left'); f.press('north'); }
  assert.equal(f.bytes.length, 100);
  // Close with X while holding R1: nothing reaches the Agent until every button is released.
  f.edge('right_shoulder', true); f.press('south'); assert.equal(controls.context, 'agent');
  f.press('south'); f.advance(); await new Promise(r => setTimeout(r, 275));
  assert.match(f.statuses.at(-1), /ARMING/); assert.equal(f.bytes.length, 100);
  f.edge('right_shoulder', false); f.advance(); await new Promise(r => setTimeout(r, 275));
  assert.match(f.statuses.at(-1), /ACTIVE/); f.press('east'); assert.deepEqual(f.bytes.slice(100), ['\x1b']);
  // Pause from the menu stays paused through the barrier; Options resumes.
  f.press('start'); f.press('dpad_down'); f.press('south'); assert.match(f.statuses.at(-1), /PAUSED/);
  f.advance(); await new Promise(r => setTimeout(r, 275)); f.press('south'); assert.equal(f.bytes.length, 101);
  f.press('start'); assert.match(f.statuses.at(-1), /ACTIVE/); assert.equal(controls.context, 'agent');
  // Disconnect inside the menu closes it and keeps the reconnect rule.
  f.press('start'); f.emit({ type: 'disconnected', device: 1 }); assert.equal(controls.context, 'agent');
  assert.match(f.statuses.at(-1), /DISCONNECTED/);
  f.emit({ type: 'connected', device: 1, name: 'Fixture PS4', connection: 'wireless', serial: 'aa:bb:cc:dd:ee:ff' }); f.advance();
  f.press('south'); assert.equal(f.bytes.length, 101);
  f.press('start'); assert.match(f.statuses.at(-1), /ACTIVE/); assert.equal(controls.context, 'agent');
  await f.gamepad.stop();
});

test('C3-A7 menu IPC accepts only bounded menu views and known actions', () => {
  const view = { t: 'menu', title: 'PADCODE CONTROLS', items: menuItems, selected: 0, hint: 'x' };
  assert.deepEqual(parseToMenu(JSON.stringify(view)), view);
  assert.deepEqual(parseToMenu('{"t":"close"}'), { t: 'close' });
  for (const bad of [{ ...view, selected: menuItems.length }, { ...view, items: [] }, { ...view, items: Array(10).fill('x') }, { ...view, title: 'x'.repeat(65) }, { ...view, extra: 1 }, { t: 'status', text: 'x' }]) {
    assert.throws(() => parseToMenu(JSON.stringify(bad)));
  }
  for (const name of ['up', 'down', 'confirm', 'back']) assert.deepEqual(parseFromMenu(JSON.stringify({ t: 'action', name })), { t: 'action', name });
  assert.deepEqual(parseFromMenu('{"t":"action","name":"pick","index":3}'), { t: 'action', name: 'pick', index: 3 });
  for (const bad of ['{"t":"action","name":"end"}', '{"t":"action","name":"pick","index":9}', '{"t":"action","name":"pick"}', '{"t":"keys","data":"AA=="}']) assert.throws(() => parseFromMenu(bad));
});
