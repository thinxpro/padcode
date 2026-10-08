import test from 'node:test';
import assert from 'node:assert/strict';
import { StickInput, editKeys, agentOnly } from '../dist/stick-input.js';
import { fixture } from './agent-gamepad-fixture.mjs';

// Deterministic timers: advance(ms) runs due callbacks in order.
function clock() {
  let now = 0, id = 0; const due = new Map();
  return {
    timers: { set: (fn, ms) => { due.set(++id, { at: now + ms, fn }); return id; }, clear: handle => due.delete(handle) },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    pending: () => due.size,
  };
}
const full = 32767;
function input() { const c = clock(), fired = []; const s = new StickInput(action => fired.push(action), c.timers); return { s, c, fired }; }

test('A1 directions: thresholds, hysteresis, dominant axis and diagonal jitter', () => {
  const { s, fired } = input();
  s.axis('leftx', Math.round(0.45 * full)); assert.deepEqual(fired, []);
  s.axis('leftx', Math.round(0.55 * full)); assert.deepEqual(fired, ['right']);
  s.axis('leftx', Math.round(0.35 * full)); assert.deepEqual(fired, ['right'], 'released above the release threshold');
  s.axis('lefty', Math.round(-0.9 * full)); assert.deepEqual(fired, ['right'], 'locked axis switched direction while held');
  // Rotating from right to up: once right releases, the held up direction starts (intuitive), exactly once.
  s.axis('leftx', Math.round(0.1 * full)); assert.deepEqual(fired, ['right']); s.axis('leftx', 0); assert.deepEqual(fired, ['right', 'up']);
  s.axis('lefty', Math.round(-0.95 * full)); assert.deepEqual(fired, ['right', 'up']);
  s.axis('lefty', 0); s.axis('leftx', Math.round(-0.6 * full)); s.axis('lefty', Math.round(0.4 * full));
  assert.deepEqual(fired, ['right', 'up', 'left'], 'diagonal jitter moved a line');
  s.axis('leftx', 0); s.axis('lefty', 0);
  for (const [axis, value, action] of [['rightx', -full, 'word-left'], ['rightx', full, 'word-right'], ['righty', -full, 'home'], ['righty', full, 'end'], ['lefty', full, 'down']]) {
    s.axis(axis, value); assert.equal(fired.at(-1), action); s.axis(axis, 0);
  }
});

test('A2 repeats: delays, tilt-dependent speed, release and stop cancel everything', () => {
  let { s, c, fired } = input();
  s.axis('leftx', Math.round(0.55 * full)); c.advance(349); assert.equal(fired.length, 1);
  c.advance(1); assert.equal(fired.length, 2); c.advance(1000);
  const slow = fired.length;
  ({ s, c, fired } = input());
  s.axis('leftx', full); c.advance(1350); const fast = fired.length;
  assert.ok(fast > slow * 2, `full tilt (${fast}) not faster than light tilt (${slow})`);
  s.axis('leftx', 0); const after = fired.length; c.advance(2000); assert.equal(fired.length, after, 'repeat continued after release'); assert.equal(c.pending(), 0);
  // Word and line-end repeats.
  s.axis('rightx', full); c.advance(350 + 110 * 3); assert.equal(fired.filter(a => a === 'word-right').length, 5); s.axis('rightx', 0);
  s.axis('righty', -full); c.advance(400 * 3); assert.equal(fired.filter(a => a === 'home').length, 4); s.axis('righty', 0);
  // Square repeats, Triangle repeats, L3/R3 fire once.
  s.button('west', true); c.advance(400 + 70 * 5); s.button('west', false); assert.equal(fired.filter(a => a === 'backspace').length, 7);
  s.button('north', true); s.button('north', false); c.advance(1000); assert.equal(fired.filter(a => a === 'delete-word').length, 1);
  s.button('left_stick', true); s.button('left_stick', false); s.button('right_stick', true); c.advance(1000);
  assert.equal(fired.filter(a => a === 'delete').length, 1); assert.equal(fired.filter(a => a === 'undo').length, 1);
  assert.equal(s.button('south', true), false, 'claimed a button it does not handle');
  // stop(): cancels repeats; a stick still held must centre before acting again.
  s.axis('leftx', full); s.button('west', true); const held = fired.length; s.stop(); c.advance(3000); assert.equal(fired.length, held); assert.equal(c.pending(), 0);
  s.axis('leftx', Math.round(0.99 * full)); assert.equal(fired.length, held, 'held stick acted right after stop');
  s.axis('leftx', 0); s.axis('leftx', full); assert.equal(fired.at(-1), 'right');
});

