// Controls popup (menus, voice draft, controller map). Row structure is fixed because panel-session.ts sizes the
// tmux popup from it: title, rule, [body, blank], items, blank, hint; or title, map, blank, hint.
import type { ToMenu } from './session-ipc.js';
import { safeLabel } from './ui.js';
import { wrapText } from './text-width.js';
import { renderControllerMap } from './controller-map.js';
import { paint, rule, truncate, type Caps } from './tui/index.js';

export type PopupView = Extract<ToMenu, { t: 'menu' }>;
export function renderPopup(view: PopupView, caps: Caps, rows: number): string[] {
  const width = Math.max(10, caps.width - 2);
  const fit = (text: string) => truncate(safeLabel(text), width, caps.unicode ? '…' : '~');
  const title = paint(caps, fit(view.title), { tone: 'brand', bold: true });
  const hint = paint(caps, fit(view.hint), { tone: 'muted' });
  const more = (count: number) => paint(caps, fit(`... ${count} more lines`), { tone: 'muted' });
  // The controller map shows no item list (its hint says how to leave): title, map, blank, hint.
  if (view.map) {
    const map = renderControllerMap(view.map, width, caps, Math.max(1, rows - 3));
    const shown = map.length > rows - 3 ? [...map.slice(0, Math.max(0, rows - 4)), more(map.length - rows + 4)] : map;
    return [title, ...shown, '', hint];
  }
  // Title, rule, body, blank, items, blank, hint: five rows besides the body and items.
  const bodyRoom = Math.max(1, rows - view.items.length - 5);
  // Draft text keeps its Unicode; only the menu chrome is ASCII-safe.
  const wrapped = view.body === undefined ? [] : wrapText(view.body, width);
  const body = wrapped.length > bodyRoom ? [...wrapped.slice(0, bodyRoom - 1), more(wrapped.length - bodyRoom + 1)] : wrapped;
  const marker = caps.unicode ? '▶' : '>';
  // The current item is one span, so "▶ 2  Pause gamepad mapping" stays searchable in the raw output.
  // Labels are sanitised to ASCII before the (possibly Unicode) marker is added.
  const items = view.items.map((item, index) => {
    const text = truncate(`${index === view.selected ? marker : ' '} ${index + 1}  ${safeLabel(item)}`, width, caps.unicode ? '…' : '~');
    return paint(caps, text, index === view.selected ? { tone: 'accent', bold: true } : { tone: 'text' });
  });
  // Long lists (Quick commands) scroll: a window around the selection, with the cut ends counted.
  const itemRoom = Math.max(3, rows - 4 - (body.length ? body.length + 1 : 0));
  if (items.length > itemRoom) {
    const start = Math.max(0, Math.min(view.selected - Math.floor(itemRoom / 2), items.length - itemRoom));
    const shown = items.slice(start, start + itemRoom), end = start + itemRoom;
    if (start > 0) shown[0] = paint(caps, fit(`  ... ${start + 1} more above`), { tone: 'muted' });
    if (end < items.length) shown[shown.length - 1] = paint(caps, fit(`  ... ${items.length - end + 1} more below`), { tone: 'muted' });
    return [title, rule(width, caps), ...body, ...(body.length ? [''] : []), ...shown, '', hint];
  }
  return [title, rule(width, caps), ...body, ...(body.length ? [''] : []), ...items, '', hint];
}
