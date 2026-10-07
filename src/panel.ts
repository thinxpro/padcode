import { safeLabel } from './ui.js';

const tones: Record<string, string> = {
  ACTIVE: '\x1b[1;92m', ARMING: '\x1b[1;96m', PAUSED: '\x1b[1;93m', HISTORY: '\x1b[1;93m', RECONNECTED: '\x1b[1;93m',
  MENU: '\x1b[1;95m', 'END SESSION?': '\x1b[1;91m', REC: '\x1b[1;91m', PLAYING: '\x1b[1;96m', DISCONNECTED: '\x1b[1;91m', 'INPUT LOST': '\x1b[1;91m', UNAVAILABLE: '\x1b[1;91m',
};
const reset = '\x1b[0m', dim = '\x1b[2;37m', brand = '\x1b[1;96m';
const hints = [['D-PAD', 'ARROWS'], ['X', 'ENTER'], ['O', 'ESC'], ['L1', 'TAB'], ['R1', 'SHIFT+TAB'], ['OPTIONS', 'MENU'], ['WHEEL', 'HISTORY']] as const;

// Fit segments by priority; earlier segments survive narrower widths.
function fit(parts: string[], width: number, gap: string): string[] {
  const kept: string[] = [];
  for (const part of parts) if ([...kept, part].join(gap).length <= width) kept.push(part);
  return kept;
}
export function renderPanel(status: string, width: number, rows: number, color: boolean, notice?: string): string[] {
  const columns = Math.max(1, width);
  const [rawState = 'STARTING', rawDetail = ''] = safeLabel(status).split(' / ');
  const state = rawState.trim().toUpperCase() || 'STARTING', detail = rawDetail.trim().toUpperCase();
  const label = `PADCODE // GAMEPAD ${state}`;
  const head = label.length <= columns ? label : `GAMEPAD ${state}`.slice(0, columns);
  const right = fit([detail, 'CTRL+] END'].filter(Boolean), Math.max(0, columns - head.length - 3), ' | ').join(' | ');
  const pad = right ? ' '.repeat(Math.max(3, columns - head.length - right.length)) : '';
  const legend = fit(hints.map(([key, action]) => `${key} ${action}`), columns, '  ').join('  ');
  const paint = (style: string, value: string) => color && value ? `${style}${value}${reset}` : value;
  const tone = tones[state] ?? tones[state.split(' ')[0]!] ?? '\x1b[1;37m';
  const top = head.startsWith('PADCODE')
    ? `${paint(brand, 'PADCODE')}${paint(dim, ' // ')}${paint('\x1b[37m', 'GAMEPAD ')}${paint(tone, state)}`
    : `${paint('\x1b[37m', 'GAMEPAD ')}${paint(tone, head.slice('GAMEPAD '.length))}`;
  const first = `${top}${pad}${paint(dim, right)}`;
  if (rows < 2) return [first];
  if (notice) { const text = safeLabel(notice).replace(' / ', ' | ').toUpperCase().slice(0, columns); return [first, paint('\x1b[1;93m', text)]; }
  return [first, color ? legend.replace(/(^|  )(\S+)/g, (_, gap: string, key: string) => `${gap}${brand}${key}${reset}${dim}`) + reset : legend];
}
