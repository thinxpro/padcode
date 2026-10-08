import test from 'node:test';
import assert from 'node:assert/strict';
import { renderControllerMap, mapWidth } from '../dist/controller-map.js';
import { SessionControls } from '../dist/session-controls.js';
import { parseToMenu } from '../dist/session-ipc.js';
import { displayWidth } from '../dist/text-width.js';

const plain = line => line.replace(/\x1b\[[0-9;]*m/g, '');
test('A1 controller map: every control, both profiles, voice states, widths and plain output', () => {
  for (const claude of [true, false]) for (const voice of [true, false]) for (const width of [mapWidth, 100, 60, 34]) {
    const lines = renderControllerMap({ claude, voice }, width, false), text = lines.join('\n');
    for (const line of lines) { assert.ok(displayWidth(line) <= width, `${width}: ${line}`); assert.ok(/^[\x20-\x7e]*$/.test(line), 'non-ASCII in the drawing'); }
    for (const key of ['L2', 'L1', 'R1', 'R2', 'D-PAD', 'L STICK', 'L3', 'R STICK', 'R3', '(X)', '(O)', '(SQ)', '(TRI)', 'OPTIONS', 'CTRL+]']) assert.ok(text.includes(key), `${key} missing at ${width}`);
    assert.match(text, claude ? /New line \(no send\)/ : /Unused \(Claude Code only\)/);
    assert.match(text, voice ? /Hold to dictate/ : /Voice off/);
    if (width >= mapWidth) assert.match(text, /TOUCHPAD/); else assert.doesNotMatch(text, /TOUCHPAD/);
    const colored = renderControllerMap({ claude, voice }, width, true);
    assert.deepEqual(colored.map(plain), lines); assert.ok(colored.some(line => line.includes('\x1b[1;96m')));
  }
  // The frame closes: every drawn controller row has the same length.
  const frame = renderControllerMap({ claude: true, voice: true }, mapWidth, false).slice(3, 9);
  assert.equal(new Set(frame.map(line => line.length)).size, 1, frame.join('\n'));
});

test('A2 map context: open from the menu, O back to the map item, X/Options close, keyboard picks', () => {
  const calls = []; let handler;
  const controls = new SessionControls({
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' / ')[0]}`); }, release: r => { handler = undefined; calls.push(`release:${r}`); },
    interrupt() {}, history() {}, end() {}, showMenu: view => calls.push(view ? `menu:${view.title}:${view.selected}:${JSON.stringify(view.map ?? null)}` : 'menu:close'),
    mapProfile: () => ({ claude: true, voice: false }),
  });
  controls.openMenu(); for (let i = 0; i < 5; i++) handler('dpad_down'); calls.length = 0; handler('south');
  assert.equal(controls.context, 'map'); assert.deepEqual(calls, ['capture:CONTROLLER MAP', 'menu:CONTROLLER MAP / DUALSHOCK 4:0:{"claude":true,"voice":false}']);
  for (const button of ['dpad_left', 'dpad_right', 'west', 'north', 'left_shoulder']) handler(button);
  assert.equal(controls.context, 'map');
  handler('east'); assert.equal(controls.context, 'menu'); assert.match(calls.at(-1), /^menu:PADCODE CONTROLS:5:/);
  handler('south'); handler('south'); assert.equal(controls.context, 'agent'); assert.deepEqual(calls.slice(-2), ['menu:close', 'release:true']);
  controls.openMenu(); controls.key('confirm', 5); assert.equal(controls.context, 'map'); handler('start'); assert.equal(controls.context, 'agent');
  controls.openMenu(); controls.key('confirm', 5); controls.key('back'); assert.equal(controls.context, 'menu'); controls.key('back'); assert.equal(controls.context, 'agent');
});

test('A2 map view IPC: flags are validated and cannot be combined with a body', () => {
  const base = { t: 'menu', title: 'CONTROLLER MAP', items: ['Back to menu'], selected: 0, hint: 'x' };
  assert.deepEqual(parseToMenu(JSON.stringify({ ...base, map: { claude: true, voice: false } })).map, { claude: true, voice: false });
  for (const map of [{ claude: 'yes', voice: false }, { claude: true }, { claude: true, voice: true, extra: 1 }, [true, false]]) assert.throws(() => parseToMenu(JSON.stringify({ ...base, map })));
  assert.throws(() => parseToMenu(JSON.stringify({ ...base, map: { claude: true, voice: true }, body: 'x' })));
});

test('the full controls menu (all voice actions) fits one validated popup message', () => {
  const controls = new SessionControls({ capture() {}, release() {}, interrupt() {}, history() {}, end() {}, showMenu: view => { seen = view; },
    hasRecording: () => true, canUndo: () => true });
  let seen; controls.openDraft('x'); controls.key('back'); controls.openMenu();
  assert.equal(seen.items.length, 11, seen.items.join(' | '));
  assert.deepEqual(parseToMenu(JSON.stringify({ t: 'menu', ...seen })).items, seen.items);
});

