import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBanner, renderMessage, renderMenu, selectLine, askHint, askPrompt } from '../dist/prompt-view.js';
import { stripAnsi, visibleWidth } from '../dist/tui/index.js';
import { snapshot } from './snapshot.mjs';

const caps = (over = {}) => ({ color: 24, unicode: true, motion: false, width: 80, height: 24, ...over });
const truecolor = caps(), mono = caps({ color: 0 }), ascii = caps({ color: 0, unicode: false });
const printableAscii = text => /^[\x20-\x7e]*$/.test(text);
const plain = lines => lines.map(stripAnsi).join('\n');

test('C1 banners: frame, stepper, narrow fallback and modes', () => {
  assert.deepEqual(renderBanner('MISSION 02 / INPUT CHECK', mono, 48, [2, 6]), ['',
    '╭─ PADCODE ────────────────────────────────────╮',
    '│  MISSION 02 / INPUT CHECK        ●●○○○○ 2/6  │',
    '╰──────────────────────────────────────────────╯']);
  assert.match(plain(renderBanner('MISSION 06 / SAVE POINT', mono, 60, [6, 6])), /●●●●●● 6\/6/);
  assert.match(plain(renderBanner('MISSION 01 / LINK', ascii, 60, [1, 5])), /#---- 1\/5/);
  assert.doesNotMatch(plain(renderBanner('VOICE SETTINGS', mono, 60)), /[●○]/);
  // Narrow: the title keeps its row and the steps move below it.
  const narrow = plain(renderBanner('MISSION 01 / LINK CONTROLLER', ascii, 40, [1, 6])).split('\n');
  assert.equal(narrow.length, 5); assert.match(narrow[2], /MISSION 01 \/ LINK CONTROLLER/); assert.match(narrow[3], /#----- 1\/6/);
  assert.match(plain(renderBanner('X'.repeat(200), mono, 40)), /…/);
  for (const c of [truecolor, mono, ascii]) for (const width of [12, 20, 40, 72]) for (const progress of [undefined, [3, 6]]) {
    const lines = renderBanner('MISSION 03 / CHOOSE YOUR AGENT', c, width, progress);
    assert.ok(lines.every(line => visibleWidth(line) === (line ? width : 0)), `${width}`);
    if (c === ascii) assert.ok(lines.every(printableAscii));
    if (!c.color) assert.ok(lines.every(line => !line.includes('\x1b')));
  }
  // The title is one contiguous span in colour, so searches for it still match.
  assert.ok(renderBanner('MISSION 05 / VOICE (optional)', truecolor, 72, [5, 6]).join('').includes('MISSION 05 / VOICE (optional)'));
});
test('C2 messages: kinds, tags, wrapping, meter and Unicode', () => {
  const one = (text, c = mono, width = 72) => plain(renderMessage(text, c, width));
  assert.equal(one('INPUT CHECK PASSED / south'), '  ● INPUT CHECK PASSED / south');
  assert.equal(one('SAVE COMPLETE'), '  ● SAVE COMPLETE');
  assert.equal(one('Bluetooth connected. Next.'), '  ● Bluetooth connected. Next.');
  assert.equal(one('LINK NOT READY: boom'), '  ✕ LINK NOT READY: boom');
  assert.equal(one('TRY FAILED: cancelled'), '  ✕ TRY FAILED: cancelled');
  assert.equal(one('SETUP STOPPED: x'), '  ✕ SETUP STOPPED: x');
  assert.equal(one('Input remains UNVERIFIED.'), '  ▲ Input remains UNVERIFIED.');
  assert.equal(one('NOTE     Bluetooth headsets'), '  ▲ NOTE     Bluetooth headsets');
  assert.equal(one('PAIRING...'), '  ◆ PAIRING...');
  assert.equal(one('MIC STARTING...'), '  ◆ MIC STARTING...');
  assert.equal(one('PRIVACY  Audio stays here.'), '  PRIVACY  Audio stays here.');
  assert.equal(one('VOICE   off'), '  VOICE   off');
  assert.equal(one('Plain sentence.'), '  Plain sentence.');
  assert.equal(one('DISPLAY / Controls pane (3.4).'), '  DISPLAY / Controls pane (3.4).');
  assert.deepEqual(renderMessage('', truecolor, 72), ['']);
  assert.equal(one('A', ascii), '  A'); assert.equal(one('SAVE COMPLETE', ascii), '  * SAVE COMPLETE');
  assert.equal(one('DOWNLOAD 50%  (Ctrl+C cancels)', mono, 60), '  ◆ DOWNLOAD 50%  (Ctrl+C cancels)  ██████████░░░░░░░░░░');
  assert.match(one('DOWNLOAD 100%', ascii, 60), /#{20}$/);
  // Tag values wrap under the value column; other kinds wrap under the text.
  assert.deepEqual(plain(renderMessage('PRIVACY  one two three four five six', mono, 24)).split('\n'), ['  PRIVACY  one two three', '           four five six']);
  assert.deepEqual(plain(renderMessage('SCANNING... one two three four', mono, 20)).split('\n'), ['  ◆ SCANNING... one', '    two three four']);
  // Phrases tests and users search for stay contiguous in colour.
  for (const text of ['PRIVACY  Audio stays on this Mac in a private temporary folder.', 'DISPLAY / Controls pane (3.4). OPTIONS opens resume.', 'SELF-TEST PASSED in 0.4s.'])
    for (const phrase of text.split(/  /).filter(Boolean)) assert.ok(renderMessage(text, truecolor, 72).join('').includes(phrase.trim()), phrase);
  const wide = 'HEARD  한국어 カタカナ 🎮 '.repeat(5);
  for (const c of [truecolor, mono, ascii]) for (const width of [12, 20, 40, 72]) for (const text of [wide, 'TRANSCRIPTION NOT READY: ' + 'x'.repeat(100), 'Plain text '.repeat(20), 'DOWNLOAD 30%']) {
    const lines = renderMessage(text, c, width);
    assert.ok(lines.every(line => visibleWidth(line) <= Math.max(width, 12)), `${width} ${JSON.stringify(lines.map(stripAnsi))}`);
    if (!c.color) assert.ok(lines.every(line => !line.includes('\x1b')));
  }
  assert.match(plain(renderMessage(wide, mono, 40)), /한국어 カタカナ 🎮/);
});
test('C3 menus: marker, detail split, status and select line', () => {
  const labels = ['Bluetooth / recommended', 'USB cable', 'Configure Bluetooth later'];
  assert.deepEqual(plain(renderMenu('Connection route', labels, 1, 'GAMEPAD READY / go', mono, 60)).split('\n'), [
    '  ◆ Connection route', '    1  Bluetooth / recommended', '  ▶ 2  USB cable', '    3  Configure Bluetooth later', '  ● GAMEPAD READY / go']);
  assert.match(plain(renderMenu('Q', labels, 0, 'GAMEPAD OFFLINE / x', mono, 60)), /▲ GAMEPAD OFFLINE/);
  assert.doesNotMatch(plain(renderMenu('Q', labels, 0, '', mono, 60)), /GAMEPAD/);
  assert.match(plain(renderMenu('Q', labels, 0, 'S', ascii, 60)), /^  \* Q\n  > 1  Bluetooth/);
  // Main part highlighted, detail dim; the label stays readable as one string once styles are removed.
  const coloured = renderMenu('Q', labels, 0, '', truecolor, 60)[1];
  assert.match(coloured, /\x1b\[1;38;2;0;215;255mBluetooth\x1b\[0m\x1b\[38;2;128;134;150m \/ recommended/);
  // Wrapped labels keep main/detail colours on every row and the hanging indent.
  const long = renderMenu('Q', ['Wireless Controller / aa:bb:cc:dd:ee:ff / connected / paired list'], 0, '', mono, 30).slice(1).map(stripAnsi);
  assert.deepEqual(long, ['  ▶ 1  Wireless Controller /', '       aa:bb:cc:dd:ee:ff /', '       connected / paired list']);
  const split = renderMenu('Q', ['Long main label that wraps / detail'], 0, '', truecolor, 24).slice(1);
  assert.match(split[1], /\x1b\[1;38;2;0;215;255mwraps\x1b\[0m\x1b\[38;2;128;134;150m \/ detail|wraps/);
  for (const c of [truecolor, mono, ascii]) for (const width of [12, 20, 40, 72]) {
    const lines = renderMenu('Select a device, or discover a new controller', ['Scan nearby / put the controller in pairing mode first', '한국어 パッド 🎮 / connected', 'x'.repeat(90)], 2, 'GAMEPAD MENUS / D-pad to navigate, or X to claim. O back/cancel. Keyboard available.', c, width);
    assert.ok(lines.every(line => visibleWidth(line) <= Math.max(width, 12)), `${width}`);
    if (c === ascii) assert.ok(lines.filter(line => !/[\u3040-\u30ff\uac00-\ud7af]|\p{Extended_Pictographic}/u.test(line)).every(printableAscii));
  }
  assert.equal(stripAnsi(selectLine(2, truecolor)), '  > Select [3] (q to cancel):');
  assert.ok(selectLine(0, truecolor).includes('Select [1]'));
  assert.deepEqual(askHint(mono, 72), ['  [KEYBOARD] Type text here; gamepad buttons do not enter text.']);
  assert.deepEqual(askHint(mono, 40), ['  [KEYBOARD] Type text here; gamepad', '             buttons do not enter text.']);
  for (const width of [12, 30, 60]) assert.ok(askHint(truecolor, width).every(line => visibleWidth(line) <= Math.max(width, 17)));
  assert.equal(askPrompt('Argument 1:', mono), '  > Argument 1: ');
});
test('UI-2 snapshots', () => {
  for (const [mode, c] of Object.entries({ truecolor, mono, ascii })) for (const width of [44, 72]) {
    const lines = [
      ...renderBanner('MISSION 01 / LINK CONTROLLER', c, width, [1, 6]),
      ...renderMessage('Checking Bluetooth. macOS may ask for Bluetooth permission for padcode-bluetooth.', c, width),
      ...renderMessage('PAIRING  PS4: hold SHARE + PS. PS5: hold CREATE + PS. Wait for the light to flash quickly.', c, width),
      ...renderMessage('SCANNING... keep pairing mode active (20-second scan).', c, width),
      ...renderMenu('Select a device, or discover a new controller', ['Scan nearby / put the controller in pairing mode first', 'Wireless Controller / aa:bb:cc:dd:ee:ff / connected', 'Use USB instead'], 1, 'GAMEPAD READY / D-pad up/down, X confirm, O back/cancel.', c, width),
      selectLine(1, c),
      ...renderMessage('INPUT CHECK PASSED / south', c, width),
      ...renderMessage('INPUT NOT VERIFIED: No input device matches the selected transport/device.', c, width),
      ...renderMessage('Input remains UNVERIFIED.', c, width),
      ...renderMessage('DOWNLOAD 40%  (Ctrl+C cancels)', c, width),
      ...askHint(c, width), askPrompt('Executable path or command (no arguments):', c),
      ...renderBanner('MISSION 06 / SAVE POINT', c, width, [6, 6]),
      ...renderMessage('LINK    BLUETOOTH / Wireless Controller', c, width),
      ...renderMessage('VOICE   off', c, width),
      ...renderMessage('SAVE COMPLETE', c, width),
    ];
    snapshot(`prompt/wizard-${mode}-${width}.txt`, lines);
  }
});
