// Controller Lab and arcade demo: a drawn controller whose parts light up, stick dots, trigger meters and history.
import type { Button } from './protocol.js';
import type { Device, State } from './state.js';
import { glyph, type Glyphs, type Role } from './glyphs.js';
import { safeLabel } from './ui.js';
import { Canvas, DIVIDER, dot, fit, frame, meter, paint, truncate, visibleWidth, type Caps, type Row, type Style, type Tone } from './tui/index.js';

const sources: Record<string, { text: string; tone: Tone }> = {
  demo: { text: 'DEMO / SYNTHETIC INPUT', tone: 'warn' },
  virtual: { text: 'TEST / VIRTUAL DEVICE', tone: 'info' },
};
const live = { text: 'LIVE / SDL INPUT', tone: 'ok' as Tone };
const ellipsis = (caps: Caps) => caps.unicode ? '…' : '~';
export const labBody = { width: 60, height: 14 };

// A control label: inverse accent when pressed, plain when idle; [NAME] marks pressed without colour.
function cap(caps: Caps, label: string, on: boolean): [string, Style] {
  if (caps.color) return [` ${label} `, on ? { tone: 'accent', bold: true, inverse: true } : { tone: 'muted' }];
  return [on ? `[${label}]` : ` ${label} `, {}];
}
function stickCell(value: number, cells: number): number {
  const v = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return Math.round((v + 1) / 2 * (cells - 1));
}
const signed = (value: number) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(2)}`;

// The controller, drawn on a 60 x 14 canvas.
export function drawController(device: Device, caps: Caps): string[] {
  const c = new Canvas(labBody.width, labBody.height, caps);
  const names: Glyphs = { family: device.family ?? 'standard' };
  const g = (role: Role) => glyph(role, names);
  const held = (button: Button) => device.buttons.has(button);
  const at = (row: number, column: number, label: string, button: Button) => { const [text, style] = cap(caps, label, held(button)); c.centre(row, column, text, style); };
  const u = caps.unicode;
  // Triggers and shoulders.
  for (const [column, role, axis] of [[2, 'l2', 'left_trigger'], [42, 'r2', 'right_trigger']] as const) {
    const value = device.axes[axis];
    c.put(0, column, g(role).padEnd(3), value > 0.5 ? { tone: 'accent', bold: true } : { tone: 'muted' });
    // The meter is drawn character by character so the canvas keeps its own styles.
    const filled = meter(value, 12, { ...caps, color: 0 });
    [...filled].forEach((char, i) => c.put(0, column + 3 + i, char, char === (u ? '░' : '.') ? { tone: 'muted' } : { tone: 'brand' }));
  }
  at(1, 8, g('l1'), 'left_shoulder'); at(1, 52, g('r1'), 'right_shoulder');
  // Centre: view, touchpad or home, menu.
  at(3, 19, g('view'), 'back'); at(3, 41, g('menu'), 'start');
  const pad = names.family === 'playstation' ? 'TOUCHPAD' : 'HOME';
  at(3, 30, pad, names.family === 'playstation' ? 'touchpad' : 'guide');
  if (names.family === 'playstation') at(5, 30, 'PS', 'guide');
  // D-pad cross and face diamond.
  const [up, down, left, right] = u ? ['▲', '▼', '◀', '▶'] : ['^', 'v', '<', '>'];
  at(4, 9, up, 'dpad_up'); at(5, 5, left, 'dpad_left'); at(5, 13, right, 'dpad_right'); at(6, 9, down, 'dpad_down');
  c.centre(7, 9, 'D-PAD', { tone: 'muted' });
  at(4, 51, g('north'), 'north'); at(5, 45, g('west'), 'west'); at(5, 57, g('east'), 'east'); at(6, 51, g('south'), 'south');
  // Sticks: a 5 x 3 field with a dot at the stick's position; the stick name lights while pressed.
  for (const [column, role, button, x, y] of [[17, 'l3', 'left_stick', 'leftx', 'lefty'], [37, 'r3', 'right_stick', 'rightx', 'righty']] as const) {
    const box = u ? ['╭─────╮', '│     │', '╰─────╯'] : ['+-----+', '|     |', '+-----+'];
    const tone: Style = held(button) ? { tone: 'accent', bold: true } : { tone: 'muted' };
    c.put(8, column, box[0]!, tone);
    for (let r = 0; r < 3; r++) c.put(9 + r, column, box[1]!, tone);
    c.put(12, column, box[2]!, tone);
    const dx = stickCell(device.axes[x], 5), dy = stickCell(device.axes[y], 3);
    const centred = device.axes[x] === 0 && device.axes[y] === 0;
    c.put(9 + dy, column + 1 + dx, u ? (centred ? '·' : '●') : (centred ? '.' : 'o'), centred ? { tone: 'muted' } : { tone: 'brand', bold: true });
    at(10, column + 11, g(role), button);
    c.put(13, column - 2, `X${signed(device.axes[x])} Y${signed(device.axes[y])}`, { tone: 'muted' });
  }
  return c.lines();
}
function footerText(state: State, back: string): [string, string] {
  const exit = state.back === 'release' ? `RELEASE ${back} TO RETURN` : state.back === 'hold' ? `HOLD ${back} 1S / Q BACK` : state.back === 'press' ? `${back} / Q BACK` : 'Q / ESC EXIT';
  return [exit, state.source === 'demo' ? 'DEMO - NOT HARDWARE EVIDENCE' : 'CTRL+C QUIT'];
}
function headline(state: State, device: Device | undefined, caps: Caps, width: number): string {
  const [state_, text] = device ? ['ok', `PLAYER READY  //  ${safeLabel(device.name)}`] as const
    : state.ready ? ['warn', 'INSERT CONTROLLER  //  waiting for connection'] as const : ['active', 'BOOTING INPUT ENGINE...'] as const;
  return truncate(`${dot(state_, caps)} ${paint(caps, text, { tone: 'text', bold: true })}`, width, ellipsis(caps));
}
function heldText(device: Device): string {
  return `HELD ${[...device.buttons].join(' ').toUpperCase() || '--'}`;
}
export function renderLab(state: State, caps: Caps): string[] {
  const cols = Math.max(1, caps.width - 1), rows = Math.max(1, caps.height - 1);
  const device = state.selected === null ? undefined : state.devices.get(state.selected);
  const names: Glyphs = { family: device?.family ?? 'standard' };
  const source = state.source === 'demo' || state.source === 'virtual' ? sources[state.source]! : live;
  const [exit, note] = footerText(state, glyph('east', names));
  const footer = truncate(`  ${paint(caps, exit, { tone: 'brand', bold: true })}   ${paint(caps, '|', { tone: 'muted' })}   ${paint(caps, note, { tone: state.source === 'demo' ? 'warn' : 'muted' })}`, cols);
  const width = Math.min(cols, labBody.width + 4);
  const inner = width - 4;
  const sourceText = paint(caps, source.text, { tone: source.tone, bold: true });
  const counts = paint(caps, `DEVICES ${state.devices.size}    BUTTON EDGES ${state.transitions}`, { tone: 'muted' });
  const second = visibleWidth(counts) + 2 + source.text.length <= inner ? `${counts}${' '.repeat(inner - visibleWidth(counts) - source.text.length)}${sourceText}` : sourceText;
  const status: Row[] = [headline(state, device, caps, inner), second];
  const history = state.history.map(line => paint(caps, safeLabel(line), { tone: 'muted' }));
  const tail = (body: Row[], room: number): Row[] => {
    if (room <= 0 || !history.length) return body;
    const recent: Row[] = [DIVIDER, paint(caps, 'RECENT INPUT', { tone: 'text', bold: true }), ...history.slice(0, room)];
    return [...body, ...recent];
  };
  if (width >= 40) {
    const drawing = device && inner >= labBody.width ? drawController(device, caps) : undefined;
    // Frame rows: borders 2, status 2, divider 1, body, held 1 (with a device), then history; footer outside.
    const body: Row[] = device
      ? [...(drawing ?? compactRows(device, caps, inner)), paint(caps, truncate(heldText(device), inner, ellipsis(caps)), { tone: 'text' })]
      : ['', paint(caps, 'Connect a controller with a USB data cable or over Bluetooth.', { tone: 'text' }), paint(caps, 'No agent is launched. No input is injected.', { tone: 'muted' })];
    const fixed = 2 + status.length + 1 + body.length + 1;
    if (fixed <= rows || !drawing) {
      const room = Math.min(device ? 4 : 6, rows - fixed - 2);
      const lines = frame([...status, DIVIDER, ...tail(body, room)], { width, caps, title: 'CONTROLLER LAB', padding: 1 });
      return fitHeight([...lines, footer], rows);
    }
    const compactBody: Row[] = [...compactRows(device!, caps, inner), paint(caps, truncate(heldText(device!), inner, ellipsis(caps)), { tone: 'text' })];
    const room = Math.min(3, rows - (2 + status.length + 1 + compactBody.length + 1) - 2);
    return fitHeight([...frame([...status, DIVIDER, ...tail(compactBody, room)], { width, caps, title: 'CONTROLLER LAB', padding: 1 }), footer], rows);
  }
  // Narrow terminals: no frame.
  const plain = [
    paint(caps, 'CONTROLLER LAB', { tone: 'brand', bold: true }), truncate(sourceText, cols), headline(state, device, caps, cols),
    ...(device ? [...compactRows(device, caps, cols), truncate(heldText(device), cols, ellipsis(caps))] : [truncate('Connect a controller.', cols)]),
    ...(history.length ? ['RECENT INPUT', ...history.slice(0, 3)] : []),
  ].map(line => truncate(line, cols));
  return fitHeight([...plain, footer], rows);
}
// Keeps the footer when the terminal is too short: drop lines above it.
function fitHeight(lines: string[], rows: number): string[] {
  if (lines.length <= rows) return lines;
  return [...lines.slice(0, Math.max(0, rows - 1)), lines[lines.length - 1]!].slice(-Math.max(1, rows));
}
// Compact layout: key caps in rows, stick and trigger values as meters.
function compactRows(device: Device, caps: Caps, width: number): string[] {
  const names: Glyphs = { family: device.family ?? 'standard' };
  const g = (role: Role) => glyph(role, names);
  const key = (label: string, button: Button) => { const [text, style] = cap(caps, label, device.buttons.has(button)); return paint(caps, text, style); };
  const u = caps.unicode;
  const label = (text: string) => paint(caps, text.padEnd(5), { tone: 'muted' });
  const half = (value: number) => meter(Math.abs(value), 6, caps, value < 0 ? 'accent' : 'brand');
  const rows = [
    `${label('DPAD')}${key(u ? '▲' : '^', 'dpad_up')}${key(u ? '▼' : 'v', 'dpad_down')}${key(u ? '◀' : '<', 'dpad_left')}${key(u ? '▶' : '>', 'dpad_right')}`,
    `${label('FACE')}${key(g('south'), 'south')}${key(g('east'), 'east')}${key(g('west'), 'west')}${key(g('north'), 'north')}`,
    `${label('SHLD')}${key(g('l1'), 'left_shoulder')}${key(g('r1'), 'right_shoulder')}${key(g('view'), 'back')}${key(g('menu'), 'start')}${key(g('l3'), 'left_stick')}${key(g('r3'), 'right_stick')}`,
    `${label(g('l2'))}${meter(device.axes.left_trigger, 8, caps)}  ${label(g('r2'))}${meter(device.axes.right_trigger, 8, caps)}`,
    `${label('LS')}X ${signed(device.axes.leftx)} ${half(device.axes.leftx)}  Y ${signed(device.axes.lefty)} ${half(device.axes.lefty)}`,
    `${label('RS')}X ${signed(device.axes.rightx)} ${half(device.axes.rightx)}  Y ${signed(device.axes.righty)} ${half(device.axes.righty)}`,
  ];
  return rows.map(row => fit(row, width, ellipsis(caps)));
}
