import { glyph, type Family, type Glyphs, type Role } from './glyphs.js';
import { paint, type Caps, type Style } from './tui/index.js';
import type { AgentProfile } from './stick-input.js';

// Game-style controls screen. Names and actions are ASCII; the outline uses rounded box drawing with Unicode
// and the ASCII outline otherwise (PADCODE_ASCII=1 or a non-UTF-8 locale).
export interface MapProfile { agent: AgentProfile; voice: boolean; family?: Family; swap?: boolean }
type Segment = [kind: 'label' | 'art' | 'text' | 'dim', text: string];
const styles: Record<Segment[0], Style> = { label: { tone: 'brand', bold: true }, art: { tone: 'muted' }, text: { tone: 'text' }, dim: { tone: 'muted' } };
const pad = (text: string, width: number) => text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);

// Labels follow the keys each profile sends (stick-input.ts profileKeys) and the Agent's own meaning of Tab/Shift+Tab.
const agentActions: Record<AgentProfile, { l1: string; r1: string; r2: string; r3: string }> = {
  basic: { l1: 'Tab', r1: 'Shift+Tab', r2: 'Unused for this Agent', r3: 'Unused for this Agent' },
  claude: { l1: 'Tab', r1: 'Shift+Tab (mode)', r2: 'New line (no send)', r3: 'Undo' },
  codex: { l1: 'Tab (queue message)', r1: 'Shift+Tab (collab mode)', r2: 'New line (no send)', r3: 'Transcript on/off' },
};
function actions(profile: MapProfile) {
  return { ...agentActions[profile.agent], l2: profile.voice ? 'Hold to dictate' : 'Voice off (Hub > Voice settings)' };
}
// Drawings use the names printed on the buttons; the legend follows the confirm setting.
const printed = (profile: MapProfile): Glyphs => ({ family: profile.family ?? 'playstation' });
const active = (profile: MapProfile): Glyphs => ({ family: profile.family ?? 'playstation', swap: Boolean(profile.swap) });

const inner = 57;
// Each element sits at a fixed column, so the drawing stays aligned whatever the names.
type Place = [column: number, text: string];
const drawings: Record<'symmetric' | 'offset', Place[][]> = {
  // PlayStation: D-pad and face buttons on top, both sticks below, touchpad in the middle.
  symmetric: [
    [[4, '_'], [14, '{view}'], [38, '{menu}'], [48, '{north}']],
    [[2, '_| |_'], [19, '.------------------.'], [44, '{west}'], [52, '{east}']],
    [[1, '|_ + _|'], [19, '|     TOUCHPAD     |'], [48, '{south}']],
    [[3, '|_|'], [19, "'------------------'"]],
    [[2, 'D-PAD'], [14, '( {l3} )'], [38, '( {r3} )']],
  ],
  // Xbox, Nintendo and standard gamepads: left stick high, D-pad low, right stick low, face buttons high.
  offset: [
    [[3, '( {l3} )'], [18, '{view}'], [34, '{menu}'], [48, '{north}']],
    [[22, '.--------.'], [44, '{west}'], [52, '{east}']],
    [[6, '_'], [22, '|  HOME  |'], [48, '{south}']],
    [[4, '_| |_'], [22, "'--------'"], [36, '( {r3} )']],
    [[3, '|_ + _|'], [12, 'D-PAD']],
    [[5, '|_|']],
  ],
};
// Face buttons are centred in five columns ("(TRI)", " (A) "); menu/view and stick names are plain.
const centre = (text: string, width: number) => { const left = Math.floor((width - text.length) / 2); return pad(' '.repeat(Math.max(0, left)) + text, width); };
const names = (text: string, glyphs: Glyphs) => text.replace(/\{(south|east|west|north|menu|view|l3|r3)\}/g, (_, role: Role) =>
  ['south', 'east', 'west', 'north'].includes(role) ? centre(`(${glyph(role, glyphs)})`, 5) : glyph(role, glyphs));
