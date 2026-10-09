import type { Caps } from './caps.js';
import { paint, type Tone } from './theme.js';
import { fit, truncate, visibleWidth } from './text.js';

export type BorderName = 'round' | 'heavy' | 'ascii';
interface Border { tl: string; tr: string; bl: string; br: string; h: string; v: string; lt: string; rt: string }
const borders: Record<BorderName, Border> = {
  round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', lt: '├', rt: '┤' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', lt: '┣', rt: '┫' },
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', lt: '+', rt: '+' },
};
export const border = (caps: Caps, name: BorderName = 'round') => borders[caps.unicode ? name : 'ascii'];

// A row that draws a horizontal divider inside a frame.
export const DIVIDER: unique symbol = Symbol('divider');
export type Row = string | typeof DIVIDER;
export interface FrameOptions { width: number; caps: Caps; title?: string; tone?: Tone; padding?: number; border?: BorderName }

// Every returned line is exactly `width` columns (minimum 4).
export function frame(rows: Row[], options: FrameOptions): string[] {
  const { caps, tone = 'muted' } = options, b = border(caps, options.border);
  const width = Math.max(4, options.width), padding = Math.max(0, Math.min(options.padding ?? 1, Math.floor((width - 3) / 2)));
  const inner = width - 2, content = inner - padding * 2;
  const edge = (text: string) => paint(caps, text, { tone });
  let top = edge(b.tl + b.h.repeat(inner) + b.tr);
  if (options.title && inner >= 5) {
    const title = truncate(options.title, inner - 4, caps.unicode ? '…' : '~');
    top = edge(b.tl + b.h) + ' ' + paint(caps, title, { tone: 'brand', bold: true }) + ' ' + edge(b.h.repeat(inner - 3 - visibleWidth(title)) + b.tr);
  }
  const body = rows.map(row => row === DIVIDER ? edge(b.lt + b.h.repeat(inner) + b.rt)
    : edge(b.v) + ' '.repeat(padding) + fit(row, content, caps.unicode ? '…' : '~') + ' '.repeat(padding) + edge(b.v));
  return [top, ...body, edge(b.bl + b.h.repeat(inner) + b.br)];
}
// A full-width horizontal rule, optionally labelled: ── LABEL ─────
export function rule(width: number, caps: Caps, label?: string, tone: Tone = 'muted'): string {
  const h = border(caps).h, size = Math.max(0, width);
  if (!label || size < 6) return paint(caps, h.repeat(size), { tone });
  const text = truncate(label, size - 4, caps.unicode ? '…' : '~');
  return paint(caps, h.repeat(2), { tone }) + ' ' + paint(caps, text, { tone: 'text', bold: true }) + ' ' + paint(caps, h.repeat(size - 4 - visibleWidth(text)), { tone });
}
