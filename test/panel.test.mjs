import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { SessionServer, joinSession, LineReader, parseHello, parseToAgent, parseToPanel, parseFromAgent } from '../dist/session-ipc.js';
import { renderPanel } from '../dist/panel.js';
import { stripAnsi } from '../dist/tui/index.js';
import { chooseDisplay, supportedTmux, clientEnv } from '../dist/tmux.js';
import { tmuxConfig } from '../dist/panel-session.js';
import { confirmAgent } from '../dist/agent-session.js';

const token = 'a'.repeat(32);
async function server() {
  const directory = await mkdtemp(join(tmpdir(), 'pc-ipc-'));
  const ipc = await SessionServer.listen(join(directory, 'i'));
  return { ipc, path: join(directory, 'i'), close: async () => { await ipc.close(); await rm(directory, { recursive: true, force: true }); } };
}
async function raw(path, lines) {
  const socket = connect(path); await once(socket, 'connect');
  for (const line of lines) socket.write(line);
  await Promise.race([once(socket, 'close'), new Promise(resolve => setTimeout(resolve, 300))]);
  const closed = socket.destroyed || socket.readableEnded; socket.destroy(); return closed;
}

test('C2-A1 IPC schema accepts only exact, bounded messages', () => {
  assert.equal(parseHello(JSON.stringify({ t: 'hello', role: 'agent', session: token }), token), 'agent');
  for (const bad of [{ t: 'hello', role: 'agent', session: 'b'.repeat(32) }, { t: 'hello', role: 'shell', session: token }, { t: 'hello', role: 'panel', session: token, extra: 1 }, ['hello']]) {
    assert.throws(() => parseHello(JSON.stringify(bad), token));
  }
  assert.throws(() => parseHello('{not json', token));
  assert.deepEqual(parseToAgent(JSON.stringify({ t: 'keys', data: Buffer.from('\x1b[A').toString('base64') })), { t: 'keys', data: 'G1tB' });
  assert.throws(() => parseToAgent(JSON.stringify({ t: 'keys', data: Buffer.alloc(65).toString('base64') })));
  assert.throws(() => parseToAgent(JSON.stringify({ t: 'keys', data: '' })));
  assert.throws(() => parseToAgent(JSON.stringify({ t: 'keys', data: 'not base64!' })));
  assert.throws(() => parseToAgent(JSON.stringify({ t: 'launch', launch: { command: '/bin/sh', args: [], cwd: '/', env: { PATH: '/evil' } } })));
  assert.deepEqual(parseToAgent(JSON.stringify({ t: 'launch', launch: { command: '/bin/sh', args: ['a b', ';'], cwd: '/', env: { TMUX: null } } })).launch.args, ['a b', ';']);
  assert.throws(() => parseToAgent(JSON.stringify({ t: 'status', text: 'x' })));
  assert.throws(() => parseToPanel(JSON.stringify({ t: 'status', text: 'x'.repeat(257) })));
  assert.deepEqual(parseFromAgent('{"t":"exit","code":23}'), { t: 'exit', code: 23 });
  for (const code of [-1, 256, 1.5, '1']) assert.throws(() => parseFromAgent(JSON.stringify({ t: 'exit', code })));
  const reader = new LineReader();
  assert.deepEqual(reader.push('{"a":1}\n{"b"'), ['{"a":1}']);
  assert.throws(() => reader.push('x'.repeat(4097)));
});

