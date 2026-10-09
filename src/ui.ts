import { logo, logoVariant, paint, rule, truncate, wrapAnsi, type Caps } from './tui/index.js';
import { version } from './version.js';
// ASCII content keeps width deterministic across fonts/locales; preserve names only in JSON mode.
export function safeLabel(text: string): string { return text.replace(/[^\x20-\x7e]/g, '?'); }
// Prose for people (transcripts, device names): keeps Unicode, drops controls, bidi overrides and lone surrogates.
export function safeText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\p{Cs}/gu, '?');
}
export function colorEnabled(env: NodeJS.ProcessEnv, tty: boolean): boolean { return tty && env.NO_COLOR === undefined && env.TERM !== 'dumb'; }
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
