// Internal controls popup. It renders coordinator menu state and reports keyboard actions; the coordinator owns all state.
import { joinSession, type ToMenu } from './session-ipc.js';
import { colorEnabled, safeLabel } from './ui.js';
import { wrapText } from './text-width.js';
import { renderControllerMap } from './controller-map.js';

const path = process.env.PADCODE_IPC, session = process.env.PADCODE_SESSION;
if (!path || !session) throw new Error('Controls popup requires its private session channel.');
const input = process.stdin, output = process.stdout;
const color = colorEnabled(process.env, Boolean(output.isTTY));
let view: Extract<ToMenu, { t: 'menu' }> | undefined;
const paint = (style: string, text: string) => color ? `${style}${text}\x1b[0m` : text;
const draw = () => {
  if (!view) return;
  const width = Math.max(10, (output.columns || 40) - 2);
  const fit = (text: string) => safeLabel(text).slice(0, width);
  const rows = output.rows || 12;
  const bodyRoom = Math.max(1, rows - view.items.length - 6);
  // Draft text keeps its Unicode; only the menu chrome is ASCII.
  // The controller map is drawn here from the profile; only two flags cross IPC.
  const wrapped = view.map ? renderControllerMap(view.map, width, color) : view.body === undefined ? [] : wrapText(view.body, width);
  const body = wrapped.length > bodyRoom ? [...wrapped.slice(0, bodyRoom - 1), paint('\x1b[2;37m', fit(`... ${wrapped.length - bodyRoom + 1} more lines`))] : wrapped;
  const lines = [paint('\x1b[1;96m', fit(view.title)), '', ...body, ...(body.length ? [''] : []),
    ...view.items.map((item, index) => index === view!.selected ? paint('\x1b[1;95m', fit(`> [${index + 1}] ${item}`)) : fit(`  [${index + 1}] ${item}`)),
    '', paint('\x1b[2;37m', fit(view.hint))];
  output.write(`\x1b[?25l\x1b[H${lines.map(line => ` ${line}\x1b[K`).join('\r\n')}\x1b[J`);
};
const peer = await joinSession(path, session, 'menu');
const quit = () => { try { input.setRawMode(false); } catch { /* Popup terminal already closed. */ } process.exit(0); };
peer.onMessage(message => { if (message.t === 'close') quit(); else { view = message; draw(); } });
peer.onClose(quit);
process.on('SIGHUP', quit);
output.on('resize', draw);
if (input.isTTY) input.setRawMode(true);
input.on('data', (chunk: Buffer) => {
  const text = chunk.toString('latin1');
  if (text === '\x1b[A' || text === '\x1bOA' || text === 'k') peer.send({ t: 'action', name: 'up' });
  else if (text === '\x1b[B' || text === '\x1bOB' || text === 'j') peer.send({ t: 'action', name: 'down' });
  else if (text === '\r' || text === '\n' || text === ' ') peer.send({ t: 'action', name: 'confirm' });
  else if (text === '\x1b' || text === 'q' || text === '\x03') peer.send({ t: 'action', name: 'back' });
  else if (/^[1-9]$/.test(text)) peer.send({ t: 'action', name: 'pick', index: Number(text) - 1 });
});
