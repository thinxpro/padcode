import { mkdtemp, writeFile, chmod, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connect } from 'node:net';
import { hostChannel } from '../dist/host-channel.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { runAgent, confirmAgent, restoreTerminal } from '../dist/agent-session.js';
import { PtyWriter } from '../dist/pty-writer.js';
process.env.TERM = 'xterm-256color';
const python = spawnSync('which', ['python3'], { encoding: 'utf8' }).stdout.trim();
const fixture = resolve('test/fixtures/pty-agent.py');
function terminal({ delay = 0, stallTimeout = 10000, fail = false } = {}) {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
  input.setRawMode = raw => { input.isRaw = raw; };
  const chunks = [];
  const output = new Writable({ highWaterMark: 4096, write(data, _, cb) { chunks.push(Buffer.from(data)); setTimeout(() => cb(fail ? new Error('fixture output failure') : undefined), delay); } });
  output.isTTY = true; output.columns = 91; output.rows = 29;
  return { input, output, stallTimeout, text: () => Buffer.concat(chunks).toString() };
}
async function until(fn) {
  const deadline = Date.now() + 7000;
  while (!fn()) { if (Date.now() > deadline) throw new Error('Fixture timed out'); await new Promise(r => setTimeout(r, 10)); }
}
const agent = mode => ({ command: python, args: [fixture, mode] });