test('A3 R2 newline uses trigger hysteresis and a trigger held through stop must release first', () => {
  const { s, fired } = input();
  s.axis('right_trigger', Math.round(0.6 * full)); assert.deepEqual(fired, []);
  s.axis('right_trigger', Math.round(0.7 * full)); s.axis('right_trigger', Math.round(0.5 * full)); s.axis('right_trigger', full); assert.deepEqual(fired, ['newline']);
  s.axis('right_trigger', Math.round(0.3 * full)); s.axis('right_trigger', full); assert.deepEqual(fired, ['newline', 'newline']);
  s.stop(); s.axis('right_trigger', Math.round(0.9 * full)); assert.deepEqual(fired, ['newline', 'newline']);
  s.axis('right_trigger', 0); s.axis('right_trigger', full); assert.deepEqual(fired, ['newline', 'newline', 'newline']);
});

test('A3 exact bytes: no control sends Enter, and newline/undo are Claude Code only', async () => {
  for (const [action, bytes] of Object.entries(editKeys)) assert.ok(!bytes.includes('\r'), action);
  assert.deepEqual(Object.entries(editKeys).filter(([, b]) => b.includes('\n')).map(([a]) => a), ['newline']);
  assert.deepEqual(agentOnly, ['newline', 'undo']);
  const wait = () => new Promise(r => setTimeout(r, 275));
  for (const editing of ['basic', 'claude']) {
    const f = fixture(undefined, { automaticHandoff: true, editing });
    await f.gamepad.start(new AbortController().signal); f.advance(); await wait();
    const axis = (axis, value) => f.emit({ type: 'axis', device: 1, axis, value });
    axis('leftx', -full); axis('leftx', 0); axis('lefty', full); axis('lefty', 0);
    axis('rightx', -full); axis('rightx', 0); axis('rightx', full); axis('rightx', 0); axis('righty', -full); axis('righty', 0); axis('righty', full); axis('righty', 0);
    f.press('west'); f.press('north'); f.press('left_stick'); f.press('right_stick'); axis('right_trigger', full); axis('right_trigger', 0);
    const base = ['\x1b[D', '\x1b[B', '\x1b[1;5D', '\x1b[1;5C', '\x1b[H', '\x1b[F', '\x7f', '\x17', '\x1b[3~'];
    assert.deepEqual(f.bytes, editing === 'claude' ? [...base, '\x1f', '\n'] : base, editing);
    // Another controller's sticks and a paused controller send nothing.
    const before = f.bytes.length;
    f.emit({ type: 'axis', device: 2, axis: 'leftx', value: full });
    f.press('start'); axis('leftx', full); f.press('west'); assert.equal(f.bytes.length, before);
    await f.gamepad.stop();
  }
});

test('A4 inside Padcode contexts the left stick is the D-pad and the right stick pages', async () => {
  const f = fixture(undefined, { automaticHandoff: true, editing: 'claude' }); const wait = () => new Promise(r => setTimeout(r, 275));
  await f.gamepad.start(new AbortController().signal); f.advance(); await wait();
  const seen = []; f.gamepad.capture(button => seen.push(button), 'MENU / test');
  const axis = (axis, value) => f.emit({ type: 'axis', device: 1, axis, value });
  axis('lefty', full); axis('lefty', 0); axis('lefty', -full); axis('lefty', 0); axis('leftx', full); axis('leftx', 0);
  axis('righty', -full); axis('righty', 0); axis('righty', full); axis('righty', 0); axis('rightx', full); axis('rightx', 0); axis('right_trigger', full);
  f.press('west');
  assert.deepEqual(seen, ['dpad_down', 'dpad_up', 'dpad_right', 'left_shoulder', 'right_shoulder', 'west']);
  assert.deepEqual(f.bytes, [], 'a Padcode context leaked editing keys to the Agent');
  await f.gamepad.stop();
});