test('C2-A1 session server rejects stale, duplicate, malformed and wrong-role peers', async () => {
  const s = await server();
  try {
    const exits = [];
    s.ipc.on('exit', code => exits.push(code));
    assert.equal(await raw(s.path, [JSON.stringify({ t: 'hello', role: 'agent', session: token }) + '\n']), true, 'stale session accepted');
    assert.equal(await raw(s.path, ['garbage\n']), true);
    assert.equal(await raw(s.path, ['x'.repeat(5000)]), true);
    const agent = await joinSession(s.path, s.ipc.token, 'agent');
    const messages = []; agent.onMessage(message => messages.push(message));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(s.ipc.connected('agent'), true);
    assert.equal(await raw(s.path, [JSON.stringify({ t: 'hello', role: 'agent', session: s.ipc.token }) + '\n']), true, 'duplicate agent accepted');
    const panel = connect(s.path); await once(panel, 'connect');
    panel.write(JSON.stringify({ t: 'hello', role: 'panel', session: s.ipc.token }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(s.ipc.connected('panel'), true);
    panel.write(JSON.stringify({ t: 'exit', code: 0 }) + '\n'); await once(panel, 'close');
    assert.equal(s.ipc.connected('panel'), false); assert.deepEqual(exits, []);
    s.ipc.send('agent', { t: 'keys', data: 'G1tB' }); s.ipc.send('agent', { t: 'cancel' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(messages, [{ t: 'keys', data: 'G1tB' }, { t: 'cancel' }]);
    agent.send({ t: 'exit', code: 7 }); agent.send({ t: 'exit', code: 8 });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(exits, [7]); assert.equal(s.ipc.connected('agent'), false, 'duplicate exit tolerated');
    const late = await joinSession(s.path, s.ipc.token, 'agent'); let closed = false; late.onClose(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(closed, true, 'a second Agent pane joined after exit');
  } finally { await s.close(); }
});

test('C2-A2 / UI-4 S1 status pane renders every state within narrow widths, with its symbol, in every mode', () => {
  const mono = { color: 0, unicode: true, motion: false, width: 80, height: 2 }, ascii = { ...mono, unicode: false }, truecolor = { ...mono, color: 24 };
  const states = [['ACTIVE / Options to pause', '●', '*'], ['ARMING / Release buttons', '▲', '!'], ['PAUSED / Options to enable', '▲', '!'], ['HISTORY / Wheel or q returns; gamepad held', '▲', '!'],
    ['DISCONNECTED / Reconnect then Options', '✕', 'x'], ['RECONNECTED / Options to enable', '▲', '!'], ['INPUT LOST / Keyboard available', '✕', 'x'], ['UNAVAILABLE / Keyboard available', '✕', 'x'],
    ['MENU / Choose', '◆', '+'], ['REC / Release to stop', '◆', '+'], ['END SESSION? / Confirm', '✕', 'x'], ['STARTING / Waiting', '○', 'o']];
  for (const [status, symbol, asciiSymbol] of states) {
    const state = status.split(' / ')[0];
    for (const c of [mono, ascii, truecolor]) for (const width of [20, 32, 48, 80, 140]) for (const rows of [1, 2]) {
      const lines = renderPanel(status, { ...c, width }, rows);
      assert.equal(lines.length, rows);
      for (const line of lines) assert.ok(stripAnsi(line).length <= width, `${status} at ${width}: ${line}`);
      const first = stripAnsi(lines[0]);
      assert.ok(first.includes(`GAMEPAD ${state}`) || (width < 32 && first.includes('GAMEPAD')), `${state} at ${width}: ${first}`);
      assert.ok(first.includes(c.unicode ? symbol : asciiSymbol), `${state} symbol`);
      if (width >= 48) { assert.ok(first.startsWith('PADCODE '), first); assert.ok(first.endsWith('CTRL+] END'), first); }
      if (!c.color) assert.ok(!lines.join('').includes('\x1b'));
      if (c === ascii) assert.ok(/^[\x20-\x7e]*$/.test(lines.join('')));
    }
    // GAMEPAD <STATE> is one span in colour, so pane captures and searches still match it.
    assert.ok(renderPanel(status, { ...truecolor, width: 80 }, 2)[0].includes(`GAMEPAD ${state}`));
    assert.equal(stripAnsi(renderPanel(status, { ...truecolor, width: 80 }, 2)[0]), renderPanel(status, { ...mono, width: 80 }, 2)[0]);
  }
  // CTRL+] END outlasts the detail.
  assert.match(renderPanel('ACTIVE / Options to pause', { ...mono, width: 40 }, 1)[0], /GAMEPAD ACTIVE +CTRL\+\] END$/);
  assert.match(renderPanel('ACTIVE / Options to pause', { ...mono, width: 80 }, 1)[0], /OPTIONS TO PAUSE │ CTRL\+\] END$/);
  assert.match(renderPanel('ACTIVE / x', { ...ascii, width: 200 }, 2)[1], /\[D-PAD\] ARROWS {2}\[X\] ENTER {2}\[O\] ESC {2}\[L1\] TAB {2}\[R1\] SHIFT\+TAB {2}\[OPTIONS\] MENU {2}\[STICKS\] CURSOR {2}\[SQ\] BKSP {2}\[WHEEL\] HISTORY/);
  assert.match(renderPanel('ACTIVE / x', { ...truecolor, width: 200 }, 2)[1], /\x1b\[1;7;38;2;128;134;150m X \x1b\[0m/);
  assert.match(renderPanel('ACTIVE / x', { ...mono, width: 80 }, 2, 'VOICE / Draft inserted')[1], /^▲ VOICE \| DRAFT INSERTED$/);
  assert.ok(!renderPanel('ACTIVE / \x1b]0;evil\x07', { ...mono, width: 80 }, 2).join('').includes('\x1b'));
});

test('C2-A3 display selection falls back with recovery text and never installs tmux', async () => {
  const found = { find: async () => '/opt/tmux', version: async () => 'tmux 3.7c\n' };
  assert.deepEqual(await chooseDisplay({ TERM: 'xterm-256color' }, found), { kind: 'panel', tmux: '/opt/tmux', version: 'tmux 3.7c' });
  const reason = async (env, probe) => (await chooseDisplay(env, probe)).reason;
  assert.match(await reason({ TERM: 'xterm' }, { find: async () => null }), /not found.*brew install tmux/);
  assert.match(await reason({ TERM: 'xterm' }, { ...found, version: async () => 'tmux 3.1c' }), /not supported/);
  assert.match(await reason({ TERM: 'xterm' }, { ...found, version: async () => 'garbage' }), /not supported/);
  assert.match(await reason({ TERM: 'xterm' }, { ...found, version: async () => { throw new Error('boom'); } }), /did not report/);
  assert.match(await reason({ TERM: 'xterm', PADCODE_PANEL: 'off' }, found), /PADCODE_PANEL=off/);
  assert.match(await reason({ TERM: 'dumb' }, found), /TERM=dumb/);
  for (const [version, ok] of [['tmux 3.2', true], ['tmux 3.2a', true], ['tmux next-3.6', true], ['tmux 4.0', true], ['tmux openbsd-7.5', true], ['tmux 3.1c', false], ['tmux 2.9', false], ['tmux master', false]]) assert.equal(supportedTmux(version), ok, version);
  assert.deepEqual(clientEnv({ TMUX: '/x,1,0', TMUX_PANE: '%3', HOME: '/h' }), { HOME: '/h' });
});

test('private tmux config clears key tables and binds mouse only for the Agent pane', () => {
  const config = tmuxConfig('darwin', true);
  for (const line of ['set -g status off', 'set -g prefix None', 'unbind -a -T prefix', 'unbind -a -T root', 'set -g mouse on', "set -s copy-command 'pbcopy'"]) assert.ok(config.includes(line), line);
  assert.ok(config.indexOf('unbind -a -T root') < config.indexOf('bind -n WheelUpPane'));
  for (const line of config.split('\n').filter(line => line.startsWith('bind'))) assert.match(line, /pane_input_off/);
  assert.ok(!tmuxConfig('linux', false).includes('pbcopy')); assert.ok(tmuxConfig('linux', false).includes("pane-border-style 'default'"));
});

test('launch confirmation states the display mode and recovery path', async () => {
  const lines = []; const io = { banner: t => lines.push(t), say: t => lines.push(t), choose: async () => 'cancel' };
  const agent = { command: process.execPath, args: [] };
  await confirmAgent(io, agent, '/tmp', { kind: 'panel', tmux: '/opt/tmux', version: 'tmux 3.7c' });
  assert.match(lines.join('\n'), /DISPLAY \/ Controls pane \(tmux 3\.7c\)/); assert.match(lines.join('\n'), /\{menu\} controls menu/); assert.doesNotMatch(lines.join('\n'), /terminal title/);
  lines.length = 0;
  await confirmAgent(io, agent, '/tmp', { kind: 'transparent', reason: 'tmux was not found. Install tmux 3.2+ (brew install tmux, or apt install tmux) for the controls pane.' });
  assert.match(lines.join('\n'), /DISPLAY \/ Transparent\. tmux was not found/); assert.match(lines.join('\n'), /terminal title/);
});
