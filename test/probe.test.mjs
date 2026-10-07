import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerProbe, identityMatch } from '../dist/probe.js';
import { parseEvent } from '../dist/protocol.js';
const connected = { v: 1, seq: 1, time: 1, type: 'connected', device: 1, name: 'Pad', connection: 'wireless', serial: 'aa:bb:cc:dd:ee:ff' };
test('transport and serial prevent silently verifying a different controller', () => {
  assert.equal(identityMatch(connected, 'bluetooth', 'aa-bb-cc-dd-ee-ff'), 'match');
  assert.equal(identityMatch(connected, 'usb'), 'mismatch');
  assert.equal(identityMatch({ ...connected, connection: 'wired' }, 'bluetooth'), 'mismatch');
  assert.equal(identityMatch(connected, 'bluetooth', '00:00:00:00:00:01'), 'mismatch');
  assert.equal(identityMatch({ ...connected, serial: undefined, connection: undefined }, 'bluetooth'), 'manual');
  assert.deepEqual(parseEvent(JSON.stringify(connected)), connected);
  for (const extra of [{ connection: 'bad' }, { serial: 1 }]) assert.throws(() => parseEvent(JSON.stringify({ ...connected, ...extra })));
});
test('only a fresh down event on the selected SDL device passes', async () => {
  const probe = new ControllerProbe(process.execPath, ['test/fixtures/probe.mjs', 'normal']);
  const signal = new AbortController().signal;
  try {
    await probe.start(signal); const devices = await probe.devices(signal); assert.equal(devices[0].device, 1);
    assert.equal(await probe.press(1, signal), 'east');
    await assert.rejects(probe.press(99, signal), /disconnected/);
  } finally { await probe.stop(); }
});
test('a button held before selection cannot pass on a duplicate down event', async () => {
  const probe = new ControllerProbe(process.execPath, ['test/fixtures/probe.mjs', 'held']);
  const signal = new AbortController().signal;
  try {
    await probe.start(signal); await probe.devices(signal);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(await probe.press(1, signal), 'east');
  } finally { await probe.stop(); }
});
test('probe rejects missing helper, corrupt protocol, exit and disconnect', async () => {
  for (const mode of ['missing', 'bad', 'exit', 'disconnect']) {
    const probe = new ControllerProbe(mode === 'missing' ? '/padcode-missing-helper' : process.execPath, ['test/fixtures/probe.mjs', mode]);
    try {
      await assert.rejects((async () => {
        const signal = new AbortController().signal;
        await probe.start(signal); await probe.devices(signal); await probe.press(1, signal);
      })());
    } finally { await probe.stop(); }
  }
});
test('input waiting can be cancelled and stopped repeatedly without leaks', async () => {
  const probe = new ControllerProbe(process.execPath, ['test/fixtures/probe.mjs', 'quiet']);
  const controller = new AbortController();
  try {
    await probe.start(controller.signal); await probe.devices(controller.signal);
    const pending = probe.press(1, controller.signal); controller.abort(); await assert.rejects(pending, /cancelled/);
  } finally { await probe.stop(); await probe.stop(); }
  await new ControllerProbe().stop();
});
test('disconnect during input check does not poison the shared stream after reconnect', async () => {
  const probe = new ControllerProbe(process.execPath, ['test/fixtures/probe.mjs', 'reconnect']);
  const signal = new AbortController().signal;
  try {
    await probe.start(signal); await probe.devices(signal);
    await assert.rejects(probe.press(1, signal), /disconnected/);
    assert.equal((await probe.devices(signal))[0].device, 1);
    assert.equal(await probe.press(1, signal), 'south');
  } finally { await probe.stop(); }
});
