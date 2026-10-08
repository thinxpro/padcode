// Game-style controls screen for the DualShock 4. ASCII only: box-drawing and shape symbols are
// ambiguous-width and render two columns wide in many CJK terminal setups, breaking the drawing.
export interface MapProfile { claude: boolean; voice: boolean }
type Segment = [kind: 'label' | 'art' | 'text' | 'dim', text: string];
const styles = { label: '\x1b[1;96m', art: '\x1b[2;37m', text: '\x1b[0;37m', dim: '\x1b[2;37m' };

function actions(profile: MapProfile) {
  return {
    l2: profile.voice ? 'Hold to dictate' : 'Voice off (Hub > Voice settings)',
    r2: profile.claude ? 'New line (no send)' : 'Unused (Claude Code only)',
    r3: profile.claude ? 'Undo' : 'Unused (Claude Code only)',
  };
}
const pad = (text: string, width: number) => text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);

// Wide layout: shoulders above, the controller in the middle, a two-column legend below.
// Inner rows are padded to one width so the frame always closes.
const inner = 57;
const body = [
  '    _         SHARE                     OPTIONS   (TRI)    ',
  '  _| |_            .------------------.        (SQ)  (O)   ',
  ' |_ + _|           |     TOUCHPAD     |           (X)      ',
  '   |_|             \'------------------\'                     ',
  '  D-PAD       ( L3 )                  ( R3 )               ',
];
const frame = [
  `   ${'_'.repeat(inner)}`,
  ...body.map((row, index) => `  ${index === 0 ? '/' : '|'}${pad(row, inner)}${index === 0 ? '\\' : '|'}`),
  `  \\${'_'.repeat(13)}/  L STICK   \\${'_'.repeat(9)}/  R STICK   \\${'_'.repeat(inner - 50)}/`,
];
const labels = /\(TRI\)|\(SQ\)|\(O\)|\(X\)|\( L3 \)|\( R3 \)|SHARE|OPTIONS|TOUCHPAD|D-PAD|L STICK|R STICK/g;
function wide(profile: MapProfile): Segment[][] {
  const art = frame.map(line => {
    const segments: Segment[] = []; let at = 0;
    for (const match of line.matchAll(labels)) {
      if (match.index! > at) segments.push(['art', line.slice(at, match.index)]);
      segments.push(['label', match[0]]); at = match.index! + match[0].length;
    }
    if (at < line.length) segments.push(['art', line.slice(at)]);
    return segments;
  });
  return [...shoulders(profile), ...art, ...legend(profile, 40)];
}
function shoulders(profile: MapProfile): Segment[][] {
  const a = actions(profile);
  const top = (left: string, leftText: string, right: string, rightText: string): Segment[] =>
    [['label', ` ${left} `], ['text', pad(leftText, 34)], ['label', ` ${right} `], ['text', rightText]];
  return [top('[L2]', a.l2, '[R2]', a.r2), top('[L1]', 'Tab', '[R1]', 'Shift+Tab (mode)')];
}
function legend(profile: MapProfile, column: number): Segment[][] {
  const a = actions(profile);
  const left: [string, string][] = [
    ['D-PAD', 'Arrows: menus, choices'],
    ['L STICK', 'Cursor by char / line, hold'],
    ['L3', 'Delete forward'],
    ['R STICK', 'Word <->, line start ^ end v'],
    ['R3', a.r3],
    ['L2', a.l2],
  ];
  const right: [string, string][] = [
    ['(X)', 'Enter / send'],
    ['(O)', 'Esc / back'],
    ['(SQ)', 'Backspace, hold'],
    ['(TRI)', 'Delete word, hold'],
    ['OPTIONS', 'Padcode menu'],
    ['CTRL+]', 'Ends the session (keyboard)'],
  ];
  return left.map(([key, action], index) => {
    const [rightKey, rightAction] = right[index]!;
    return [['label', ` ${pad(key, 8)}`], ['text', pad(action, column - 9)], ['label', `${pad(rightKey, 8)}`], ['text', rightAction]];
  });
}
function narrow(profile: MapProfile): Segment[][] {
  const a = actions(profile);
  const rows: [string, string][] = [
    ['L2', a.l2], ['L1 / R1', 'Tab / Shift+Tab'], ['R2', a.r2], ['D-PAD', 'Arrows'],
    ['L STICK', 'Cursor, hold repeats'], ['L3', 'Delete forward'], ['R STICK', 'Word, line start/end'], ['R3', a.r3],
    ['(X)', 'Enter / send'], ['(O)', 'Esc / back'], ['(SQ)', 'Backspace'], ['(TRI)', 'Delete word'],
    ['OPTIONS', 'Padcode menu'], ['CTRL+]', 'End session'],
  ];
  return rows.map(([key, action]) => [['label', ` ${pad(key, 8)}`], ['text', action]]);
}
export const mapWidth = 78, drawingHeight = 15, compactHeight = 8;
// Picks the richest layout that fits: the drawing, then a two-column legend, then a single list.
export function renderControllerMap(profile: MapProfile, width: number, color: boolean, height = Infinity): string[] {
  const rows = width < mapWidth ? narrow(profile) : height >= drawingHeight ? wide(profile) : [...shoulders(profile), ...legend(profile, 40)];
  return rows.map(segments => {
    let used = 0, line = '';
    for (const [kind, text] of segments) {
      const room = Math.max(0, width - used), part = text.slice(0, room);
      used += part.length;
      line += color && part.trim() ? `${styles[kind]}${part}\x1b[0m` : part;
    }
    return line;
  });
}
