import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadMenus } from '../dist/menu-controller.js';
const target = { transport: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff', inputVerified: false };
const pad = { type: 'connected', device: 1, name: 'Pad', connection: 'wireless', serial: target.address };
function fixture(startError) {
  let listener, starts = 0, stops = 0;
  const feed = {
    start: async signal => { starts++; signal.throwIfAborted(); if (startError) throw startError; },
    stop: async () => { stops++; }, snapshot: () => [pad],
    subscribe: fn => { listener = fn; return () => { listener = undefined; }; },
    devices: async () => [pad], press: async () => 'south',
  };
  const menus = new GamepadMenus(() => feed), actions = [], statuses = [];
  menus.subscribeAction(action => actions.push(action)); menus.subscribeStatus(status => statuses.push(status));
  return { menus, actions, statuses, emit: (event, error) => listener?.(event, error), counts: () => ({ starts, stops }) };
}
const signal = new AbortController().signal;
test('menu input requires a fresh claim, filters identity and reclaims after disconnect', async () => {
  const f = fixture(); await f.menus.activate(target, signal);
  const press = (button, device = 1, down = true) => f.emit({ type: 'button', device, button, down });
  press('dpad_left'); assert.deepEqual(f.actions, []);
  f.emit({ ...pad, device: 2, serial: '00:00:00:00:00:00' }); press('south', 2);
  press('south'); assert.deepEqual(f.actions, []);
  press('south', 1, false); press('dpad_down'); press('dpad_up'); press('south'); press('east'); press('west');
  assert.deepEqual(f.actions, ['down', 'up', 'confirm', 'cancel']);
  f.emit({ type: 'disconnected', device: 1 }); press('south');
  assert.match(f.statuses.at(-1), /DISCONNECTED/);
  f.emit({ ...pad, device: 3 }); press('south', 3); assert.equal(f.actions.length, 4);
  press('south', 3, false); press('south', 3); assert.equal(f.actions.at(-1), 'confirm');
  const probe = f.menus.probe(); await probe.start(signal); assert.equal((await probe.devices(signal))[0].device, 1);
  assert.equal(await probe.press(1, signal), 'south'); await probe.stop(); assert.equal(f.counts().stops, 0);
  await f.menus.stop(); assert.deepEqual(f.counts(), { starts: 1, stops: 1 });
});
test('ambiguous identity is claimed by physical press; another controller cannot drive it', async () => {
  const f = fixture(); await f.menus.activate({ transport: 'bluetooth', inputVerified: false }, signal);
  f.emit({ ...pad, device: 2, serial: undefined });
  f.emit({ type: 'button', device: 2, button: 'south', down: true });
  f.emit({ type: 'button', device: 1, button: 'south', down: true }); assert.deepEqual(f.actions, []);
  f.emit({ type: 'button', device: 2, button: 'dpad_down', down: true }); assert.deepEqual(f.actions, ['down']);
  f.emit(undefined, new Error('helper lost')); assert.match(f.statuses.at(-1), /INPUT LOST/);
  f.emit({ type: 'button', device: 2, button: 'south', down: true }); assert.equal(f.actions.length, 1);
  await f.menus.stop();
});
test('startup failure, reactivation and abort release the input helper', async () => {
  const failed = fixture(new Error('missing helper')); await failed.menus.activate(target, signal);
  assert.match(failed.statuses.at(-1), /UNAVAILABLE/); assert.equal(failed.counts().stops, 1);
  const f = fixture(); await f.menus.activate(target, signal); await f.menus.activate(target, signal);
  assert.deepEqual(f.counts(), { starts: 2, stops: 1 }); await f.menus.stop();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.menus.activate(target, controller.signal)); assert.equal(f.counts().stops, 3);
});
