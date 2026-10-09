import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLab, drawController, labBody } from '../dist/lab-view.js';
import { createState, reduce } from '../dist/state.js';
import { Canvas, stripAnsi, visibleWidth } from '../dist/tui/index.js';
import { snapshot } from './snapshot.mjs';

const caps = (over = {}) => ({ color: 24, unicode: true, motion: false, width: 90, height: 34, ...over });
const truecolor = caps(), mono = caps({ color: 0 }), ascii = caps({ color: 0, unicode: false });
const printableAscii = text => /^[\x20-\x7e]*$/.test(text);
let seq = 0;
const event = (type, extra) => ({ v: 1, seq: ++seq, time: seq, type, device: 1, ...extra });
function pad(family, name = 'Test Pad') {
  const state = createState(); state.ready = true; state.back = 'hold';
  reduce(state, event('connected', { name, ...(family ? { family } : {}) }));
  return { state, device: state.devices.get(1), press: button => reduce(state, event('button', { button, down: true })) };
}
const plain = lines => lines.map(stripAnsi).join('\n');

test('L1 canvas places, clips, keeps wide characters and merges style runs', () => {
  const c = new Canvas(10, 2, truecolor);
  c.put(0, 0, 'abc').put(0, 8, 'xyz').put(0, -1, 'QR').put(5, 0, 'none');
  c.put(1, 2, '한', { tone: 'ok' }).put(1, 4, 'ab', { tone: 'ok' }).centre(1, 8, 'Z', { tone: 'danger' });
  const lines = c.lines();
  assert.deepEqual(lines.map(stripAnsi), ['Rbc     xy', '  한ab  Z ']);
  assert.ok(lines.every(line => visibleWidth(line) === 10));
  assert.equal((lines[1].match(/\x1b\[38;2;95;215;135m/g) ?? []).length, 1, 'adjacent cells with one style share one run');
  assert.ok(lines[1].endsWith('\x1b[0m') || lines[1].endsWith(' '));
  const m = new Canvas(4, 1, mono).put(0, 0, 'ab', { tone: 'ok', inverse: true }).lines();
  assert.deepEqual(m, ['ab  ']);
  assert.deepEqual(new Canvas(0, 0, mono).lines(), []);
  assert.deepEqual(new Canvas(3, 1, mono).put(0, 2, '한').lines(), ['   '], 'a wide character that does not fit is clipped');
});
test('L2 every control lights its part, with each family\'s names', () => {
  const families = { playstation: ['X', 'O', 'SQ', 'TRI', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'SHARE', 'OPTIONS', 'TOUCHPAD'], xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'VIEW', 'MENU', 'HOME'], nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', 'LS', 'RS', '-', '+', 'HOME'] };
  const buttons = ['south', 'east', 'west', 'north', 'left_shoulder', 'right_shoulder', null, null, 'left_stick', 'right_stick', 'back', 'start', null];
  for (const [family, names] of Object.entries(families)) {
    names.forEach((name, i) => {
      const button = buttons[i];
      if (!button) return;
      const { device, press } = pad(family);
      assert.doesNotMatch(plain(drawController(device, mono)), new RegExp(`\\[${name.replace(/[+-]/g, '\\$&')}\\]`), `${family} ${name} idle`);
      press(button);
      assert.match(plain(drawController(device, mono)), new RegExp(`\\[${name.replace(/[+-]/g, '\\$&')}\\]`), `${family} ${name} pressed`);
    });
    const { device } = pad(family);
    const idle = plain(drawController(device, mono));
    for (const name of names) assert.ok(idle.includes(name), `${family} shows ${name}`);
  }
  const { device, press } = pad('playstation');
  for (const [button, mark] of [['dpad_up', '[▲]'], ['dpad_down', '[▼]'], ['dpad_left', '[◀]'], ['dpad_right', '[▶]'], ['touchpad', '[TOUCHPAD]'], ['guide', '[PS]']]) {
    press(button); assert.ok(plain(drawController(device, mono)).includes(mark), button);
  }
  const x = pad('xbox'); x.press('guide'); assert.ok(plain(drawController(x.device, mono)).includes('[HOME]'));
  // Without a reported family the standard (Xbox-style) names are used.
  const standard = pad(); standard.press('south'); assert.match(plain(drawController(standard.device, mono)), /\[A\]/);
  // Colour marks pressed controls with inverse accent caps instead of brackets.
  const lit = pad('playstation'); lit.press('south');
  const coloured = drawController(lit.device, truecolor).join('\n');
  assert.match(coloured, /\x1b\[1;7;38;2;255;95;215m X \x1b\[0m/); assert.doesNotMatch(stripAnsi(coloured), /\[X\]/);
});
test('L2 stick dots and trigger meters follow the axes', () => {
  const cellOf = (lines, column) => {
    for (let r = 9; r <= 11; r++) { const row = [...stripAnsi(lines[r])]; for (let c = column + 1; c <= column + 5; c++) if (row[c] === '●' || row[c] === '·') return [r - 9, c - column - 1, row[c]]; }
  };
  const { device } = pad('playstation');
  assert.deepEqual(cellOf(drawController(device, mono), 17), [1, 2, '·'], 'centred at rest');
  for (const [x, y, expected] of [[-1, -1, [0, 0]], [1, -1, [0, 4]], [-1, 1, [2, 0]], [1, 1, [2, 4]], [0.5, 0, [1, 3]], [NaN, 2, [2, 2]]]) {
    device.axes.leftx = x; device.axes.lefty = y; device.axes.rightx = x; device.axes.righty = y;
    const lines = drawController(device, mono);
    assert.deepEqual(cellOf(lines, 17).slice(0, 2), expected, `left ${x},${y}`);
    assert.deepEqual(cellOf(lines, 37).slice(0, 2), expected, `right ${x},${y}`);
  }
  device.axes.leftx = -0.5; device.axes.lefty = 0;
  assert.match(plain(drawController(device, mono)), /X-0\.50 Y\+0\.00/);
  device.axes.left_trigger = 0.5; device.axes.right_trigger = 1;
  const top = stripAnsi(drawController(device, mono)[0]);
  assert.match(top, /L2 ██████░░░░░░/); assert.match(top, /R2 ████████████/);
  assert.match(stripAnsi(drawController(device, ascii)[0]), /L2 ######\.\.\.\.\.\./);
  // A trigger past half lights its name.
  assert.match(drawController(device, truecolor)[0], /\x1b\[1;38;2;255;95;215mR2/);
  // L3/R3 pressed light the stick frame and name.
  const s = pad('playstation'); s.press('left_stick');
  assert.match(plain(drawController(s.device, mono)), /\[L3\]/);
  assert.match(drawController(s.device, truecolor)[8], /\x1b\[1;38;2;255;95;215m╭─────╮/);
});
test('L2 states keep their wording', () => {
  const s = createState();
  assert.match(plain(renderLab(s, mono)), /BOOTING INPUT ENGINE\.\.\./);
  s.ready = true; assert.match(plain(renderLab(s, mono)), /INSERT CONTROLLER {2}\/\/ {2}waiting for connection/); assert.match(plain(renderLab(s, mono)), /LIVE \/ SDL INPUT/);
  assert.match(plain(renderLab(s, mono)), /Q \/ ESC EXIT {3}\| {3}CTRL\+C QUIT/);
  s.source = 'demo'; assert.match(plain(renderLab(s, mono)), /DEMO \/ SYNTHETIC INPUT/); assert.match(plain(renderLab(s, mono)), /DEMO - NOT HARDWARE EVIDENCE/);
  s.source = 'virtual'; assert.match(plain(renderLab(s, mono)), /TEST \/ VIRTUAL DEVICE/);
  const { state } = pad('playstation');
  assert.match(plain(renderLab(state, mono)), /PLAYER READY {2}\/\/ {2}Test Pad/);
  assert.match(plain(renderLab(state, mono)), /HOLD O 1S \/ Q BACK/);
  state.back = 'release'; assert.match(plain(renderLab(state, mono)), /RELEASE O TO RETURN/);
  state.back = 'press'; assert.match(plain(renderLab(state, mono)), /O \/ Q BACK/);
  const x = pad('xbox'); assert.match(plain(renderLab(x.state, mono)), /HOLD B 1S \/ Q BACK/);
  x.press('south'); assert.match(plain(renderLab(x.state, mono)), /HELD SOUTH/); assert.match(plain(renderLab(x.state, mono)), /RECENT INPUT.*\n.*DOWN SOUTH \[1\]/);
  // Phrases stay contiguous in colour.
  for (const phrase of ['PLAYER READY  //  Test Pad', 'LIVE / SDL INPUT', 'HOLD B 1S / Q BACK', 'CTRL+C QUIT']) assert.ok(renderLab(x.state, truecolor).join('').includes(phrase), phrase);
});
test('L3 every size and mode fits, hostile names are sanitised', () => {
  const hostile = pad('playstation', '\x1b]52;c;bad\x07\ncontrolleréλ 한국어');
  hostile.press('south'); hostile.device.axes.leftx = -0.5;
  const states = [createState(), hostile.state];
  for (const state of states) for (const [mode, c] of Object.entries({ truecolor, mono, ascii })) for (const width of [12, 20, 32, 40, 58, 64, 80, 120, 160]) for (const height of [5, 12, 20, 24, 30, 50]) {
    const lines = renderLab(state, { ...c, width, height });
    const label = `${mode} ${width}x${height}`;
    assert.ok(lines.length <= Math.max(1, height - 1), label);
    assert.ok(lines.every(line => visibleWidth(line) <= Math.max(1, width - 1)), `${label} ${JSON.stringify(lines.map(stripAnsi))}`);
    assert.ok(lines.every(line => !line.includes('\x07') && !line.includes('\x1b]')), label);
    if (mode !== 'truecolor') assert.ok(lines.every(line => !line.includes('\x1b')), label);
    if (mode === 'ascii') assert.ok(lines.every(printableAscii), label);
    // The return hint is never cut off.
    if (width >= 40) assert.match(stripAnsi(lines.at(-1)), /Q \/ ESC EXIT|HOLD O 1S/, label);
  }
  assert.match(plain(renderLab(hostile.state, mono)), /controller\?\? \?\?\?/);
});
test('L3 layout: full drawing when it fits, compact otherwise', () => {
  const { state, press } = pad('playstation'); press('south');
  assert.match(plain(renderLab(state, caps({ color: 0, width: 80, height: 24 }))), /╭─────╮/);
  const compact = plain(renderLab(state, caps({ color: 0, width: 60, height: 24 })));
  assert.doesNotMatch(compact, /╭─────╮/); assert.match(compact, /FACE \[X\] O  SQ  TRI/);
  assert.doesNotMatch(plain(renderLab(state, caps({ color: 0, width: 80, height: 18 }))), /╭─────╮/, 'short terminals use the compact layout');
  assert.doesNotMatch(plain(renderLab(state, caps({ color: 0, width: 30, height: 24 }))), /╭─ CONTROLLER/, 'no frame under 40 columns');
  assert.equal(labBody.width, 60);
});
test('L4 lab snapshots', () => {
  const idle = pad('playstation');
  const busy = pad('xbox'); for (const b of ['south', 'dpad_left', 'left_shoulder', 'right_stick']) busy.press(b);
  Object.assign(busy.device.axes, { leftx: -1, lefty: 1, rightx: 0.5, right_trigger: 0.7 });
  for (const [mode, c] of Object.entries({ truecolor, mono, ascii })) {
    snapshot(`lab/lab-${mode}-playstation-idle-90x34.txt`, renderLab(idle.state, c));
    snapshot(`lab/lab-${mode}-xbox-inputs-90x34.txt`, renderLab(busy.state, c));
    snapshot(`lab/lab-${mode}-xbox-inputs-60x24.txt`, renderLab(busy.state, { ...c, width: 60, height: 24 }));
  }
  const waiting = createState(); waiting.ready = true; waiting.source = 'demo'; waiting.back = 'press';
  snapshot('lab/lab-mono-demo-waiting-80x24.txt', renderLab(waiting, { ...mono, width: 80, height: 24 }));
});
