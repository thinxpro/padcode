import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduce, deadzone } from '../dist/state.js';
const event = fields => ({ v: 1, seq: 1, time: 1, device: 1, ...fields });
const connect = (s, id = 1) => reduce(s, event({ type: 'connected', device: id, name: `Pad ${id}` }));
test('duplicate button edges are ignored; history is bounded', () => {
  const s = createState(); connect(s);
  const button = down => reduce(s, event({ type: 'button', button: 'south', down }));
  button(false); button(true); button(true); assert.equal(s.transitions, 1);
  button(false); button(false); assert.equal(s.transitions, 2);
  for (let n = 0; n < 40; n++) button(n % 2 === 0);
  assert.equal(s.history.length, 6); assert.equal(s.devices.get(1).buttons.size, 0);
});
test('deadzone and endpoints cover both sticks and unipolar triggers', () => {
  for (const value of [0, 10, -10, 3000, -3000]) assert.equal(deadzone(value), 0);
  assert.equal(deadzone(-32768), -1); assert.equal(deadzone(32767), 1);
  assert.ok(deadzone(12000) > 0); assert.ok(deadzone(-12000) < 0);
  assert.equal(deadzone(-32768, true), 0); assert.equal(deadzone(1000, true), 0); assert.equal(deadzone(32767, true), 1);
});
test('disconnect clears held state and axes; reconnect starts fresh', () => {
  const s = createState(); connect(s);
  reduce(s, event({ type: 'button', button: 'south', down: true }));
  reduce(s, event({ type: 'axis', axis: 'leftx', value: 32767 }));
  const old = s.devices.get(1);
  reduce(s, event({ type: 'disconnected' }));
  assert.equal(s.selected, null); assert.equal(old.buttons.size, 0); assert.equal(old.axes.leftx, 0);
  connect(s, 2); assert.equal(s.selected, 2); assert.equal(s.devices.get(2).buttons.size, 0);
});
test('devices remain isolated, unknown events ignored, duplicate connection preserves state', () => {
  const s = createState(); connect(s); connect(s, 2);
  reduce(s, event({ device: 2, type: 'button', button: 'north', down: true }));
  connect(s, 2);
  assert.equal(s.selected, 1); assert.equal(s.devices.get(1).buttons.size, 0); assert.equal(s.devices.get(2).buttons.size, 1);
  reduce(s, event({ type: 'button', device: 99, button: 'south', down: true }));
  reduce(s, event({ type: 'disconnected', device: 99 }));
  assert.equal(s.devices.size, 2);
  reduce(s, event({ type: 'disconnected', device: 2 })); assert.equal(s.selected, 1);
  connect(s, 3); reduce(s, event({ type: 'disconnected' })); assert.equal(s.selected, 3);
  reduce(s, { v: 1, seq: 0, time: 0, type: 'ready', source: 'virtual', sdl: '3' }); assert.equal(s.source, 'virtual'); assert.equal(s.ready, true);
});
