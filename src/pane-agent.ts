// Internal Agent pane bridge. It owns the only Agent PTY writer; controller bytes arrive over private IPC.
import { joinSession, type Launch } from './session-ipc.js';
import { runAgent } from './agent-session.js';
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
let launch: (value: Launch) => void = () => {}, released: () => void = () => {};
const launched = new Promise<Launch>(resolve => { launch = resolve; });
const closed = new Promise<void>(resolve => { released = resolve; });
let running = false, exited = false;
peer.onMessage(message => {
  if (message.t === 'launch') launch(message.launch);
  else if (message.t === 'keys') keys(Buffer.from(message.data, 'base64'));
  else if (message.t === 'cancel') cancel();
  else released();
});
// A lost coordinator must not leave an unattended Agent behind.
peer.onClose(() => { released(); if (running && !exited) process.kill(process.pid, 'SIGTERM'); else if (!running) process.exit(1); });
process.on('SIGHUP', () => process.kill(process.pid, 'SIGTERM'));
const spec = await launched;
for (const [key, value] of Object.entries(spec.env)) { if (value === null) delete process.env[key]; else process.env[key] = value; }
running = true;
let code = 1;
try { code = await runAgent({ command: spec.command, args: spec.args }, { cwd: spec.cwd, gamepad: source, titleStatus: false }); }
catch (error) { process.stderr.write(`Padcode: ${(error as Error).message}\n`); }
exited = true;
peer.send({ t: 'exit', code });
await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10000))]);
peer.close();
process.exit(code);
