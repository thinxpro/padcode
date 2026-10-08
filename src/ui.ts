import type { Button } from './protocol.js';
import type { State } from './state.js';
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
    if (compact) lines.push(`DPAD ${active('dpad_up', 'U')}${active('dpad_down', 'D')}${active('dpad_left', 'L')}${active('dpad_right', 'R')}`, `FACE ${active('south', 'X')}${active('east', 'O')}${active('west', 'SQ')}${active('north', 'TRI')}`);
    else lines.push(
      `     ${active('left_shoulder', 'L1')}                                 ${active('right_shoulder', 'R1')}`,
      `          ${active('dpad_up', '^')}                          ${active('north', 'TRI')}`,
      `     ${active('dpad_left', '<')}  +  ${active('dpad_right', '>')}                  ${active('west', 'SQ')}  ${active('east', 'O')}`,
      `          ${active('dpad_down', 'v')}                          ${active('south', 'X')}`, '',
    );
    lines.push(`HELD ${[...device.buttons].join(' ') || '--'}`,
      `LX ${meter(device.axes.leftx)}  LY ${meter(device.axes.lefty)}`,
      `RX ${meter(device.axes.rightx)}  RY ${meter(device.axes.righty)}`,
      `L2 ${meter(device.axes.left_trigger)}  R2 ${meter(device.axes.right_trigger)}`);
  } else lines.push('Connect a controller with a USB data cable.', 'No agent is launched. No input is injected.');
  lines.push('', 'RECENT INPUT', ...state.history.slice(0, compact ? 3 : 5));
  const exit = state.back === 'release' ? 'RELEASE O TO RETURN' : state.back === 'hold' ? 'HOLD O 1S / Q BACK' : state.back === 'press' ? 'O / Q BACK' : 'Q / ESC EXIT';
  const footer = `${exit}   |   ${state.source === 'demo' ? 'DEMO - NOT HARDWARE EVIDENCE' : 'CTRL+C QUIT'}`;
  const visible = [...lines.slice(0, Math.max(0, height - 3)), '-'.repeat(columns), footer].slice(0, Math.max(1, height - 1));
  return visible.map((line, i) => {
    const text = line.slice(0, columns);
    if (!color) return text;
    const style = i === 1 ? '\x1b[1;96m' : i === 2 ? '\x1b[95m' : line.startsWith('PLAYER READY') ? '\x1b[92m' : '\x1b[37m';
    const highlighted = text.replace(/\[[A-Z0-9]+\]/g, token => `\x1b[1;95m${token}${style}`).replace(/#+/g, bar => `\x1b[96m${bar}${style}`);
    return `${style}${highlighted}\x1b[0m`;
  }).join('\n');
}
export function help(color: boolean): string {
  const c = (s: string) => color ? `\x1b[1;96m${s}\x1b[0m` : s;
  return `${c('  P A D C O D E')}\n  YOUR CONTROLLER. YOUR AGENT.\n\n  [01] padcode              First-run setup / player hub\n  [02] config               Edit Bluetooth + Agent loadout\n  [03] controllers          Open the live controller lab\n  [04] controllers --json   Stream raw controller events\n  [05] demo                 Preview the arcade dashboard\n\n  [06] run                  Start your configured Agent in a PTY\n\n  --help    Command hub\n  --version Build version\n\n  IN A SESSION (tmux controls pane)\n  Options   Controls menu: pause, history, interrupt, clear, voice undo, end\n  Hold L2   Dictate (macOS, after Voice settings); text is typed, never sent\n  L stick   Cursor (hold to repeat)   R stick  word / line start-end\n  Square    Backspace   Triangle  delete word   L3  Delete\n  R2 / R3   Newline / undo (Claude Code)\n  Ctrl+]    End the session\n\n  Release candidate / private build.\n`;
}
