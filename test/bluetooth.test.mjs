import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { NativeBluetooth, parseBluetoothResult, parseDevice, normalizeAddress } from '../dist/bluetooth.js';
const pad = { address: 'aa-bb-cc-dd-ee-ff', name: 'DUALSHOCK 4', paired: true, connected: true };
const signal = new AbortController().signal;
test('Bluetooth adapter validates protocol, device identity and completion status', async () => {
  const calls = [];
  const adapter = new NativeBluetooth('darwin', async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stderr: '', stdout: JSON.stringify({ v: 1, ok: true, device: pad, devices: [{ ...pad, name: 'Speaker' }, pad] }) };
  });
  assert.equal((await adapter.list(false, signal))[0].name, 'DUALSHOCK 4');
  await adapter.list(true, signal); await adapter.pair(pad.address, signal); await adapter.connect(pad.address, signal);
  assert.deepEqual(calls.map(c => c.args[0]), ['status', 'scan', 'pair', 'connect']); assert.equal(calls[2].options.timeout, 45000); assert.equal(calls[1].options.timeout, 35000);
  assert.equal(normalizeAddress('AA:BB:CC:DD:EE:FF'), 'aabbccddeeff');
  await assert.rejects(adapter.pair('bad;command', signal), /address/);
  await assert.rejects(new NativeBluetooth('linux').list(false, signal), /macOS/);
  for (const response of [{ v: 2, ok: true }, { v: 1, ok: false, message: 'Permission denied' }, { v: 1, ok: true, devices: 'invalid' }, { v: 1, ok: true, devices: [null] }]) {
    const bad = new NativeBluetooth('darwin', async () => ({ code: 0, stdout: JSON.stringify(response), stderr: '' }));
    await assert.rejects(bad.list(false, signal));
  }
  for (const device of [{ ...pad, address: '00:00:00:00:00:01' }, { ...pad, paired: false }, { ...pad, connected: false }]) {
    const bad = new NativeBluetooth('darwin', async () => ({ code: 0, stdout: JSON.stringify({ v: 1, ok: true, device }), stderr: '' }));
    await assert.rejects(device.paired === false ? bad.pair(pad.address, signal) : bad.connect(pad.address, signal));
  }
  const badExit = new NativeBluetooth('darwin', async () => ({ code: 1, stdout: '{"v":1,"ok":true}', stderr: '' }));
  await assert.rejects(badExit.list(false, signal), /unsuccessfully/);
});
test('untrusted Bluetooth output fails validation', () => {
  for (const text of ['bad', 'null', '{"v":1,"ok":false}', '{"v":1,"ok":"true"}']) assert.throws(() => parseBluetoothResult(text));
  for (const value of [null, {}, { ...pad, address: 'none' }, { ...pad, name: 'x'.repeat(513) }, { ...pad, paired: 1 }, { ...pad, connected: null }]) assert.throws(() => parseDevice(value));
});
test('native Bluetooth command validation never touches the radio', () => {
  if (process.platform === 'darwin') {
    for (const args of [[], ['invalid'], ['pair', 'not-an-address'], ['connect'], ['scan', 'extra'], ['--permission-owner'], ['--permission-owner', 'invalid'], ['--permission-owner', '--permission-owner', 'status']]) {
      const result = spawnSync('build/native/padcode-bluetooth', args, { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.status, 1, result.stderr); const response = JSON.parse(result.stdout); assert.equal(response.ok, false); assert.ok(['usage', 'address'].includes(response.code));
    }
  } else {
    // The platform contract is an explicit unsupported result, not a skipped hardware test.
    return assert.rejects(new NativeBluetooth(process.platform).list(true, signal), /macOS/);
  }
});
test('macOS permission handoff retains PID and validates its own usage metadata without radio access', async () => {
  if (process.platform !== 'darwin') return assert.rejects(new NativeBluetooth(process.platform).list(false, signal), /macOS/);
  const { spawn } = await import('node:child_process');
  const child = spawn('build/native/padcode-bluetooth', ['diagnose-permission']);
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
    assert.deepEqual(result, { code: 0, signal: null }, errors);
    assert.deepEqual(JSON.parse(output), { v: 1, ok: true, selfResponsible: true, usageDescription: true, pid: child.pid });
  } finally { clearTimeout(timeout); }
});
test('macOS permission ownership failures stop before Bluetooth access', async t => {
  if (process.platform !== 'darwin') return assert.rejects(new NativeBluetooth(process.platform).list(false, signal), /macOS/);
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'padcode-permission-')); t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  assert.equal(sdk.status, 0, sdk.stderr);
  for (const metadata of [true, false]) {
    const binary = join(root, metadata ? 'with-metadata' : 'without-metadata');
    const built = spawnSync('xcrun', ['clang', '-isysroot', sdk.stdout.trim(), '-fobjc-arc', '-Wall', '-Wextra', '-Werror', 'test/fixtures/permission-harness.m', '-framework', 'Foundation', ...(metadata ? ['-Wl,-sectcreate,__TEXT,__info_plist,native/bluetooth.plist'] : []), '-o', binary], { encoding: 'utf8', timeout: 20000 });
    assert.equal(built.status, 0, built.stderr);
    const cases = metadata ? [['missing-symbol', /cannot establish/], ['foreign-owner', /retained the terminal/], ['disclaim-failure', /identity \(22\)/], ['spawn-failure', /identity \(13\)/], ['self-owner', /self-owner/]] : [['missing-metadata', /metadata is missing/]];
    for (const [mode, expected] of cases) {
      const result = spawnSync(binary, [mode], { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, expected);
    }
  }
});
test('partial scan metadata is validated and warnings reset on a subsequent request', async () => {
  let response = { v: 1, ok: true, devices: [pad], scan: { complete: false, started: true, discovered: 1, reason: 'deadline' } };
  const adapter = new NativeBluetooth('darwin', async () => ({ code: 0, stderr: '', stdout: JSON.stringify(response) }));
  assert.equal((await adapter.list(true, signal)).length, 1); assert.match(adapter.scanWarning, /SCAN INCOMPLETE/);
  await adapter.list(false, signal); assert.equal(adapter.scanWarning, undefined);
  response.scan = { complete: false, started: true, discovered: 1, reason: 'native-error', nativeError: 1 };
  await adapter.list(true, signal); assert.match(adapter.scanWarning, /macOS inquiry error 1/);
  response.scan = { complete: true, started: true, discovered: 1, reason: 'complete' };
  await adapter.list(true, signal); assert.equal(adapter.scanWarning, undefined);
  for (const metadata of [null, {}, { complete: false, started: true, discovered: 1, reason: 'native-error', nativeError: 0 }, { complete: true, started: true, discovered: 1, reason: 'complete', nativeError: 'bad' }, { complete: false, started: true, discovered: 2, reason: 'deadline' }, { complete: true, started: 'yes', discovered: 1, reason: 'complete' }, { complete: false, started: true, discovered: 1, reason: 'complete' }]) {
    response.scan = metadata; await assert.rejects(adapter.list(true, signal), /scan metadata/);
  }
  response.devices = []; response.scan = { complete: false, started: false, discovered: 0, reason: 'deadline' };
  await assert.rejects(adapter.list(true, signal), /scan metadata/);
});
