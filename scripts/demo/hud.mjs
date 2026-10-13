#!/usr/bin/env node
// Bottom pane of the scripted demo: the simulated button just pressed and a caption. The label always says
// the input is virtual. Usage: hud.mjs <demo directory>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hudLabel } from './timeline.mjs';

const path = join(process.argv[2], 'hud.json');
const color = process.env.NO_COLOR === undefined;
const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
const width = () => process.stdout.columns || 80;
const fit = (text, size) => text.length > size ? `${text.slice(0, Math.max(0, size - 1))}…` : text;

// Row one: the caption and the button just pressed. Row two: the label that marks the input as simulated.
function renderHud(state, columns, now = Date.now()) {
  const lit = state.button && (state.holding || now - state.at < 700);
  const chip = state.button ? ` ${state.button} ` : '';
  const caption = fit(state.caption ?? '', Math.max(0, columns - chip.length - 3));
  const first = ` ${paint('1', caption)}${' '.repeat(Math.max(0, columns - caption.length - chip.length - 2))}${chip ? (lit ? paint('1;30;43', chip) : paint('2;7', chip)) : ''}`;
  const second = color ? paint('1;30;46', ` ${hudLabel} `) : ` [${hudLabel}]`;
  return `\x1b[H\x1b[2K${first}\r\n\x1b[2K${second}`;
}

let last = '';
function draw() {
  let state = {};
  try { state = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  const frame = renderHud(state, width());
  if (frame !== last) { process.stdout.write(frame); last = frame; }
}
process.stdout.write('\x1b[?25l\x1b[2J');
setInterval(draw, 50);
process.stdout.on('resize', () => { last = ''; process.stdout.write('\x1b[2J'); draw(); });