test('launch confirmation is explicit, previews literal args/project and defaults to cancel', async () => {
  const lines = []; let defaultSelection;
  const io = { banner: t => lines.push(t), say: t => lines.push(t), choose: async (_, choices, selected) => { defaultSelection = selected; return choices[selected].value; } };
  assert.equal(await confirmAgent(io, { command: python, args: ['a b', '$(touch nope)'] }, '/tmp/project'), false);
  assert.equal(defaultSelection, 1); assert.match(lines.join('\n'), /\$\(touch nope\)/); assert.match(lines.join('\n'), /PROJECT \/tmp\/project/);
  assert.equal(await confirmAgent({ ...io, choose: async () => 'start' }, agent('basic'), '/tmp'), true);
  await assert.rejects(confirmAgent(io, { command: '/missing/agent', args: [] }, '/tmp'), /unavailable/);
});
test('actual PTY preserves args, cwd, environment, bytes, screen controls, resize and exit status', async () => {
  const t = terminal(); process.env.PADCODE_PTY_FIXTURE = 'inherited';
  const task = runAgent({ command: python, args: [fixture, 'basic', 'a b', '$(echo literal)', 'é🎮'] }, { ...t, cwd: '/private/tmp' === process.cwd() ? process.cwd() : '/tmp' });
  try {
    await until(() => t.text().includes('INFO:'));
    const info = JSON.parse(t.text().match(/INFO:([^\n]+)/)[1]);
    assert.deepEqual(info.tty, [true,true,true]); assert.deepEqual(info.args, ['a b', '$(echo literal)', 'é🎮']);
    assert.match(info.cwd, /\/tmp$/); assert.equal(info.env, 'inherited'); assert.deepEqual(info.size, [91,29]);
    await until(() => t.text().includes('\x1b[6n')); assert.ok(t.text().includes('\x1b[?1049h\x1b[31mCOLOR'));
    const bytes = Buffer.from('é🎮\x1b[A\x1b[12;4R\x03'); t.input.write(bytes);
    await until(() => t.text().includes('BYTES:' + bytes.toString('hex')));
    t.output.columns = 120; t.output.rows = 40; t.output.emit('resize');
    await until(() => t.text().includes('SIZE:[120, 40]'));
    t.input.write('exit!'); assert.equal(await task, 23); assert.equal(t.input.isRaw, false); assert.ok(t.text().includes('FINAL')); assert.ok(t.text().endsWith(restoreTerminal));
  } finally { delete process.env.PADCODE_PTY_FIXTURE; t.input.end(); await task.catch(() => {}); }
});
test('slow output drains the complete final tail after child exit', async () => {
  const t = terminal({ delay: 5 });
  assert.equal(await runAgent(agent('tail'), t), 17);
  assert.equal((t.text().match(/Z/g) ?? []).length, 524288); assert.ok(t.text().includes('FINAL_TAIL')); assert.equal(t.input.isRaw, false);
});
test('emergency escape terminates an ignoring process group and restores terminal', async () => {
  const t = terminal(); const task = runAgent(agent('group'), t);
  await until(() => t.text().includes('GROUP:'));
  const pids = t.text().match(/GROUP:(\d+):(\d+)/).slice(1).map(Number);
  t.input.write(Buffer.from([29])); assert.equal(await task, 130);
  for (const pid of pids) {
    const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    assert.ifError(result.error);
    const state = result.stdout.trim();
    assert.ok(!state || state.startsWith('Z'), `process ${pid} survived: ${state}`);
  }
  assert.equal(t.input.isRaw, false);
});
test('input EOF stops session and restores previous raw state', async () => {
  const t = terminal(); t.input.isRaw = true; const task = runAgent(agent('stall'), t);
  await until(() => t.text().includes('READY')); t.input.end(); assert.equal(await task, 130); assert.equal(t.input.isRaw, true);
});
test('terminal output errors stop the agent and restore raw mode', async () => {
  const t = terminal({ fail: true }); await assert.rejects(runAgent(agent('tail'), t), /fixture output failure/); assert.equal(t.input.isRaw, false);
});
test('bounded input rejects overflow and stalled PTY consumers', async () => {
  const t = terminal({ stallTimeout: 150 }); const task = runAgent(agent('stall'), t);
  await until(() => t.text().includes('READY')); t.input.write(Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(task, /exceeded/); assert.equal(t.input.isRaw, false);
  const u = terminal({ stallTimeout: 150 }); const blocked = runAgent(agent('stall'), u);
  await until(() => u.text().includes('READY')); u.input.write(Buffer.alloc(512 * 1024, 65));
  await assert.rejects(blocked, /input stalled/); assert.equal(u.input.isRaw, false);
});
test('non-TTY and missing executable fail before entering raw mode', async () => {
  await assert.rejects(runAgent(agent('basic')), /interactive terminal/);
  const t = terminal(); await assert.rejects(runAgent({ command: '/missing/agent', args: [] }, t), /unavailable/); assert.equal(t.input.isRaw, false);
});
test('PTY writer reports descriptor failures without retaining queued input', async () => {
  const events = new PassThrough({ objectMode: true }); const w = new PtyWriter(999999, () => {}, () => {}, e => events.emit('failure', e));
  const failure = once(events, 'failure'); w.push(Buffer.from('test')); assert.match((await failure)[0].message, /EBADF/); w.close(); w.push(Buffer.from('ignored'));
});

test('output stall has a bounded failure path even when write callbacks never arrive', async () => {
  const t = terminal({ stallTimeout: 100 });
  t.output = new Writable({ highWaterMark: 1, write() {} }); t.output.isTTY = true;
  await assert.rejects(runAgent(agent('tail'), t), /output stalled/); assert.equal(t.input.isRaw, false);
});
test('native spawn failure leaves terminal modes untouched', async () => {
  const t = terminal(); await runAgent(agent('basic'), { ...t, cwd: '/missing-padcode-project' }).then(code => assert.notEqual(code, 0), error => assert.match(error.message, /cwd|directory|posix_spawn|forkpty|chdir/i)); assert.equal(t.input.isRaw, false);
});
test('real outer terminal confirms launch, forwards Ctrl+C and restores flags on every exit route', { timeout: 30000 }, () => {
  const result = spawnSync('python3', ['test/agent_pty.py'], { encoding: 'utf8', timeout: 25000, env: { ...process.env, PADCODE_NODE: process.execPath } });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
});

test('private host lifecycle channel is bounded and removes its socket directory', async () => {
  const channel = await hostChannel(); const peer = connect(channel.path);
  try {
    await once(peer, 'connect');
    assert.equal((await stat(dirname(channel.path))).mode & 0o777, 0o700);
    let ended = 0; channel.onExit(() => ended++);
    peer.write('exit'); peer.write('ed\n'); await until(() => ended === 1);
    const received = once(peer, 'data'); channel.acknowledge(); assert.equal((await received)[0].toString(), 'drained\n');
    const closed = once(peer, 'close'); peer.write('x'.repeat(100)); await closed;
  } finally { peer.destroy(); await channel.close(); }
  await assert.rejects(access(dirname(channel.path)), { code: 'ENOENT' });
});
test('host reports an executable with a missing interpreter as failed launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pc-bad-exec-'));
  try {
    const command = join(root, 'agent'); await writeFile(command, '#!/missing-padcode-interpreter\n'); await chmod(command, 0o755);
    const t = terminal(); assert.equal(await runAgent({ command, args: [] }, t), 1); assert.match(t.text(), /Agent launch failed/); assert.equal(t.input.isRaw, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('continuous descendant output after Agent exit hits the explicit final-drain deadline', async () => {
  const t = terminal({ delay: 1, stallTimeout: 200 });
  await assert.rejects(runAgent(agent('descendant'), t), /final output did not drain/); assert.equal(t.input.isRaw, false);
});
