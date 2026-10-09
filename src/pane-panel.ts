// Internal status pane worker. It renders coordinator status and never reads keyboard input.
import { joinSession } from './session-ipc.js';
import { renderPanel } from './panel.js';
import { detectCaps } from './tui/index.js';
import type { Glyphs } from './glyphs.js';

const path = process.env.PADCODE_IPC, session = process.env.PADCODE_SESSION;
if (!path || !session) throw new Error('Status pane requires its private session channel.');
const output = process.stdout;
let status = 'STARTING / Waiting for Agent', notice: string | undefined, names: Glyphs = { family: 'standard' };
let noticeTimer: NodeJS.Timeout | undefined;
const draw = () => {
  const lines = renderPanel(status, detectCaps(process.env, output), output.rows || 2, notice, names);
  output.write(`\x1b[?25l\x1b[H${lines.map(line => `${line}\x1b[K`).join('\r\n')}\x1b[J`);
};
const peer = await joinSession(path, session, 'panel');
peer.onMessage(message => {
  if (message.t === 'status') status = message.text;
  else if (message.t === 'names') names = { family: message.family, swap: message.swap };
  else { notice = message.text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = undefined; draw(); }, 5000); }
  draw();
});
peer.onClose(() => process.exit(0));
output.on('resize', draw);
process.on('SIGHUP', () => process.exit(0));
draw();
