// Every component on one page, for snapshot tests and manual review in real terminals (npm run gallery).
import type { Caps } from './caps.js';
import { gradient, paint, type Tone } from './theme.js';
import { center, truncate } from './text.js';
import { DIVIDER, frame, rule } from './box.js';
import { columns, dot, hintBar, keycap, meter, stepper } from './widgets.js';

export function renderGallery(caps: Caps): string[] {
  const width = Math.max(20, caps.width - 1);
  const tones: Tone[] = ['brand', 'accent', 'ok', 'warn', 'danger', 'info', 'text', 'muted'];
  const status = [
    `${dot('ok', caps)} PLAYER 1   linked`, `${dot('warn', caps)} INPUT      unverified`,
    `${dot('off', caps)} VOICE      off`, `${dot('error', caps)} HELPER     missing`, `${dot('active', caps)} SESSION    live`,
  ];
  const meters = [0, 0.33, 0.5, 0.875, 1].map(value => `${meter(value, 12, caps)} ${value.toFixed(2)}`);
  return [
    center(gradient(caps, 'P A D C O D E   T U I   G A L L E R Y'), width),
    '',
    rule(width, caps, 'TONES'),
    truncate(tones.map(tone => paint(caps, tone, { tone, bold: true })).join('  '), width),
    '',
    rule(width, caps, 'KEYCAPS + STEPPER'),
    truncate(`${keycap('X', caps)} ${keycap('O', caps, 'danger')} ${keycap('TRI', caps, 'ok')} ${keycap('SQ', caps, 'accent')}   MISSION 2/5 ${stepper(2, 5, caps)}`, width),
    '',
    ...frame([...status, DIVIDER, 'Unicode data: 한국어 カタカナ 🎮 keeps its width'], { width: Math.min(width, 56), caps, title: 'STATUS CARD' }),
    '',
    ...columns(meters, ['RIGHT COLUMN', 'stacks below the meters', 'when the terminal is narrow'], width),
    '',
    rule(width, caps),
    hintBar([['X', 'SELECT'], ['O', 'BACK'], ['D-PAD', 'MOVE'], ['OPTIONS', 'MENU'], ['Q', 'QUIT']], width, caps),
  ];
}
