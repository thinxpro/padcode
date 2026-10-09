import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPopup } from '../dist/popup-view.js';
import { renderPanel } from '../dist/panel.js';
import { renderControllerMap, mapWidth } from '../dist/controller-map.js';
import { stripAnsi, visibleWidth } from '../dist/tui/index.js';
import { snapshot } from './snapshot.mjs';

const caps = (over = {}) => ({ color: 24, unicode: true, motion: false, width: 46, height: 14, ...over });
const truecolor = caps(), mono = caps({ color: 0 }), ascii = caps({ color: 0, unicode: false });
const menu = { t: 'menu', title: 'PADCODE CONTROLS', items: ['Resume gamepad', 'Pause gamepad mapping', 'Scroll history', 'Controller map', 'End session...'], selected: 1, hint: 'X / Enter confirm   O / Esc close' };
const draft = { ...menu, title: 'VOICE DRAFT', items: ['Insert into the Agent', 'Discard'], selected: 0, body: '한국어 カタカナ 🎮 draft text '.repeat(3) };

test('S2 popup rows match the tmux height formula: title, rule, [body, blank], items, blank, hint', () => {
  for (const c of [truecolor, mono, ascii]) for (const rows of [8, 12, 20, 40]) {
    assert.equal(renderPopup(menu, c, rows).length, menu.items.length + 4, `menu ${rows}`);
    const lines = renderPopup(draft, c, rows), room = Math.max(1, rows - draft.items.length - 5);
    assert.ok(lines.length <= draft.items.length + 5 + room, `draft ${rows}`);
    assert.ok(lines.every(line => visibleWidth(line) <= c.width - 2));
    if (!c.color) assert.ok(lines.every(line => !line.includes('\x1b')));
  }
  const plain = renderPopup(menu, mono, 12).map(stripAnsi);
  assert.deepEqual(plain, ['PADCODE CONTROLS', '─'.repeat(44), '  1  Resume gamepad', '▶ 2  Pause gamepad mapping', '  3  Scroll history', '  4  Controller map', '  5  End session...', '', 'X / Enter confirm   O / Esc close']);
  assert.deepEqual(renderPopup(menu, ascii, 12).slice(1, 4), ['-'.repeat(44), '  1  Resume gamepad', '> 2  Pause gamepad mapping']);
  // The title and the current item are single spans in colour.
  const coloured = renderPopup(menu, truecolor, 12).join('\n');
  assert.ok(coloured.includes('PADCODE CONTROLS')); assert.ok(coloured.includes('▶ 2  Pause gamepad mapping'));
  // Chrome stays ASCII-safe: labels lose control characters, the draft body keeps its Unicode.
  assert.ok(!renderPopup({ ...menu, items: ['\x1b]0;evil\x07x'] , selected: 0 }, mono, 12).join('').includes('\x1b'));
  assert.match(renderPopup(draft, mono, 20).join('\n'), /한국어 カタカナ 🎮/);
  assert.match(renderPopup(draft, mono, 8).join('\n'), /more lines/);
  assert.match(stripAnsi(renderPopup({ ...menu, items: ['x'.repeat(80)], selected: 0 }, mono, 12)[2]), /…$/);
});
test('S3 map popup: title, map, blank, hint; long maps say how many lines are hidden', () => {
  const view = { t: 'menu', title: 'CONTROLLER MAP / DUALSHOCK 4', items: ['Back to menu'], selected: 0, hint: 'O / Esc back', map: { claude: true, voice: true, family: 'playstation' } };
  const wide = caps({ color: 0, width: mapWidth + 4 });
  const full = renderPopup(view, wide, 40);
  assert.equal(full.length, renderControllerMap(view.map, mapWidth + 2, wide).length + 3);
  assert.match(full.join('\n'), /╭─+╮[\s\S]*TOUCHPAD/);
  assert.match(renderPopup(view, wide, 9).join('\n'), /more lines/);
});
test('UI-4 snapshots', () => {
  for (const [mode, c] of Object.entries({ truecolor, mono, ascii })) {
    snapshot(`session/popup-${mode}.txt`, renderPopup(menu, c, 14));
    snapshot(`session/panel-${mode}.txt`, ['ACTIVE / Options to pause', 'PAUSED / Options to enable', 'DISCONNECTED / Reconnect then Options', 'MENU / Choose'].flatMap(status => renderPanel(status, { ...c, width: 100 }, 2)));
    snapshot(`session/map-${mode}.txt`, renderPopup({ t: 'menu', title: 'CONTROLLER MAP / XBOX WIRELESS CONTROLLER', items: ['Back'], selected: 0, hint: 'B / Esc back', map: { claude: true, voice: false, family: 'xbox' } }, { ...c, width: mapWidth + 4 }, 30));
  }
});
