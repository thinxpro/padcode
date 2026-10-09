import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHub } from '../dist/hub-view.js';
import { help } from '../dist/ui.js';
import { stripAnsi, visibleWidth } from '../dist/tui/index.js';
import { snapshot } from './snapshot.mjs';

const caps = (over = {}) => ({ color: 24, unicode: true, motion: false, width: 80, height: 24, ...over });
const modes = { truecolor: {}, mono: { color: 0 }, ascii: { color: 0, unicode: false } };
const items = [
  ['START AGENT SESSION', 'claude in padcode'], ['VOICE + MICROPHONE', 'change microphone or transcription'],
  ['CONTROLLER LAB', 'test live input / hold {back} to return'], ['EDIT CONFIGURATION', 'Bluetooth, agent and buttons'],
  ['ARCADE DEMO', 'preview with synthetic input'], ['EXIT', 'back to the shell'],
].map(([label, detail]) => ({ label, detail }));
const model = (over = {}) => ({
  version: '1.2.3', controller: { name: 'Wireless Controller', transport: 'bluetooth', verified: true }, agent: 'claude',
  voice: 'Studio Mic / macOS on-device speech (en) / hold L2', items, tip: 'TIP  In a session, {menu} opens the controls menu.', ...over,
});
const view = (over = {}) => ({ selected: 0, status: 'GAMEPAD READY / D-pad up/down, X confirm, O back/cancel.', flash: '', shine: undefined, caps: caps(), glyphs: { family: 'playstation' }, ...over });
const printableAscii = text => /^[\x20-\x7e]*$/.test(text);

test('Hub fits every terminal size and mode', () => {
  for (const [mode, over] of Object.entries(modes)) for (const width of [1, 20, 39, 40, 50, 60, 63, 80, 100, 160]) for (const height of [1, 8, 16, 20, 24, 30, 40]) {
    const lines = renderHub(model({ notice: 'SESSION OVER / Agent exited with status 0' }), view({ caps: caps({ ...over, width, height }) }));
    const label = `${mode} ${width}x${height}`;
    assert.ok(lines.length <= height, label);
    assert.ok(lines.every(line => visibleWidth(line) <= Math.max(1, width - 1)), label);
    if (mode !== 'truecolor') assert.ok(lines.every(line => !line.includes('\x1b')), label);
    if (mode === 'ascii') assert.ok(lines.every(printableAscii), label);
    // The menu and the live gamepad status are never cut.
    if (height >= 10 && width >= 20) { assert.ok(lines.some(line => line.includes('MENU 1/6')), label); assert.ok(lines.some(line => stripAnsi(line).includes('GAMEPAD READY')), label); }
  }
});
test('Hub layout picks the largest logo that fits', () => {
  const plain = (w, h, over = {}) => renderHub(model(), view({ caps: caps({ color: 0, width: w, height: h, ...over }) })).join('\n');
  assert.match(plain(80, 24), /██████╗/); assert.match(plain(80, 24), /PLAYER HUB/);
  assert.match(plain(80, 24, { unicode: false }), /\|  _ \\/);
  assert.match(plain(50, 24), /\|  _ \\/, 'ASCII logo when the block logo is too wide');
  assert.match(plain(80, 18), /P A D C O D E/, 'wordmark when short');
  assert.doesNotMatch(plain(39, 24), /╭/, 'no frames under 40 columns');
  assert.match(plain(100, 40), /TIP  In a session, OPTIONS opens the controls menu\./);
  // Content is centred in wide terminals.
  assert.match(plain(120, 40).split('\n')[0], /^ {20}╭─ PLAYER HUB/);
});
test('Hub states: selection, notices, unverified input, no agent, voice off, flash, hostile names', () => {
  const plain = (m, v = {}) => renderHub(model(m), view({ caps: caps({ color: 0, width: 90, height: 34 }), ...v })).join('\n');
  assert.match(plain({}, { selected: 2 }), /MENU 3\/6[\s\S]*▶ 3  CONTROLLER LAB +test live input \/ hold O to return/);
  assert.match(plain({}, { glyphs: { family: 'xbox' } }), /\[A\] SELECT {3}\[B\] EXIT/);
  assert.match(plain({ notice: 'SESSION FAILED / boom' }), /✕ SESSION FAILED \/ boom/);
  assert.match(plain({ notice: 'LAUNCH CANCELLED / Back at Player Hub.' }), /▲ LAUNCH CANCELLED/);
  assert.match(plain({ notice: 'VOICE OFF' }), /◆ VOICE OFF/);
  assert.match(plain({ controller: { transport: 'usb', verified: false } }), /▲ PLAYER 1 {2}not selected · USB[\s\S]*▲ INPUT {5}UNVERIFIED/);
  assert.match(plain({ agent: undefined, voice: undefined }), /▲ AGENT {5}not selected[\s\S]*○ VOICE {5}off/);
  assert.match(plain({}, { flash: 'Choose 1-6.' }), /Choose 1-6\./);
  assert.match(plain({}, { status: 'GAMEPAD OFFLINE / Connect a controller.' }), /▲ GAMEPAD OFFLINE/);
  const hostile = plain({ controller: { name: '\x1b]52;c;x\x07한국어 パッド 🎮'.repeat(4), transport: 'bluetooth', verified: true }, notice: 'SESSION FAILED / \x1b[2Jbad' });
  assert.ok(!hostile.includes('\x1b') && !hostile.includes('\x07')); assert.match(hostile, /한국어 パッ/); assert.match(hostile, /…/);
  assert.ok(hostile.split('\n').every(line => visibleWidth(line) <= 89));
});
test('Hub sweep changes colours only', () => {
  const still = renderHub(model(), view()), lit = renderHub(model(), view({ shine: 0.5 }));
  assert.notDeepEqual(lit, still); assert.deepEqual(lit.map(stripAnsi), still.map(stripAnsi));
});
test('Hub snapshots', () => {
  for (const [mode, over] of Object.entries(modes)) for (const [width, height] of [[40, 24], [60, 24], [80, 24], [80, 30], [100, 40], [120, 40]]) {
    snapshot(`hub/hub-${mode}-${width}x${height}.txt`, renderHub(model({ notice: 'SESSION OVER / Agent exited with status 0' }), view({ caps: caps({ ...over, width, height }), selected: 1 })));
  }
});
test('help: piped ASCII, colour and snapshots', () => {
  const piped = help(caps({ color: 0, unicode: false }));
  assert.ok(printableAscii(piped.replaceAll('\n', '')));
  for (const command of ['padcode config', 'padcode run', 'padcode controllers --json', 'padcode demo', '--version', 'PADCODE_ASCII=1', 'PADCODE_NO_ANIM=1', 'NO_COLOR']) assert.ok(piped.includes(command), command);
  assert.ok(help(caps()).includes('\x1b')); assert.match(stripAnsi(help(caps())), /██████╗/);
  for (const width of [20, 40, 80, 120]) for (const [mode, over] of Object.entries(modes)) {
    const text = help(caps({ ...over, width }));
    assert.ok(text.split('\n').every(line => visibleWidth(line) <= Math.max(20, Math.min(width - 1, 80)) + 2), `${mode} ${width}`);
    if (width === 80) snapshot(`help/help-${mode}-80.txt`, text.split('\n'));
  }
});