function place(row: Place[], glyphs: Glyphs): string {
  let line = '';
  for (const [column, text] of row) line = pad(line, column) + names(text, glyphs);
  return line;
}
function frame(profile: MapProfile, unicode: boolean): string[] {
  const rows = drawings[(profile.family ?? 'playstation') === 'playstation' ? 'symmetric' : 'offset'].map(row => place(row, printed(profile)));
  // Inner boxes (touchpad, home) follow the outline's character set.
  const boxes = (row: string) => row.replace(/\.(-+)\./g, (_, line: string) => `╭${'─'.repeat(line.length)}╮`)
    .replace(/'(-+)'/g, (_, line: string) => `╰${'─'.repeat(line.length)}╯`).replace(/\|( +(?:TOUCHPAD|HOME) +)\|/g, '│$1│');
  if (unicode) return [
    `  ╭${'─'.repeat(inner)}╮`,
    ...rows.map(row => `  │${pad(boxes(row), inner)}│`),
    `  ╰${'─'.repeat(13)}╯  L STICK   ╰${'─'.repeat(9)}╯  R STICK   ╰${'─'.repeat(inner - 50)}╯`,
  ];
  return [
    `   ${'_'.repeat(inner)}`,
    ...rows.map((row, index) => `  ${index === 0 ? '/' : '|'}${pad(row, inner)}${index === 0 ? '\\' : '|'}`),
    `  \\${'_'.repeat(13)}/  L STICK   \\${'_'.repeat(9)}/  R STICK   \\${'_'.repeat(inner - 50)}/`,
  ];
}
function highlight(line: string, profile: MapProfile): Segment[] {
  const g = printed(profile);
  const tokens = [...(['south', 'east', 'west', 'north'] as const).map(role => `(${glyph(role, g)})`), `( ${glyph('l3', g)} )`, `( ${glyph('r3', g)} )`,
    glyph('menu', g), glyph('view', g), 'TOUCHPAD', 'HOME', 'D-PAD', 'L STICK', 'R STICK'];
  const pattern = new RegExp([...new Set(tokens)].sort((a, b) => b.length - a.length).map(token => token.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|'), 'g');
  const segments: Segment[] = []; let at = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index! > at) segments.push(['art', line.slice(at, match.index)]);
    segments.push(['label', match[0]]); at = match.index! + match[0].length;
  }
  if (at < line.length) segments.push(['art', line.slice(at)]);
  return segments;
}
function shoulders(profile: MapProfile): Segment[][] {
  const a = actions(profile), g = active(profile);
  const top = (left: string, leftText: string, right: string, rightText: string): Segment[] =>
    [['label', ` [${left}] `], ['text', pad(leftText, 36 - left.length)], ['label', ` [${right}] `], ['text', rightText]];
  return [top(glyph('l2', g), a.l2, glyph('r2', g), a.r2), top(glyph('l1', g), a.l1, glyph('r1', g), a.r1)];
}
function legend(profile: MapProfile, column: number): Segment[][] {
  const a = actions(profile), g = active(profile);
  const left: [string, string][] = [
    ['D-PAD', 'Arrows: menus, choices'],
    ['L STICK', 'Cursor by char / line, hold'],
    [glyph('l3', g), 'Delete forward'],
    ['R STICK', 'Word <->, line start ^ end v'],
    [glyph('r3', g), a.r3],
    [glyph('l2', g), a.l2],
  ];
  const right: [string, string][] = [
    [`(${glyph('south', g)})`, 'Enter / send'],
    [`(${glyph('east', g)})`, 'Esc / back'],
    [`(${glyph('west', g)})`, 'Backspace, hold'],
    [`(${glyph('north', g)})`, 'Delete word, hold'],
    [glyph('menu', g), 'Padcode menu'],
    ['CTRL+]', 'Ends the session (keyboard)'],
  ];
  return left.map(([key, action], index) => {
    const [rightKey, rightAction] = right[index]!;
    return [['label', ` ${pad(key, 8)}`], ['text', pad(action, column - 9)], ['label', `${pad(rightKey, 8)}`], ['text', rightAction]];
  });
}
function narrow(profile: MapProfile): Segment[][] {
  const a = actions(profile), g = active(profile);
  const rows: [string, string][] = [
    [glyph('l2', g), a.l2], [`${glyph('l1', g)} / ${glyph('r1', g)}`, 'Tab / Shift+Tab'], [glyph('r2', g), a.r2], ['D-PAD', 'Arrows'],
    ['L STICK', 'Cursor, hold repeats'], [glyph('l3', g), 'Delete forward'], ['R STICK', 'Word, line start/end'], [glyph('r3', g), a.r3],
    [`(${glyph('south', g)})`, 'Enter / send'], [`(${glyph('east', g)})`, 'Esc / back'], [`(${glyph('west', g)})`, 'Backspace'], [`(${glyph('north', g)})`, 'Delete word'],
    [glyph('menu', g), 'Padcode menu'], ['CTRL+]', 'End session'],
  ];
  return rows.map(([key, action]) => [['label', ` ${pad(key, 8)}`], ['text', action]]);
}
export const mapWidth = 78, compactHeight = 8;
// Picks the richest layout that fits: the drawing, then a two-column legend, then a single list.
export function renderControllerMap(profile: MapProfile, width: number, caps: Caps, height = Infinity): string[] {
  const drawn = [...shoulders(profile), ...frame(profile, caps.unicode).map(line => highlight(line, profile)), ...legend(profile, 40)];
  const rows = width < mapWidth ? narrow(profile) : height >= drawn.length ? drawn : [...shoulders(profile), ...legend(profile, 40)];
  return rows.map(segments => {
    let used = 0, line = '';
    for (const [kind, text] of segments) {
      const room = Math.max(0, width - used), part = text.slice(0, room);
      used += part.length;
      line += part.trim() ? paint(caps, part, styles[kind]) : part;
    }
    return line;
  });
}
