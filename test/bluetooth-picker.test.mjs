import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDeviceChoices, scanDeviceChoices } from '../dist/bluetooth-picker.js';
const pad = { address: 'aa:bb:cc:dd:ee:ff', name: 'Wireless Controller', paired: true, connected: true };
const signal = new AbortController().signal;
test('known and nearby devices merge by normalized address with authoritative refreshed status', () => {
  const speaker = { ...pad, address: '00:00:00:00:00:01', name: 'Speaker', connected: false };
  const devices = mergeDeviceChoices([speaker, pad], [{ ...pad, address: 'AA-BB-CC-DD-EE-FF', connected: false, paired: false }]);
  assert.equal(devices.length, 2); assert.equal(devices[0].name, pad.name);
  assert.equal(devices[0].source, 'known + nearby'); assert.equal(devices[0].connected, true);
  const disconnected = mergeDeviceChoices([{ ...pad, connected: false }], [pad]);
  assert.equal(disconnected[0].connected, false);
  assert.equal(mergeDeviceChoices([{ ...pad, name: 'Unnamed Bluetooth device' }], [pad])[0].name, pad.name);
  assert.equal(mergeDeviceChoices([pad], [], true)[0].connected, false);
});
test('empty discovery retains known devices without counting them as nearby', async () => {
  const calls = [];
  const result = await scanDeviceChoices({ list: async scan => { calls.push(scan); return scan ? [] : [pad]; } }, [], signal);
  assert.deepEqual(calls, [true, false]); assert.equal(result.discovered, 0);
  assert.equal(result.devices[0].connected, true); assert.equal(result.devices[0].source, 'known');
});
test('partial warning survives status refresh and scan errors retain the known-device picker', async () => {
  const adapter = { scanWarning: undefined, list: async scan => { adapter.scanWarning = scan ? 'SCAN INCOMPLETE' : undefined; return [pad]; } };
  const partial = await scanDeviceChoices(adapter, [], signal);
  assert.deepEqual(partial.warnings, ['SCAN INCOMPLETE']); assert.equal(partial.devices.length, 1);
  const failed = await scanDeviceChoices({ list: async scan => { if (scan) throw new Error('scan timeout'); return [pad]; } }, [], signal);
  assert.equal(failed.discovered, undefined); assert.match(failed.warnings[0], /scan timeout/);
  assert.equal(failed.devices[0].connected, true);
});
test('status failure retains only cached known entries and never invents connected state', async () => {
  const previous = mergeDeviceChoices([pad], [{ ...pad, address: '00:00:00:00:00:02', name: 'Old nearby' }]);
  const failed = await scanDeviceChoices({ list: async () => { throw new Error('unavailable'); } }, previous, signal);
  assert.equal(failed.devices.length, 1); assert.equal(failed.devices[0].cached, true);
  assert.equal(failed.devices[0].connected, false); assert.equal(failed.warnings.length, 2);
  const fresh = await scanDeviceChoices({ list: async scan => { if (!scan) throw new Error('status failed'); return [pad]; } }, previous, signal);
  assert.equal(fresh.devices[0].cached, false); assert.equal(fresh.devices[0].connected, true);
  assert.equal(fresh.devices[0].source, 'known + nearby');
});
test('cancellation is never converted to cached-device recovery', async () => {
  for (const abortAt of [0, 1, 2]) {
    const controller = new AbortController(); let calls = 0;
    if (!abortAt) controller.abort();
    await assert.rejects(scanDeviceChoices({ list: async () => { calls++; if (calls === abortAt) { controller.abort(); throw new Error('cancelled'); } return [pad]; } }, mergeDeviceChoices([pad], []), controller.signal));
    assert.equal(calls, abortAt);
  }
});
