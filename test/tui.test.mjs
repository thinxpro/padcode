import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './snapshot.mjs';
import { EventEmitter } from 'node:events';
import {
  detectCaps, sgr, paint, gradient, stripAnsi, visibleWidth, truncate, padEnd, padStart, center, fit, wrapAnsi,
  frame, rule, DIVIDER, keycap, dot, stepper, meter, hintBar, columns, Screen, logo, logoArt, logoVariant,
} from '../dist/tui/index.js';
import { renderGallery } from '../dist/tui/gallery.js';

const tty = { isTTY: true, columns: 100, rows: 30 };
const caps = (over = {}) => ({ color: 24, unicode: true, motion: false, width: 80, height: 24, ...over });
const truecolor = caps(), mono = caps({ color: 0 }), ascii = caps({ color: 0, unicode: false });
const printableAscii = text => /^[\x20-\x7e]*$/.test(text);
// Korean, kana and emoji: wide characters without Chinese fixtures (repository rule).
const wide = '한국어 カタカナ 🎮';

test('capabilities: colour depth', () => {
  assert.equal(detectCaps({ TERM: 'xterm' }, tty).color, 16);
  assert.equal(detectCaps({ TERM: 'xterm-256color' }, tty).color, 256);
  assert.equal(detectCaps({ TERM: 'xterm-256color', COLORTERM: 'truecolor' }, tty).color, 24);
  assert.equal(detectCaps({ COLORTERM: '24bit' }, tty).color, 24);
  for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }, { FORCE_COLOR: '0', COLORTERM: 'truecolor' }]) assert.equal(detectCaps(env, tty).color, 0, JSON.stringify(env));
  assert.equal(detectCaps({ COLORTERM: 'truecolor' }, { isTTY: false }).color, 0);
});
test('capabilities: Unicode, motion and size', () => {
  assert.equal(detectCaps({}, tty).unicode, true);
  assert.equal(detectCaps({ LANG: 'en_US.UTF-8' }, tty).unicode, true);
  assert.equal(detectCaps({ LANG: 'ko_KR.utf8' }, tty).unicode, true);
  assert.equal(detectCaps({ LANG: 'C' }, tty).unicode, false);
  assert.equal(detectCaps({ LANG: 'en_US.UTF-8', LC_ALL: 'C' }, tty).unicode, false, 'LC_ALL wins');
  assert.equal(detectCaps({ LANG: 'C', LC_CTYPE: 'UTF-8' }, tty).unicode, true, 'LC_CTYPE beats LANG');
  assert.equal(detectCaps({ PADCODE_ASCII: '1' }, tty).unicode, false);
  assert.equal(detectCaps({ PADCODE_ASCII: '0' }, tty).unicode, true);
  for (const TERM of ['dumb', 'linux']) assert.equal(detectCaps({ TERM }, tty).unicode, false, TERM);
  assert.equal(detectCaps({}, tty).motion, true);
  for (const env of [{ CI: 'true' }, { PADCODE_NO_ANIM: '1' }, { NO_COLOR: '' }]) assert.equal(detectCaps(env, tty).motion, false, JSON.stringify(env));
  assert.equal(detectCaps({}, { isTTY: false }).motion, false);
  assert.deepEqual([detectCaps({}, tty).width, detectCaps({}, tty).height], [100, 30]);
  assert.deepEqual([detectCaps({}, {}).width, detectCaps({}, { columns: 0, rows: 0 }).height], [80, 24]);
});
test('theme: tones at every colour depth', () => {
  for (const tone of ['brand', 'accent', 'ok', 'warn', 'danger', 'info', 'text', 'muted']) {
    assert.match(sgr(caps({ color: 24 }), { tone }), /^\x1b\[38;2;\d+;\d+;\d+m$/, tone);
    assert.match(sgr(caps({ color: 256 }), { tone }), /^\x1b\[38;5;\d+m$/, tone);
    assert.match(sgr(caps({ color: 16 }), { tone }), /^\x1b\[(3|9)\dm$/, tone);
    assert.equal(sgr(mono, { tone, bold: true }), '', tone);
  }
  assert.equal(sgr(caps({ color: 16 }), { tone: 'brand', bold: true, dim: true, inverse: true }), '\x1b[1;2;7;96m');
  assert.equal(sgr(truecolor, {}), '');
  assert.equal(paint(truecolor, 'hi', { tone: 'ok' }), '\x1b[38;2;95;215;135mhi\x1b[0m');
  assert.equal(paint(truecolor, '', { tone: 'ok' }), '');
  assert.equal(paint(mono, 'hi', { tone: 'ok' }), 'hi');
});
test('theme: gradient per depth keeps the visible text', () => {
  const text = 'PADCODE  SWEEP';
  for (const color of [24, 256, 16, 0]) assert.equal(stripAnsi(gradient(caps({ color }), text)), text, String(color));
  const colours = depth => new Set(gradient(caps({ color: depth }), text).match(/\x1b\[[0-9;]*m/g)).size;
  assert.ok(colours(24) > 4); assert.ok(colours(256) > 2);
  assert.equal(gradient(caps({ color: 16 }), text), '\x1b[1;96mPADCODE  SWEEP\x1b[0m');
  assert.equal(gradient(mono, text), text);
  assert.equal(gradient(truecolor, ''), '');
  assert.notEqual(gradient(truecolor, text, { offset: 0 }), gradient(truecolor, text, { offset: 0.5 }), 'offset moves the sweep');
  assert.equal(gradient(truecolor, text, { offset: 0 }), gradient(truecolor, text, { offset: 1 }), 'sweep wraps');
});
test('text: widths ignore ANSI and count wide characters', () => {
  assert.equal(stripAnsi('\x1b[1;96mA\x1b[0m\x1b]8;;http://x\x07B\x1b]8;;\x1b\\'), 'AB');
  assert.equal(visibleWidth(paint(truecolor, 'ABC', { tone: 'brand' })), 3);
  assert.equal(visibleWidth(wide), 3 * 2 + 1 + 4 * 2 + 1 + 2);
  assert.equal(visibleWidth('╭─●▲○✕◆█▌░'), 10, 'chrome glyphs are one column');
});
test('text: truncate, pad, centre and fit', () => {
  for (let width = 0; width <= 20; width++) {
    const cut = truncate(wide, width, '…');
    assert.ok(visibleWidth(cut) <= width, `${width}`);
    assert.ok(!cut.includes('�'));
    assert.equal(visibleWidth(fit(wide, width, '…')), width, `fit ${width}`);
  }
  assert.equal(truncate('한국', 3), '한');
  assert.equal(truncate('abcdef', 4, '…'), 'abc…');
  assert.equal(truncate('abc', 3, '…'), 'abc');
  assert.equal(truncate('abcdef', 0, '…'), '');
  const styled = truncate(paint(truecolor, 'abcdef', { tone: 'ok' }), 3);
  assert.equal(stripAnsi(styled), 'abc'); assert.ok(styled.endsWith('\x1b[0m'));
  assert.equal(truncate('abcdef', 3), 'abc');
  assert.equal(padEnd('한', 4), '한  '); assert.equal(padStart('한', 4), '  한'); assert.equal(padEnd('abcdef', 2), 'abcdef');
  assert.equal(center('ab', 7), '  ab   '); assert.equal(center('abc', 2), 'abc');
});
test('text: wrapAnsi respects width', () => {
  assert.deepEqual(wrapAnsi('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapAnsi('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapAnsi('a\n\nb', 5), ['a', '', 'b']);
  assert.deepEqual(wrapAnsi('', 5), ['']);
  for (const width of [1, 2, 3, 5, 8, 13]) for (const text of [wide, 'The quick brown fox jumps over the lazy dog', paint(truecolor, 'styled words wrap too', { tone: 'ok' })]) {
    const lines = wrapAnsi(text, width);
    assert.ok(lines.every(line => visibleWidth(line) <= Math.max(width, 2)), `${width} ${JSON.stringify(lines)}`);
    assert.equal(lines.map(stripAnsi).join('').replace(/ /g, ''), stripAnsi(text).replace(/ /g, ''), 'no characters lost');
  }
});
test('frames: exact width, titles, dividers, wide and overlong rows', () => {
  for (const c of [truecolor, mono, ascii]) for (let width = 0; width <= 120; width++) {
    // Callers style their own rows; the ASCII check skips the row of Unicode user data.
    const rows = ['short', DIVIDER, c === ascii ? 'x' : wide, 'x'.repeat(200), paint(c, 'styled', { tone: 'ok' })];
    const lines = frame(rows, { width, caps: c, title: 'A VERY LONG FRAME TITLE THAT WILL BE CUT', padding: 2 });
    assert.equal(lines.length, rows.length + 2);
    for (const line of lines) assert.equal(visibleWidth(line), Math.max(4, width), `${width} ${JSON.stringify(line)}`);
    if (c === ascii) assert.ok(lines.every(printableAscii), `ascii ${width}`);
    if (!c.color) assert.ok(lines.every(line => !line.includes('\x1b')), `mono ${width}`);
  }
  const box = frame(['hi'], { width: 12, caps: mono, title: 'T' });
  assert.deepEqual(box, ['╭─ T ──────╮', '│ hi       │', '╰──────────╯']);
  assert.deepEqual(frame([DIVIDER], { width: 6, caps: ascii, border: 'heavy' }), ['+----+', '+----+', '+----+']);
  assert.equal(frame(['x'], { width: 8, caps: mono, border: 'heavy' })[0], '┏━━━━━━┓');
});
test('frames: rules', () => {
  for (const c of [truecolor, mono, ascii]) for (let width = 0; width <= 60; width++) {
    assert.equal(visibleWidth(rule(width, c, 'SECTION LABEL')), width, `${width}`);
    assert.equal(visibleWidth(rule(width, c)), width);
  }
  assert.equal(rule(14, mono, 'TONES'), '── TONES ─────');
  assert.equal(rule(14, ascii, 'TONES'), '-- TONES -----');
});
test('widgets: key caps, dots and steppers', () => {
  assert.equal(keycap('X', mono), '[X]');
  assert.equal(stripAnsi(keycap('X', truecolor)), ' X ');
  assert.match(keycap('X', truecolor), /\x1b\[1;7;38;2;/);
  for (const state of ['ok', 'warn', 'off', 'error', 'active']) {
    assert.equal(visibleWidth(dot(state, truecolor)), 1);
    assert.ok(printableAscii(dot(state, ascii)), state);
  }
  assert.deepEqual(['ok', 'warn', 'off', 'error', 'active'].map(s => dot(s, mono)).join(''), '●▲○✕◆');
  assert.equal(stepper(2, 5, mono), '●●○○○');
  assert.equal(stepper(9, 3, ascii), '###');
  assert.equal(stepper(-1, 2, ascii), '--');
  assert.equal(stepper(0, 0, mono), '');
});
test('widgets: meters clamp and keep their width', () => {
  for (const c of [truecolor, mono, ascii]) for (const value of [-1, 0, 0.01, 0.33, 0.5, 0.875, 0.999, 1, 2, NaN, Infinity]) for (const width of [0, 1, 7, 12]) {
    const bar = meter(value, width, c);
    assert.equal(visibleWidth(bar), width, `${value} ${width}`);
    if (c === ascii) assert.ok(printableAscii(bar));
  }
  assert.equal(meter(0, 4, mono), '░░░░'); assert.equal(meter(1, 4, mono), '████'); assert.equal(meter(0.5, 3, mono), '█▌░');
  assert.equal(meter(NaN, 3, ascii), '...'); assert.equal(meter(2, 3, ascii), '###');
});
test('widgets: hint bar fits by priority', () => {
  const items = [['X', 'SELECT'], ['O', 'BACK'], ['D-PAD', 'MOVE'], ['Q', 'QUIT']];
  assert.equal(hintBar(items, 200, mono), '[X] SELECT   [O] BACK   [D-PAD] MOVE   [Q] QUIT');
  assert.equal(hintBar(items, 24, mono), '[X] SELECT   [O] BACK');
  assert.equal(hintBar(items, 5, mono), '');
  for (let width = 0; width <= 80; width++) for (const c of [truecolor, mono]) assert.ok(visibleWidth(hintBar(items, width, c)) <= width);
});
test('widgets: columns side by side or stacked', () => {
  assert.deepEqual(columns(['ab', 'a'], ['1', '2', '3'], 20, 2), ['ab  1', 'a   2', '    3']);
  assert.deepEqual(columns(['abc'], ['123'], 5), ['abc', '', '123']);
  assert.deepEqual(columns([], ['1'], 1), ['1']);
  assert.deepEqual(columns([wide], ['z'], 30, 1), [`${wide} z`]);
});

class FakeOut { constructor(isTTY) { this.isTTY = isTTY; this.data = ''; } write(chunk) { this.data += chunk; return true; } }
test('screen: alternate screen lifecycle on a TTY', () => {
  const out = new FakeOut(true), hooks = new EventEmitter(), screen = new Screen(out, hooks);
  assert.equal(screen.tty, true);
  screen.enter(); screen.enter();
  assert.equal(out.data, '\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
  assert.equal(hooks.listenerCount('exit'), 1);
  out.data = ''; screen.draw(['one', 'two']);
  assert.equal(out.data, '\x1b[Hone\x1b[0m\x1b[K\r\ntwo\x1b[0m\x1b[K\x1b[J');
  out.data = ''; screen.leave(); screen.leave();
  assert.equal(out.data, '\x1b[0m\x1b[?25h\x1b[?1049l');
  assert.equal(hooks.listenerCount('exit'), 0);
});
test('screen: process exit restores the terminal once', () => {
  const out = new FakeOut(true), hooks = new EventEmitter(), screen = new Screen(out, hooks);
  screen.enter(); out.data = '';
  hooks.emit('exit');
  assert.equal(out.data, '\x1b[0m\x1b[?25h\x1b[?1049l');
  screen.leave(); hooks.emit('exit');
  assert.equal(out.data, '\x1b[0m\x1b[?25h\x1b[?1049l');
});
test('screen: non-TTY output has no control sequences', () => {
  const out = new FakeOut(false), hooks = new EventEmitter(), screen = new Screen(out, hooks);
  screen.enter(); screen.draw(['one', 'two']); screen.leave();
  assert.equal(out.data, 'one\ntwo\n');
  assert.equal(hooks.listenerCount('exit'), 0);
});

test('theme: shine band brightens only near its position', () => {
  const text = 'X'.repeat(60), colours = out => out.match(/\x1b\[[0-9;]*m(?=X)/g) ?? [];
  const base = gradient(truecolor, text);
  for (const shine of [0, 0.25, 0.5, 1]) assert.equal(stripAnsi(gradient(truecolor, text, { shine })), text);
  // At 0 and 1 the band sits fully outside the text.
  assert.equal(gradient(truecolor, text, { shine: 0 }), base); assert.equal(gradient(truecolor, text, { shine: 1 }), base);
  const mid = gradient(truecolor, text, { shine: 0.5 });
  const rgb = code => code.match(/38;2;(\d+);(\d+);(\d+)/).slice(1).map(Number);
  const sum = code => rgb(code).reduce((a, b) => a + b, 0);
  const plain = [...base.matchAll(/(\x1b\[[0-9;]*m)?X/g)].map(m => m[1]), lit = [...mid.matchAll(/(\x1b\[[0-9;]*m)?X/g)].map(m => m[1]);
  let current = plain[0], glow = lit[0]; const brighter = [];
  plain.forEach((code, i) => { current = code ?? current; glow = lit[i] ?? glow; brighter.push(sum(glow) > sum(current)); });
  assert.ok(brighter[30], 'centre is brighter'); assert.ok(!brighter[0] && !brighter[59], 'edges unchanged');
  assert.ok(colours(mid).length > 0);
  const sixteen = gradient(caps({ color: 16 }), text, { shine: 0.5 });
  assert.match(sixteen, /\x1b\[1;97mX/); assert.match(sixteen, /^\x1b\[1;96mX/);
  assert.equal(gradient(mono, text, { shine: 0.5 }), text);
  assert.equal(stripAnsi(gradient(caps({ color: 256 }), text, { shine: 0.4, bold: false })), text);
});
test('logo variants', () => {
  for (const [variant, lines] of Object.entries(logoArt)) assert.equal(new Set(lines.map(visibleWidth)).size, 1, variant);
  assert.equal(visibleWidth(logoArt.full[0]), 57); assert.equal(visibleWidth(logoArt.ascii[0]), 42); assert.equal(visibleWidth(logoArt.wordmark[0]), 13);
  assert.ok(logoArt.ascii.every(printableAscii));
  assert.equal(logoVariant(truecolor, 57), 'full'); assert.equal(logoVariant(truecolor, 56), 'ascii');
  assert.equal(logoVariant(ascii, 120), 'ascii'); assert.equal(logoVariant(truecolor, 41), 'wordmark'); assert.equal(logoVariant(ascii, 13), 'wordmark');
  assert.deepEqual(logo(mono, 'full'), [...logoArt.full]);
  for (const shine of [undefined, 0.3, 0.7]) assert.deepEqual(logo(truecolor, 'full', shine).map(stripAnsi), [...logoArt.full]);
  assert.notDeepEqual(logo(truecolor, 'full', 0.5), logo(truecolor, 'full'));
});

test('gallery snapshots at 40, 60, 80 and 120 columns', () => {
  for (const [mode, c] of [['truecolor', truecolor], ['mono', mono], ['ascii', ascii]]) for (const width of [40, 60, 80, 120]) {
    const lines = renderGallery({ ...c, width });
    assert.ok(lines.every(line => visibleWidth(line) < width), `${mode} ${width}`);
    // User data keeps its Unicode in ASCII mode; only the chrome must be ASCII.
    if (mode === 'ascii') assert.ok(lines.filter(line => !line.includes('Unicode data')).every(printableAscii), `${mode} ${width}`);
    if (mode !== 'truecolor') assert.ok(lines.every(line => !line.includes('\x1b')), `${mode} ${width}`);
    snapshot(`tui/gallery-${mode}-${width}.txt`, lines);
  }
});
