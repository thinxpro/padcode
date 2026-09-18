import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
const cli = args => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', timeout: 5000 });
test('help/version/invalid arguments and non-TTY dashboard', () => {
  for (const args of [[], ['--help'], ['-h']]) { const r = cli(args); assert.equal(r.status, 0); assert.match(r.stdout, /P A D C O D E/); assert.ok(!r.stdout.includes('\x1b')); }
  assert.match(cli(['--version']).stdout, /^0\.1\.0-dev\.1\n$/);
  for (const args of [['bad'], ['demo', '--json'], ['controllers', '--bad'], ['--help', 'extra']]) assert.equal(cli(args).status, 2);
  for (const cmd of ['controllers', 'demo']) { const r = cli([cmd]); assert.equal(r.status, 2); assert.match(r.stderr, /requires a terminal/); }
});
test('session fails clearly for missing/crashed/broken/silent helpers', { timeout: 15000 }, () => {
  for (const [mode, pattern] of [['missing', /Cannot start/], ['crash', /exited \(7\)/], ['malformed', /Invalid controller JSON/], ['truncated', /Incomplete/], ['empty', /without a handshake/], ['bad-utf8', /encoded data/], ['oversized', /exceeds/], ['silent', /5 seconds/]]) {
    const r = spawnSync(process.execPath, ['test/fixtures/session.mjs', mode], { encoding: 'utf8', timeout: 7000 });
    assert.equal(r.status, 1, `${mode}: ${r.stderr}`); assert.match(r.stderr, pattern);
    assert.ok(!r.stderr.includes('\x1b'), mode);
  }
});
test('JSON session emits protocol only and exits with clean helper', () => {
  const r = spawnSync(process.execPath, ['test/fixtures/session.mjs', 'good'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(r.status, 0); assert.equal(r.stderr, ''); assert.equal(JSON.parse(r.stdout).type, 'ready');
});
test('signals terminate even a helper ignoring SIGTERM', { timeout: 6000 }, async (t) => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(process.execPath, ['test/fixtures/session.mjs', 'stubborn']);
    t.after(() => child.kill('SIGKILL'));
    const done = once(child, 'close');
    await once(child.stdout, 'data');
    child.kill(signal);
    const [code] = await done;
    assert.equal(code, signal === 'SIGINT' ? 130 : 143);
  }
});
test('slow consumer receives every JSON event under backpressure', { timeout: 6000 }, async (t) => {
  const child = spawn(process.execPath, ['test/fixtures/session.mjs', 'burst']);
  t.after(() => child.kill('SIGKILL'));
  const done = once(child, 'close');
  child.stdout.pause();
  await new Promise(resolve => setTimeout(resolve, 250));
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stdout.resume();
  const [code] = await done; assert.equal(code, 0);
  const events = output.trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 20001); assert.equal(events.at(-1).seq, 20000);
});
test('closed output pipe exits cleanly and terminates its helper', { timeout: 6000 }, async (t) => {
  const child = spawn(process.execPath, ['test/fixtures/session.mjs', 'flood']);
  t.after(() => child.kill('SIGKILL'));
  const done = once(child, 'close');
  await once(child.stdout, 'data');
  const pids = spawnSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  child.stdout.destroy();
  const [code] = await done; assert.equal(code, 0);
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('live CLI uses the bundled helper and can stop without a controller', { timeout: 6000 }, async (t) => {
  const child = spawn(process.execPath, ['dist/cli.js', 'controllers', '--json']);
  t.after(() => child.kill('SIGKILL'));
  const done = once(child, 'close');
  const [chunk] = await once(child.stdout, 'data');
  const first = JSON.parse(chunk.toString().split('\n')[0]);
  assert.equal(first.type, 'ready'); assert.equal(first.source, 'hardware');
  child.kill('SIGTERM'); const [code] = await done; assert.equal(code, 143);
});
