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
  assert.deepEqual(calls.map(c => c.args[0]), ['status', 'scan', 'pair', 'connect']); assert.equal(calls[2].options.timeout, 45000);
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
    for (const args of [[], ['invalid'], ['pair', 'not-an-address'], ['connect'], ['scan', 'extra']]) {
      const result = spawnSync('build/native/padcode-bluetooth', args, { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.status, 1, result.stderr); const response = JSON.parse(result.stdout); assert.equal(response.ok, false); assert.ok(['usage', 'address'].includes(response.code));
    }
  } else {
    // The platform contract is an explicit unsupported result, not a skipped hardware test.
    return assert.rejects(new NativeBluetooth(process.platform).list(true, signal), /macOS/);
  }
});
