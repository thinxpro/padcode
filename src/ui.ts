import type { Button } from './protocol.js';
import type { State } from './state.js';
import { glyph, type Glyphs } from './glyphs.js';
import { logo, logoVariant, paint, rule, truncate, wrapAnsi, type Caps } from './tui/index.js';
import { version } from './version.js';
// ASCII content keeps width deterministic across fonts/locales; preserve names only in JSON mode.
export function safeLabel(text: string): string { return text.replace(/[^\x20-\x7e]/g, '?'); }
// Prose for people (transcripts, device names): keeps Unicode, drops controls, bidi overrides and lone surrogates.
export function safeText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\p{Cs}/gu, '?');
}
export function colorEnabled(env: NodeJS.ProcessEnv, tty: boolean): boolean { return tty && env.NO_COLOR === undefined && env.TERM !== 'dumb'; }
export function render(state: State, width = 80, height = 30, color = true): string {
  const columns = Math.max(1, Math.min(84, width - 1));
  const device = state.selected === null ? undefined : state.devices.get(state.selected);
  const compact = columns < 58;
  // Face and shoulder names follow the device's family (standard names when it is unknown).
  const names: Glyphs = { family: device?.family ?? 'standard' };
  const g = (role: Parameters<typeof glyph>[0]) => glyph(role, names);
  const pad = (text: string, width: number) => text.padEnd(width);
  const active = (button: Button, label: string) => device?.buttons.has(button) ? `[${label}]` : ` ${label} `;
  const meter = (value: number) => { const n = Math.round(Math.abs(value) * 10); return `${value < 0 ? '-' : '+'}${'#'.repeat(n)}${'.'.repeat(10 - n)} ${value.toFixed(2)}`; };
  const title = 'P A D C O D E  /  CONTROLLER LAB';
  const source = state.source === 'demo' ? 'DEMO / SYNTHETIC INPUT' : state.source === 'virtual' ? 'TEST / VIRTUAL DEVICE' : 'LIVE / SDL INPUT';
  const lines = [
    '='.repeat(columns), title, source, '-'.repeat(columns),
    device ? `PLAYER READY  //  ${safeLabel(device.name)}` : state.ready ? 'INSERT CONTROLLER  //  waiting for connection' : 'BOOTING INPUT ENGINE...',
    `DEVICES ${state.devices.size}    BUTTON EDGES ${state.transitions}`, '',
  ];
  if (device) {
    if (compact) lines.push(`DPAD ${active('dpad_up', 'U')}${active('dpad_down', 'D')}${active('dpad_left', 'L')}${active('dpad_right', 'R')}`, `FACE ${active('south', g('south'))}${active('east', g('east'))}${active('west', g('west'))}${active('north', g('north'))}`);
    else lines.push(
      `     ${active('left_shoulder', g('l1'))}                                 ${active('right_shoulder', g('r1'))}`,
      `          ${active('dpad_up', '^')}                          ${active('north', g('north'))}`,
      `     ${active('dpad_left', '<')}  +  ${active('dpad_right', '>')}                  ${active('west', g('west'))}  ${active('east', g('east'))}`,
      `          ${active('dpad_down', 'v')}                          ${active('south', g('south'))}`, '',
    );
    lines.push(`HELD ${[...device.buttons].join(' ') || '--'}`,
      `LX ${meter(device.axes.leftx)}  LY ${meter(device.axes.lefty)}`,
      `RX ${meter(device.axes.rightx)}  RY ${meter(device.axes.righty)}`,
      `${pad(g('l2'), 2)} ${meter(device.axes.left_trigger)}  ${pad(g('r2'), 2)} ${meter(device.axes.right_trigger)}`);
  } else lines.push('Connect a controller with a USB data cable.', 'No agent is launched. No input is injected.');
  lines.push('', 'RECENT INPUT', ...state.history.slice(0, compact ? 3 : 5));
  const back = g('east');
  const exit = state.back === 'release' ? `RELEASE ${back} TO RETURN` : state.back === 'hold' ? `HOLD ${back} 1S / Q BACK` : state.back === 'press' ? `${back} / Q BACK` : 'Q / ESC EXIT';
  const footer = `${exit}   |   ${state.source === 'demo' ? 'DEMO - NOT HARDWARE EVIDENCE' : 'CTRL+C QUIT'}`;
  const visible = [...lines.slice(0, Math.max(0, height - 3)), '-'.repeat(columns), footer].slice(0, Math.max(1, height - 1));
  return visible.map((line, i) => {
    const text = line.slice(0, columns);
    if (!color) return text;
    const style = i === 1 ? '\x1b[1;96m' : i === 2 ? '\x1b[95m' : line.startsWith('PLAYER READY') ? '\x1b[92m' : '\x1b[37m';
    const highlighted = text.replace(/\[[A-Z0-9+-]+\]/g, token => `\x1b[1;95m${token}${style}`).replace(/#+/g, bar => `\x1b[96m${bar}${style}`);
    return `${style}${highlighted}\x1b[0m`;
  }).join('\n');
}
const commands: Array<[string, string]> = [
  ['padcode', 'Player Hub (first run: setup)'],
  ['padcode config', 'Edit Bluetooth + Agent loadout'],
  ['padcode run', 'Start your configured Agent in a PTY'],
  ['padcode controllers', 'Open the live controller lab'],
  ['padcode controllers --json', 'Stream raw controller events'],
  ['padcode demo', 'Preview the arcade dashboard'],
];
const controls: Array<[string, string]> = [
  ['OPTIONS / MENU', 'Controls menu: pause, history, interrupt, clear, map, end'],
  ['Hold L2 / LT', 'Dictate (macOS, after Voice settings); typed, never sent'],
  ['L stick', 'Cursor (hold to repeat)'],
  ['R stick', 'Word / line start-end'],
  ['SQ / X', 'Backspace'],
  ['TRI / Y', 'Delete word'],
  ['L3 / LS', 'Delete'],
  ['R2 / RT, R3 / RS', 'Newline / undo (Claude Code)'],
  ['Ctrl+]', 'End the session'],
];
const flags: Array<[string, string]> = [['--help, -h', 'This command hub'], ['--version', 'Build version']];
const environment: Array<[string, string]> = [
  ['NO_COLOR', 'Monochrome output'],
  ['PADCODE_ASCII=1', 'ASCII frames and logo (for terminals that draw symbols double wide)'],
  ['PADCODE_NO_ANIM=1', 'Skip the welcome sweep'],
];
// Command hub. Piped output is plain ASCII so scripts can read it.
export function help(caps: Caps): string {
  const width = Math.max(20, Math.min(caps.width - 1, 80));
  const section = (title: string, rows: Array<[string, string]>, note?: string) => {
    const keyWidth = Math.max(...rows.map(([key]) => key.length));
    return [
      '', rule(width, caps, note ? `${title}  ${note}` : title),
      ...rows.flatMap(([key, text]) => wrapAnsi(text, Math.max(10, width - keyWidth - 4))
        .map((line, i) => `  ${paint(caps, (i ? '' : key).padEnd(keyWidth), { tone: 'brand', bold: true })}  ${paint(caps, line, { tone: 'text' })}`)),
    ];
  };
  const variant = logoVariant(caps, width);
  const lines = [
    ...logo(caps, variant).map(line => `  ${line}`),
    `  ${paint(caps, 'YOUR CONTROLLER. YOUR AGENT.', { tone: 'text', bold: true })}  ${paint(caps, `v${version()}`, { tone: 'muted' })}`,
    ...section('COMMANDS', commands),
    ...section('IN A SESSION', controls, '(PlayStation / Xbox names)'),
    ...section('FLAGS', flags),
    ...section('ENVIRONMENT', environment),
    '', paint(caps, '  Release candidate / private build.', { tone: 'muted' }),
  ];
  return lines.map(line => truncate(line, width + 2)).join('\n') + '\n';
}
