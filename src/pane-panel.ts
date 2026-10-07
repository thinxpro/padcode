// Internal status pane worker. It renders coordinator status and never reads keyboard input.
import { joinSession } from './session-ipc.js';
import { renderPanel } from './panel.js';
import { colorEnabled } from './ui.js';

const path = process.env.PADCODE_IPC, session = process.env.PADCODE_SESSION;
if (!path || !session) throw new Error('Status pane requires its private session channel.');
const output = process.stdout;
const color = colorEnabled(process.env, Boolean(output.isTTY));
let status = 'STARTING / Waiting for Agent', notice: string | undefined;
let noticeTimer: NodeJS.Timeout | undefined;
const draw = () => {
  const lines = renderPanel(status, output.columns || 80, output.rows || 2, color, notice);
  output.write(`\x1b[?25l\x1b[H${lines.map(line => `${line}\x1b[K`).join('\r\n')}\x1b[J`);
};
const peer = await joinSession(path, session, 'panel');
peer.onMessage(message => {
  if (message.t === 'status') status = message.text;
  else { notice = message.text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = undefined; draw(); }, 5000); }
  draw();
});
peer.onClose(() => process.exit(0));
output.on('resize', draw);
process.on('SIGHUP', () => process.exit(0));
draw();
