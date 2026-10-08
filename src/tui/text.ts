import { charWidth } from '../text-width.js';
import { reset } from './theme.js';
// Width-aware text helpers that skip ANSI escape sequences when measuring.
const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const token = new RegExp(`(${ansi.source})|([\\s\\S])`, 'gu');

export const stripAnsi = (text: string) => text.replace(ansi, '');
export const visibleWidth = (text: string) => [...stripAnsi(text)].reduce((sum, char) => sum + charWidth(char), 0);

// Cuts to at most `width` columns without splitting a wide character; styles are kept and closed.
export function truncate(text: string, width: number, ellipsis = ''): string {
  if (visibleWidth(text) <= width) return text;
  const room = Math.max(0, width - visibleWidth(ellipsis));
  // Escapes are held until a character follows them, so a cut never leaves an empty styled span.
  let out = '', used = 0, styled = false, pending = '';
  for (const [, escape, char] of text.matchAll(token)) {
    if (escape) { pending += escape; continue; }
    const w = charWidth(char!);
    if (used + w > room) break;
    if (pending) { out += pending; styled = true; pending = ''; }
    out += char; used += w;
  }
  const tail = width >= visibleWidth(ellipsis) ? ellipsis : '';
  return `${out}${styled ? reset : ''}${tail}`;
}
export const padEnd = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
export const padStart = (text: string, width: number) => ' '.repeat(Math.max(0, width - visibleWidth(text))) + text;
export function center(text: string, width: number): string {
  const room = Math.max(0, width - visibleWidth(text)), left = Math.floor(room / 2);
  return ' '.repeat(left) + text + ' '.repeat(room - left);
}
// Exactly `width` columns: truncated with an ellipsis, then padded.
export const fit = (text: string, width: number, ellipsis = '') => padEnd(truncate(text, width, ellipsis), width);

// Wraps on spaces where possible, otherwise by column; styles do not carry across lines.
export function wrapAnsi(text: string, width: number): string[] {
  const size = Math.max(1, width), lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '', used = 0, space = -1;
    for (const [, escape, char] of paragraph.matchAll(token)) {
      if (escape) { line += escape; continue; }
      const w = charWidth(char!);
      if (used + w > size && used > 0) {
        if (space >= 0 && char !== ' ') { lines.push(line.slice(0, space)); line = line.slice(space + 1); used = visibleWidth(line); }
        if (space < 0 || char === ' ' || (used > 0 && used + w > size)) { lines.push(line); line = ''; used = 0; }
        space = -1;
        if (char === ' ') continue;
      }
      if (char === ' ') space = line.length;
      line += char; used += w;
    }
    lines.push(line);
  }
  return lines.map(line => line.trimEnd());
}
