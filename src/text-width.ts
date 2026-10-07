// Terminal column width for draft text: CJK, full-width forms and emoji take two columns.
export function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)) return 2;
  return 1;
}
export const displayWidth = (text: string) => [...text].reduce((sum, char) => sum + charWidth(char), 0);
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '', used = 0;
    for (const char of paragraph) {
      const w = charWidth(char);
      if (used + w > width && line) { lines.push(line); line = ''; used = 0; }
      line += char; used += w;
    }
    lines.push(line);
  }
  return lines;
}
// Keeps a draft preview within an IPC line: whole characters only, with a count of what was left out.
export function previewText(text: string, maxBytes = 2400): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let kept = '';
  for (const char of text) { if (Buffer.byteLength(kept + char) > maxBytes) break; kept += char; }
  return `${kept}\n(+${[...text].length - [...kept].length} more characters)`;
}
