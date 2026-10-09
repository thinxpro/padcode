import test from 'node:test';
import assert from 'node:assert/strict';
import { render, safeLabel, safeText, colorEnabled, help } from '../dist/ui.js';
import { createState, reduce } from '../dist/state.js';
test('arcade dashboard obeys terminal bounds at many widths and heights', () => {
  const state = createState();
  reduce(state, { v: 1, seq: 1, time: 1, type: 'connected', device: 1, name: '\x1b]52;c;bad\x07\ncontrolleréλ' });
  state.devices.get(1).buttons.add('south'); state.devices.get(1).axes.leftx = -0.5;
  for (const width of [12, 32, 40, 58, 80, 120]) for (const height of [5, 12, 24, 40]) {
    const frame = render(state, width, height, false);
    assert.ok(frame.split('\n').every(l => l.length < width)); assert.ok(frame.split('\n').length < height);
    assert.ok(!frame.includes('\x1b')); assert.ok(!frame.includes('\x07'));
  }
  const plain = render(state, 80, 32, false);
  // Without a reported family the lab uses standard (Xbox-style) names; each family shows its own.
  assert.match(plain, /PLAYER READY/); assert.match(plain, /\[A\]/); assert.match(plain, /-#####/); assert.match(plain, /HOLD B 1S|Q \/ ESC EXIT/);
  for (const [family, south, shoulder] of [['playstation', 'X', 'L1'], ['xbox', 'A', 'LB'], ['nintendo', 'B', 'L']]) {
    state.devices.get(1).family = family;
    const named = render(state, 80, 32, false);
    assert.match(named, new RegExp(`\\[${south}\\]`), family); assert.match(named, new RegExp(` ${shoulder} `), family);
  }
  delete state.devices.get(1).family;
  assert.match(render(state), /\x1b\[/);
});
test('boot, waiting, demo and virtual states are honest', () => {
  const s = createState(); assert.match(render(s), /BOOTING/);
  s.ready = true; assert.match(render(s), /INSERT CONTROLLER/);
  s.source = 'demo'; assert.match(render(s), /SYNTHETIC/); assert.match(render(s), /NOT HARDWARE/);
  s.source = 'virtual'; assert.match(render(s), /VIRTUAL/);
});
test('NO_COLOR, dumb terminal, non-TTY and hostile labels', () => {
  assert.equal(colorEnabled({}, true), true);
  for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }]) assert.equal(colorEnabled(env, true), false);
  assert.equal(colorEnabled({}, false), false);
  assert.equal(safeLabel('\x1b\n\r\u009béλ'), '??????');
  // Transcripts and device names keep Unicode but lose controls, bidi overrides and lone surrogates.
  assert.equal(safeText('帮我 é🎮 Studio Display麦克风'), '帮我 é🎮 Studio Display麦克风');
  assert.equal(safeText('a\x1b[2Jb\u202eevil\u0085\ud800c'), 'a [2Jb evil ?c');
});
