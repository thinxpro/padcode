import type { Caps } from './caps.js';
import { paint, type Tone } from './theme.js';
import { padEnd, visibleWidth } from './text.js';

// A button label as a key cap: inverse with colour, [LABEL] without.
export function keycap(label: string, caps: Caps, tone: Tone = 'brand'): string {
  return caps.color ? paint(caps, ` ${label} `, { tone, bold: true, inverse: true }) : `[${label}]`;
}
export type DotState = 'ok' | 'warn' | 'off' | 'error' | 'active';
const dots: Record<DotState, { unicode: string; ascii: string; tone: Tone }> = {
  ok: { unicode: '●', ascii: '*', tone: 'ok' },
  warn: { unicode: '▲', ascii: '!', tone: 'warn' },
  off: { unicode: '○', ascii: 'o', tone: 'muted' },
  error: { unicode: '✕', ascii: 'x', tone: 'danger' },
  active: { unicode: '◆', ascii: '+', tone: 'accent' },
};
export function dot(state: DotState, caps: Caps): string {
  const d = dots[state];
  return paint(caps, caps.unicode ? d.unicode : d.ascii, { tone: d.tone, bold: true });
}
// Progress through numbered steps: ●●○○○ / ##---
export function stepper(current: number, total: number, caps: Caps): string {
  const count = Math.max(0, Math.floor(total)), done = Math.max(0, Math.min(count, Math.floor(current)));
  const [on, off] = caps.unicode ? ['●', '○'] : ['#', '-'];
  return paint(caps, on.repeat(done), { tone: 'brand', bold: true }) + paint(caps, off.repeat(count - done), { tone: 'muted' });
}
const eighths = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
// A bar of exactly `width` columns for a 0..1 fraction (clamped; NaN reads as empty).
export function meter(fraction: number, width: number, caps: Caps, tone: Tone = 'brand'): string {
  const size = Math.max(0, Math.floor(width)), value = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  if (!caps.unicode) { const n = Math.round(value * size); return paint(caps, '#'.repeat(n), { tone }) + paint(caps, '.'.repeat(size - n), { tone: 'muted' }); }
  const units = Math.round(value * size * 8), full = Math.floor(units / 8), part = eighths[units % 8]!;
  const filled = '█'.repeat(full) + part, rest = size - full - (part ? 1 : 0);
  return paint(caps, filled, { tone }) + paint(caps, '░'.repeat(rest), { tone: 'muted' });
}
// Controller-console footer: key caps with labels, earlier items kept first when space runs out.
export function hintBar(items: ReadonlyArray<readonly [key: string, label: string]>, width: number, caps: Caps, gap = '   '): string {
  const kept: string[] = [];
  let used = 0;
  for (const [key, label] of items) {
    const part = `${keycap(key, caps)} ${paint(caps, label, { tone: 'text' })}`, w = visibleWidth(part) + (kept.length ? gap.length : 0);
    if (used + w > width) break;
    kept.push(part); used += w;
  }
  return kept.join(gap);
}
// Two blocks side by side when both fit within `width`, otherwise stacked with a blank line.
export function columns(left: string[], right: string[], width: number, gap = 3): string[] {
  const leftWidth = Math.max(0, ...left.map(visibleWidth)), rightWidth = Math.max(0, ...right.map(visibleWidth));
  if (leftWidth + gap + rightWidth > width) return [...left, ...(left.length && right.length ? [''] : []), ...right];
  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) =>
    (padEnd(left[i] ?? '', leftWidth) + ' '.repeat(gap) + (right[i] ?? '')).trimEnd());
}
