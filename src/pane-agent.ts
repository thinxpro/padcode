// Internal Agent pane bridge. It owns the only Agent PTY writer; controller bytes arrive over private IPC.
import { joinSession, type Launch } from './session-ipc.js';
import { runAgent, type InputTap } from './agent-session.js';
import type { ControllerSource } from './agent-gamepad.js';

const path = process.env.PADCODE_IPC, session = process.env.PADCODE_SESSION;
if (!path || !session) throw new Error('Agent pane requires its private session channel.');
delete process.env.PADCODE_IPC; delete process.env.PADCODE_SESSION;
const peer = await joinSession(path, session, 'agent');
let keys: (bytes: Buffer) => void = () => {}, cancel = () => {};
const source: ControllerSource = {
  subscribe(onKeys, _status, onCancel) { keys = onKeys; cancel = onCancel; return () => { keys = () => {}; cancel = () => {}; }; },
  start: async () => {}, suspend: () => {}, stop: async () => {},
};
// Voice text: tracks the Agent's bracketed-paste mode and whether anything else reached it since the last paste.
let write: (bytes: Buffer) => void = () => {}, bracketed = false, tail = '', clean = false, pasted = '';
const tap: InputTap = {
  attach: writer => { write = writer; },
  input: () => { clean = false; },
  output: data => {
    const text = tail + data.toString('latin1');
    const on = text.lastIndexOf('\x1b[?2004h'), off = text.lastIndexOf('\x1b[?2004l');
    if (on !== -1 || off !== -1) bracketed = on > off;
    tail = text.slice(-7);
  },
};
const paste = (text: string) => {
  const body = Buffer.from(text);
  write(bracketed ? Buffer.concat([Buffer.from('\x1b[200~'), body, Buffer.from('\x1b[201~')]) : body);
  clean = true;
};
const undo = (count: number) => {
  if (!clean) { peer.send({ t: 'undo-result', ok: false, reason: 'input' }); return; }
  clean = false;
  write(Buffer.alloc(count, 0x7f));
  peer.send({ t: 'undo-result', ok: true, reason: '' });
};
let launch: (value: Launch) => void = () => {}, released: () => void = () => {};
const launched = new Promise<Launch>(resolve => { launch = resolve; });
const closed = new Promise<void>(resolve => { released = resolve; });
let running = false, exited = false;
peer.onMessage(message => {
  if (message.t === 'launch') launch(message.launch);
  else if (message.t === 'keys') keys(Buffer.from(message.data, 'base64'));
  else if (message.t === 'cancel') cancel();
  else if (message.t === 'paste-part') { if (running && !exited && pasted.length + message.text.length <= 70000) pasted += message.text; }
  else if (message.t === 'paste-end') { if (running && !exited && pasted) paste(pasted); pasted = ''; }
  else if (message.t === 'undo') { if (running && !exited) undo(message.count); else peer.send({ t: 'undo-result', ok: false, reason: 'exited' }); }
  else released();
});
// A lost coordinator must not leave an unattended Agent behind.
peer.onClose(() => { released(); if (running && !exited) process.kill(process.pid, 'SIGTERM'); else if (!running) process.exit(1); });
process.on('SIGHUP', () => process.kill(process.pid, 'SIGTERM'));
const spec = await launched;
for (const [key, value] of Object.entries(spec.env)) { if (value === null) delete process.env[key]; else process.env[key] = value; }
running = true;
let code = 1;
try { code = await runAgent({ command: spec.command, args: spec.args }, { cwd: spec.cwd, gamepad: source, titleStatus: false, tap }); }
catch (error) { process.stderr.write(`Padcode: ${(error as Error).message}\n`); }
exited = true;
peer.send({ t: 'exit', code });
await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10000))]);
peer.close();
process.exit(code);
