// Inline screens (setup wizard, launch confirmation, voice settings): banners, messages and menus.
// Every recognised phrase stays one contiguous styled span, so terminal searches still match it.
import { dot, frame, keycap, meter, paint, stepper, truncate, visibleWidth, wrapAnsi, type Caps, type DotState, type Tone } from './tui/index.js';

export type Progress = readonly [current: number, total: number];
const ellipsis = (caps: Caps) => caps.unicode ? '…' : '~';

export function renderBanner(title: string, caps: Caps, width: number, progress?: Progress): string[] {
  const inner = Math.max(1, width - 6);
  const steps = progress ? `${stepper(progress[0], progress[1], caps)} ${paint(caps, `${progress[0]}/${progress[1]}`, { tone: 'muted' })}` : '';
  const head = paint(caps, truncate(title, inner, ellipsis(caps)), { tone: 'brand', bold: true });
  const room = inner - visibleWidth(head) - visibleWidth(steps);
  // Steps share the title row when they fit, otherwise they take a row of their own.
  const rows = !steps ? [head] : room >= 2 ? [`${head}${' '.repeat(room)}${steps}`] : [head, steps];
  return ['', ...frame(rows, { width, caps, title: 'PADCODE', padding: 2 })];
}

interface Kind { state?: DotState; tone: Tone; bold?: boolean }
function classify(text: string): Kind {
  if (/\b(NOT READY|NOT VERIFIED|FAILED|STOPPED)\b/.test(text)) return { state: 'error', tone: 'danger', bold: true };
  if (/\b(PASSED|COMPLETE)\b|^Bluetooth connected/.test(text)) return { state: 'ok', tone: 'ok', bold: true };
  if (/UNVERIFIED|^NOTE\b|start PAUSED/.test(text)) return { state: 'warn', tone: 'warn' };
  if (/\.\.\.(\s|$)|^DOWNLOAD \d+%/.test(text)) return { state: 'active', tone: 'accent' };
  return { tone: 'text' };
}
// One message: status symbol or indent, an optional TAG column, then text wrapped with a hanging indent.
export function renderMessage(text: string, caps: Caps, width: number): string[] {
  if (!text) return [''];
  const kind = classify(text);
  const lead = kind.state ? `  ${dot(kind.state, caps)} ` : '  ', leadWidth = kind.state ? 4 : 2;
  const room = Math.max(4, width - leadWidth);
  // "TAG  value": the tag (with its spaces) is one span, the value another.
  const tagged = kind.state ? null : /^([A-Z][A-Z0-9-]+(?: [A-Z][A-Z0-9-]+)?)( {2,})(\S.*)$/.exec(text);
  if (tagged && tagged[1]!.length + tagged[2]!.length < room / 2) {
    const tag = tagged[1]! + tagged[2]!, value = wrapAnsi(tagged[3]!, Math.max(4, room - tag.length));
    return value.map((line, i) => `  ${i ? ' '.repeat(tag.length) : paint(caps, tag, { tone: 'brand', bold: true })}${paint(caps, line, { tone: 'text' })}`);
  }
  const download = /^DOWNLOAD (\d+)%/.exec(text);
  const lines = wrapAnsi(text, room).map((line, i) => `${i ? ' '.repeat(leadWidth) : lead}${paint(caps, line, { tone: kind.tone, bold: kind.bold ?? false })}`);
  const free = width - visibleWidth(lines[0]!) - 2;
  if (download && free >= 4) lines[0] += `  ${meter(Number(download[1]) / 100, Math.min(20, free), caps, 'accent')}`;
  return lines;
}

export function renderMenu(message: string, labels: string[], selected: number, status: string, caps: Caps, width: number): string[] {
  const room = Math.max(4, width - 4);
  const lines = wrapAnsi(message, room).map((line, i) => `${i ? '    ' : `  ${paint(caps, caps.unicode ? '◆' : '*', { tone: 'accent', bold: true })} `}${paint(caps, line, { tone: 'text', bold: true })}`);
  labels.forEach((label, i) => {
    const current = i === selected, number = String(i + 1);
    const marker = current ? paint(caps, caps.unicode ? '▶' : '>', { tone: 'accent', bold: true }) : ' ';
    const indent = 4 + number.length + 2, cut = label.indexOf(' / ');
    // Main part bright, detail after the first " / " dim; wrapped lines align under the label.
    const [main, detail] = cut > 0 ? [label.slice(0, cut), label.slice(cut)] : [label, ''];
    const full = main + detail;
    let pos = 0;
    wrapAnsi(full, Math.max(4, width - indent)).forEach((line, row) => {
      // Track where each wrapped row starts in the label (breaks drop one space) to colour main and detail.
      while (full[pos] === ' ' && line[0] !== ' ') pos++;
      const split = Math.max(0, Math.min(line.length, main.length - pos));
      pos += line.length;
      const body = paint(caps, line.slice(0, split), current ? { tone: 'brand', bold: true } : { tone: 'text' }) + paint(caps, line.slice(split), { tone: 'muted' });
      lines.push(row ? `${' '.repeat(indent)}${body}` : `  ${marker} ${paint(caps, number, { tone: 'muted' })}  ${body}`);
    });
  });
  if (status) wrapAnsi(status, room).forEach((line, i) => lines.push(`${i ? '    ' : `  ${dot(/^GAMEPAD READY/.test(status) ? 'ok' : 'warn', caps)} `}${paint(caps, line, { tone: 'muted' })}`));
  return lines;
}
export const selectLine = (index: number, caps: Caps) => `  ${paint(caps, `> Select [${index + 1}] (q to cancel):`, { tone: 'muted' })}`;
export function askHint(caps: Caps, width: number): string[] {
  const cap = keycap('KEYBOARD', caps, 'info'), indent = 3 + visibleWidth(cap);
  return wrapAnsi('Type text here; gamepad buttons do not enter text.', Math.max(4, width - indent))
    .map((line, i) => `${i ? ' '.repeat(indent) : `  ${cap} `}${paint(caps, line, { tone: 'muted' })}`);
}
export const askPrompt = (message: string, caps: Caps) => `  ${paint(caps, `> ${message}`, { tone: 'accent', bold: true })} `;
