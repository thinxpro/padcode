// Player Hub frame: welcome logo, status card, menu and controller footer, sized to the terminal.
import type { ScreenView } from './prompt.js';
import { formatGlyphs } from './glyphs.js';
import { safeText } from './ui.js';
import {
  center, contentWidth, dot, DIVIDER, fit, frame, hintBar, logo, logoArt, logoVariant, paint, rule, truncate, visibleWidth,
  type Caps, type DotState, type LogoVariant, type Row,
} from './tui/index.js';

export interface HubItem { label: string; detail?: string }
export interface HubModel {
  version: string;
  notice?: string | undefined;
  controller: { name?: string | undefined; transport: string; verified: boolean };
  agent?: string | undefined;
  voice?: string | undefined;
  items: HubItem[];
  tip?: string | undefined;
}
export const tagline = 'YOUR CONTROLLER. YOUR AGENT.';
interface Layout { variant: LogoVariant; tagline: boolean; tip: boolean; details: boolean; spacing: boolean }

function noticeState(notice: string): DotState {
  if (/FAILED|ERROR/.test(notice)) return 'error';
  if (/CANCELLED|UNCHANGED/.test(notice)) return 'warn';
  return 'active';
}
function statusRows(model: HubModel, caps: Caps, width: number): string[] {
  const { controller } = model;
  const field = (state: DotState, label: string, value: string, size: number) =>
    fit(`${dot(state, caps)} ${paint(caps, label.padEnd(10), { tone: 'muted' })}${paint(caps, safeText(value), { tone: 'text' })}`, size, caps.unicode ? '…' : '~');
  const link = `${controller.name ?? 'not selected'} ${caps.unicode ? '·' : '/'} ${controller.transport.toUpperCase()}`;
  const cells = [
    (size: number) => field(controller.name ? 'ok' : 'warn', 'PLAYER 1', link, size),
    (size: number) => field(model.agent ? 'ok' : 'warn', 'AGENT', model.agent ?? 'not selected', size),
    // A passed setup check is not a live connection status; say so.
    (size: number) => field(controller.verified ? 'ok' : 'warn', 'INPUT', controller.verified ? 'setup check passed' : 'UNVERIFIED', size),
    (size: number) => field(model.voice ? 'ok' : 'off', 'VOICE', model.voice ?? 'off', size),
  ];
  if (width < 56) return cells.map(cell => cell(width));
  const half = Math.floor((width - 3) / 2);
  return [0, 2].map(i => `${cells[i]!(half)}   ${cells[i + 1]!(width - 3 - half)}`);
}
function menuRows(model: HubModel, view: ScreenView, width: number, details: boolean): string[] {
  const { caps } = view, names = (text: string) => formatGlyphs(text, view.glyphs);
  const labelWidth = Math.max(...model.items.map(item => visibleWidth(names(item.label))));
  return model.items.map((item, i) => {
    const current = i === view.selected, label = names(item.label).padEnd(labelWidth);
    const marker = current ? paint(caps, caps.unicode ? '▶' : '>', { tone: 'accent', bold: true }) : ' ';
    const head = `${marker} ${paint(caps, String(i + 1), { tone: 'muted' })}  ${paint(caps, label, current ? { tone: 'brand', bold: true } : { tone: 'text' })}`;
    const room = width - visibleWidth(head) - 3;
    const detail = details && item.detail && room >= 8 ? `   ${paint(caps, truncate(names(item.detail), room, caps.unicode ? '…' : '~'), { tone: 'muted' })}` : '';
    return truncate(head + detail, width);
  });
}
function footer(model: HubModel, view: ScreenView, width: number): string[] {
  const { caps } = view, names = (text: string) => formatGlyphs(text, view.glyphs);
  const hints = hintBar([[names('{confirm}'), 'SELECT'], [names('{back}'), 'EXIT'], [caps.unicode ? 'D-PAD ↑↓' : 'D-PAD', 'MOVE'], [`1-${model.items.length}`, 'JUMP'], ['Q', 'QUIT']], width, caps);
  const ready = /^GAMEPAD READY/.test(view.status);
  const status = view.status ? truncate(`${dot(ready ? 'ok' : 'warn', caps)} ${paint(caps, safeText(view.status), { tone: 'muted' })}`, width, caps.unicode ? '…' : '~') : '';
  return [hints, status];
}
function framed(model: HubModel, view: ScreenView, width: number, layout: Layout): string[] {
  const { caps } = view, inner = width - 6;
  const art = logo(caps, layout.variant, view.shine).map(line => center(line, inner));
  const version = paint(caps, `v${model.version}`, { tone: 'muted' });
  const brand = layout.tagline ? [`${paint(caps, tagline, { tone: 'text', bold: true })}${' '.repeat(Math.max(1, inner - tagline.length - visibleWidth(version)))}${version}`] : [];
  const header: Row[] = [...(layout.spacing ? [''] : []), ...art, ...(layout.spacing && brand.length ? [''] : []), ...brand, DIVIDER, ...statusRows(model, caps, inner)];
  const lines = frame(header, { width, caps, title: 'PLAYER HUB', padding: 2 });
  const gap = layout.spacing ? [''] : [];
  if (model.notice) lines.push(...gap, `  ${dot(noticeState(model.notice), caps)} ${paint(caps, safeText(model.notice), { tone: 'text', bold: true })}`);
  lines.push(...gap, `  ${rule(width - 4, caps, `MENU ${view.selected + 1}/${model.items.length}`)}`, ...menuRows(model, view, width - 4, layout.details).map(line => `  ${line}`));
  if (view.flash) lines.push(`  ${paint(caps, view.flash, { tone: 'warn', bold: true })}`);
  if (layout.tip && model.tip) lines.push(...gap, `  ${paint(caps, formatGlyphs(model.tip, view.glyphs), { tone: 'muted' })}`);
  lines.push(`  ${rule(width - 4, caps)}`, ...footer(model, view, width - 4).map(line => `  ${line}`));
  return lines.map(line => truncate(line, width));
}
// Narrow or very short terminals: no frames, wordmark only, nothing but what is needed to choose.
function compact(model: HubModel, view: ScreenView, width: number): string[] {
  const { caps } = view;
  const lines = [
    truncate(`${logo(caps, 'wordmark', view.shine)[0]}  ${paint(caps, `v${model.version}`, { tone: 'muted' })}`, width),
    paint(caps, 'PLAYER HUB', { tone: 'brand', bold: true }),
    ...statusRows(model, caps, width),
    ...(model.notice ? [truncate(`${dot(noticeState(model.notice), caps)} ${paint(caps, safeText(model.notice), { tone: 'text', bold: true })}`, width)] : []),
    rule(width, caps, `MENU ${view.selected + 1}/${model.items.length}`),
    ...menuRows(model, view, width, false),
    ...(view.flash ? [paint(caps, view.flash, { tone: 'warn', bold: true })] : []),
  ];
  const tail = footer(model, view, width);
  // Keep the menu and the footer; cut status lines first when the terminal is very short.
  return [...lines.slice(Math.max(0, lines.length + tail.length - view.caps.height)), ...tail].slice(-Math.max(1, view.caps.height)).map(line => truncate(line, width));
}
export function renderHub(model: HubModel, view: ScreenView): string[] {
  const cols = Math.max(1, view.caps.width - 1), rows = view.caps.height;
  // Left-aligned like the shell and the inline screens, so moving between them never shifts the interface.
  const width = Math.min(cols, contentWidth(view.caps.width));
  let lines: string[] | undefined;
  if (width >= 40) {
    const best = logoVariant(view.caps, width - 6);
    const variants = (['full', 'ascii', 'wordmark'] as const).filter(v => logoArt[v][0]!.length <= logoArt[best][0]!.length);
    const layouts: Layout[] = variants.flatMap(variant => [
      { variant, tagline: true, tip: true, details: true, spacing: true },
      { variant, tagline: true, tip: false, details: true, spacing: false },
    ]);
    layouts.push({ variant: 'wordmark', tagline: false, tip: false, details: true, spacing: false });
    for (const layout of layouts) {
      const candidate = framed(model, view, width, layout);
      if (candidate.length <= rows) { lines = candidate; break; }
    }
  }
  return lines ?? compact(model, view, width);
}
