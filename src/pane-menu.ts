// Internal controls popup. It renders coordinator menu state and reports keyboard actions; the coordinator owns all state.
import { joinSession, type ToMenu } from './session-ipc.js';
import { renderPopup } from './popup-view.js';
import { detectCaps } from './tui/index.js';

const path = process.env.PADCODE_IPC, session = process.env.PADCODE_SESSION;
if (!path || !session) throw new Error('Controls popup requires its private session channel.');
const input = process.stdin, output = process.stdout;
let view: Extract<ToMenu, { t: 'menu' }> | undefined;
const draw = () => {
  if (!view) return;
  const lines = renderPopup(view, detectCaps(process.env, output), output.rows || 12);
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
