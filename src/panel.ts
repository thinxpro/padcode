import { safeLabel } from './ui.js';
import { formatGlyphs, type Glyphs } from './glyphs.js';
import { dot, keycap, paint, truncate, visibleWidth, type Caps, type DotState, type Tone } from './tui/index.js';

// State symbol and tone; unknown states use the neutral look.
const states: Record<string, [DotState, Tone]> = {
  ACTIVE: ['ok', 'ok'], ARMING: ['warn', 'warn'], PAUSED: ['warn', 'warn'], HISTORY: ['warn', 'warn'], RECONNECTED: ['warn', 'warn'],
  MENU: ['active', 'accent'], REC: ['active', 'danger'], PLAYING: ['active', 'accent'],
  'END SESSION?': ['error', 'danger'], DISCONNECTED: ['error', 'danger'], 'INPUT LOST': ['error', 'danger'], UNAVAILABLE: ['error', 'danger'],
};
const hints = [['D-PAD', 'ARROWS'], ['{confirm}', 'ENTER'], ['{back}', 'ESC'], ['{l1}', 'TAB'], ['{r1}', 'SHIFT+TAB'], ['{menu}', 'MENU'], ['{view}', 'COMMANDS'], ['STICKS', 'CURSOR'], ['{west}', 'BKSP'], ['WHEEL', 'HISTORY']] as const;

// Fit segments by priority; earlier segments survive narrower widths.
function fit(parts: string[], width: number, gap: string): string[] {
  const kept: string[] = [];
  for (const part of parts) if (visibleWidth([...kept, part].join(gap)) <= width) kept.push(part);
  return kept;
}
// Status pane under the Agent: PADCODE, a state symbol, GAMEPAD <STATE> (one span), the detail and CTRL+] END; then the legend or a notice.
export function renderPanel(status: string, caps: Caps, rows: number, notice?: string, names: Glyphs = { family: 'playstation' }): string[] {
  const columns = Math.max(1, caps.width);
  const [rawState = 'STARTING', rawDetail = ''] = safeLabel(status).split(' / ');
  const state = rawState.trim().toUpperCase() || 'STARTING', detail = rawDetail.trim().toUpperCase();
  const [symbol, tone] = states[state] ?? states[state.split(' ')[0]!] ?? ['off', 'text'];
  const gamepad = paint(caps, `GAMEPAD ${state}`, { tone, bold: true });
  const full = `${paint(caps, 'PADCODE', { tone: 'brand', bold: true })} ${dot(symbol, caps)} ${gamepad}`;
  const head = visibleWidth(full) <= columns ? full : truncate(`${dot(symbol, caps)} ${gamepad}`, columns);
  const bar = caps.unicode ? '│' : '|';
  // CTRL+] END outranks the detail when space runs out.
  const room = Math.max(0, columns - visibleWidth(head) - 3);
  const right = fit([paint(caps, 'CTRL+] END', { tone: 'muted' }), ...(detail ? [paint(caps, detail, { tone: 'muted' })] : [])], room, ` ${bar} `).reverse().join(paint(caps, ` ${bar} `, { tone: 'muted' }));
  const first = right ? `${head}${' '.repeat(Math.max(3, columns - visibleWidth(head) - visibleWidth(right)))}${right}` : head;
  if (rows < 2) return [first];
  if (notice) return [first, truncate(`${dot('warn', caps)} ${paint(caps, safeLabel(notice).replace(' / ', ' | ').toUpperCase(), { tone: 'warn', bold: true })}`, columns)];
  const legend = fit(hints.map(([key, action]) => `${keycap(formatGlyphs(key, names), caps, 'muted')} ${paint(caps, action, { tone: 'muted' })}`), columns, '  ').join('  ');
  return [first, legend];
}
