import test from 'node:test';
import assert from 'node:assert/strict';
import { renderControllerMap, mapWidth } from '../dist/controller-map.js';
import { SessionControls } from '../dist/session-controls.js';
import { parseToMenu } from '../dist/session-ipc.js';
import { displayWidth } from '../dist/text-width.js';

const asciiCaps = { color: 0, unicode: false, motion: false, width: 80, height: 24 }, color16 = { ...asciiCaps, color: 16 }, unicodeCaps = { ...asciiCaps, unicode: true };
const plain = line => line.replace(/\x1b\[[0-9;]*m/g, '');
// Expected R2/R3 and shoulder labels per profile; the narrow list keeps a generic Tab / Shift+Tab row.
const labels = {
  basic: { r2: 'Unused for this Agent', r3: 'Unused for this Agent', l1: 'Tab', r1: 'Shift+Tab' },
  claude: { r2: 'New line (no send)', r3: 'Undo', l1: 'Tab', r1: 'Shift+Tab (mode)' },
  codex: { r2: 'New line (no send)', r3: 'Transcript on/off', l1: 'Tab (queue message)', r1: 'Shift+Tab (collab mode)' },
};
test('A4 controller map: every control, all three profiles, voice states, widths and plain output', () => {
  for (const agent of ['basic', 'claude', 'codex']) for (const voice of [true, false]) for (const width of [mapWidth, 100, 60, 34]) {
    const lines = renderControllerMap({ agent, voice }, width, asciiCaps), text = lines.join('\n');
    for (const line of lines) { assert.ok(displayWidth(line) <= width, `${width}: ${line}`); assert.ok(/^[\x20-\x7e]*$/.test(line), 'non-ASCII in the drawing'); }
    for (const key of ['L2', 'L1', 'R1', 'R2', 'D-PAD', 'L STICK', 'L3', 'R STICK', 'R3', '(X)', '(O)', '(SQ)', '(TRI)', 'OPTIONS', 'CTRL+]']) assert.ok(text.includes(key), `${key} missing at ${width}`);
    const l = labels[agent], row = key => lines.find(line => line.startsWith(` ${key} `)) ?? '';
    if (width < mapWidth) { assert.ok(row('R2').includes(l.r2), row('R2')); assert.ok(row('R3').includes(l.r3), row('R3')); }
    else { const shoulders = lines.slice(0, 2).join('\n'); assert.ok(shoulders.includes(`[R2] ${l.r2}`) && shoulders.includes(`[L1] ${l.l1} `) && shoulders.endsWith(`[R1] ${l.r1}`), shoulders); }
    if (agent !== 'codex') assert.ok(!text.includes('Transcript') && !text.includes('collab'), agent);
    assert.match(text, voice ? /Hold to dictate/ : /Voice off/);
    if (width >= mapWidth) assert.match(text, /TOUCHPAD/); else assert.doesNotMatch(text, /TOUCHPAD/);
    const colored = renderControllerMap({ agent, voice }, width, color16);
    assert.deepEqual(colored.map(plain), lines); assert.ok(colored.some(line => line.includes('\x1b[1;96m')));
  }
  // The frame closes: every drawn controller row has the same length.
  const frame = renderControllerMap({ agent: 'claude', voice: true }, mapWidth, asciiCaps).slice(3, 9);
  assert.equal(new Set(frame.map(line => line.length)).size, 1, frame.join('\n'));
  // With Unicode the outline and inner boxes use rounded box drawing, on the same rows and columns.
  for (const family of ['playstation', 'xbox']) {
    const ascii = renderControllerMap({ agent: 'claude', voice: true, family }, mapWidth, asciiCaps), unicode = renderControllerMap({ agent: 'claude', voice: true, family }, mapWidth, unicodeCaps);
    assert.equal(unicode.length, ascii.length);
    const drawn = unicode.slice(2, unicode.findIndex(line => line.includes('L STICK  ')) + 1);
    assert.equal(new Set(drawn.map(displayWidth)).size, 1, drawn.join('\n'));
    assert.match(drawn[0], /^  ╭─+╮$/); assert.match(drawn.at(-1), /^  ╰─{13}╯  L STICK   ╰─{9}╯  R STICK   ╰─+╯$/);
    assert.ok(drawn.slice(1, -1).every(line => /^  │.*│$/.test(line)));
    assert.match(unicode.join('\n'), family === 'playstation' ? /╭─{18}╮[\s\S]*│ {5}TOUCHPAD {5}│[\s\S]*╰─{18}╯/ : /╭─{8}╮[\s\S]*│  HOME  │[\s\S]*╰─{8}╯/);
    assert.doesNotMatch(unicode.join('\n'), /\.-+\.|'-+'/);
    assert.deepEqual(unicode.slice(drawn.length + 2), ascii.slice(drawn.length + 2), 'legend unchanged');
  }
  // Theme colours: 256-colour sequences at depth 256, none without colour.
  assert.ok(renderControllerMap({ agent: 'claude', voice: true }, mapWidth, { ...unicodeCaps, color: 256 }).some(line => line.includes('\x1b[1;38;5;45m')));
});

test('the map picks the layout that fits the popup height, so nothing is cut off', () => {
  const profile = { agent: 'claude', voice: true };
  assert.equal(renderControllerMap(profile, mapWidth, asciiCaps).length, 16);
  assert.equal(renderControllerMap(profile, mapWidth, asciiCaps, 16).length, 16);
  const compact = renderControllerMap(profile, mapWidth, asciiCaps, 15);
  assert.equal(compact.length, 9); assert.ok(!compact.join('\n').includes('TOUCHPAD')); assert.ok(compact.join('\n').includes('Backspace'));
  assert.equal(renderControllerMap(profile, 60, asciiCaps, 30).length, 16);
  // Coordinator sizing (map lines + 5) gives the popup exactly the rows its layout needs, for any terminal height.
  // From 16 terminal rows the compact legend fits; smaller terminals show a "more lines" indicator instead.
  for (let rows = 16; rows <= 40; rows++) {
    const most = Math.max(8, rows - 2), lines = renderControllerMap(profile, mapWidth, asciiCaps, most - 5).length;
    const height = Math.min(most, lines + 5), available = height - 2 - 3;
    assert.equal(renderControllerMap(profile, mapWidth, asciiCaps, available).length, lines, `rows ${rows}`);
    assert.ok(lines <= available, `rows ${rows}: ${lines} lines in ${available}`);
  }
});

test('A2 map context: open from the menu, O back to the map item, X/Options close, keyboard picks', () => {
  const calls = []; let handler;
  const controls = new SessionControls({
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' / ')[0]}`); }, release: r => { handler = undefined; calls.push(`release:${r}`); },
    interrupt() {}, history() {}, end() {}, showMenu: view => calls.push(view ? `menu:${view.title}:${view.selected}:${JSON.stringify(view.map ?? null)}` : 'menu:close'),
    mapProfile: () => ({ agent: 'claude', voice: false }),
  });
  controls.openMenu(); for (let i = 0; i < 5; i++) handler('dpad_down'); calls.length = 0; handler('south');
  assert.equal(controls.context, 'map'); assert.deepEqual(calls, ['capture:CONTROLLER MAP', 'menu:CONTROLLER MAP / {padName}:0:{"agent":"claude","voice":false}']);
  for (const button of ['dpad_left', 'dpad_right', 'west', 'north', 'left_shoulder']) handler(button);
  assert.equal(controls.context, 'map');
  handler('east'); assert.equal(controls.context, 'menu'); assert.match(calls.at(-1), /^menu:PADCODE CONTROLS:5:/);
  handler('south'); handler('south'); assert.equal(controls.context, 'agent'); assert.deepEqual(calls.slice(-2), ['menu:close', 'release:true']);
  controls.openMenu(); controls.key('confirm', 5); assert.equal(controls.context, 'map'); handler('start'); assert.equal(controls.context, 'agent');
  controls.openMenu(); controls.key('confirm', 5); controls.key('back'); assert.equal(controls.context, 'menu'); controls.key('back'); assert.equal(controls.context, 'agent');
});

test('A2 map view IPC: flags are validated and cannot be combined with a body', () => {
  const base = { t: 'menu', title: 'CONTROLLER MAP', items: ['Back to menu'], selected: 0, hint: 'x' };
  for (const agent of ['basic', 'claude', 'codex']) assert.deepEqual(parseToMenu(JSON.stringify({ ...base, map: { agent, voice: false } })).map, { agent, voice: false });
  assert.deepEqual(parseToMenu(JSON.stringify({ ...base, map: { agent: 'codex', voice: true, family: 'xbox', swap: true } })).map, { agent: 'codex', voice: true, family: 'xbox', swap: true });
  for (const map of [{ agent: 'gemini', voice: false }, { agent: 'Codex', voice: false }, { agent: 1, voice: false }, { voice: false }, { claude: true, voice: false },
    { agent: 'codex' }, { agent: 'codex', voice: true, extra: 1 }, [true, false]]) assert.throws(() => parseToMenu(JSON.stringify({ ...base, map })), JSON.stringify(map));
  assert.throws(() => parseToMenu(JSON.stringify({ ...base, map: { agent: 'claude', voice: true }, body: 'x' })));
});

test('the full controls menu (all voice actions) fits one validated popup message', () => {
  const controls = new SessionControls({ capture() {}, release() {}, interrupt() {}, history() {}, end() {}, showMenu: view => { seen = view; },
    hasRecording: () => true, canUndo: () => true, commands: () => [{ label: '/  Browse all commands', keys: '/' }] });
  let seen; controls.openDraft('x'); controls.key('back'); controls.openMenu();
  assert.equal(seen.items.length, 12, seen.items.join(' | '));
  assert.deepEqual(parseToMenu(JSON.stringify({ t: 'menu', ...seen })).items, seen.items);
});

