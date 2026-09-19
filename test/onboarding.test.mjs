import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../dist/onboarding.js';
const pad = { address: 'aa:bb:cc:dd:ee:ff', name: 'DUALSHOCK 4', paired: false, connected: false };
const input = { v: 1, seq: 1, time: 1, type: 'connected', device: 1, name: 'DUALSHOCK 4', connection: 'wireless', serial: pad.address };
function harness(choices, answers = [], overrides = {}) {
  const output = [], operations = [], saved = [];
  const io = {
    banner: text => output.push(text), say: text => output.push(text),
    ask: async () => { assert.ok(answers.length, 'missing scripted text answer'); return answers.shift(); },
    choose: async (label, options, selected = 0) => {
      output.push(`${label} DEFAULT:${options[selected]?.value}`);
      output.push(options.map(option => option.label).join(' | '));
      assert.ok(choices.length, `missing choice: ${label}`); const value = choices.shift();
      if (value === 'CANCEL') throw new Error('Setup cancelled.');
      assert.ok(options.some(option => option.value === value), `invalid scripted choice ${value}: ${label}`); return value;
    },
  };
  const services = {
    bluetooth: {
      list: async scan => { operations.push(scan ? 'scan' : 'list'); return scan ? [pad] : []; },
      pair: async () => { operations.push('pair'); return { ...pad, paired: true }; },
      connect: async () => { operations.push('connect'); return { ...pad, paired: true, connected: true }; },
    },
    probe: () => ({ start: async () => operations.push('probe'), devices: async () => [input], press: async id => { operations.push(`press:${id}`); return 'south'; }, stop: async () => operations.push('stop') }),
    agents: async () => [{ label: 'my-agent', command: '/opt/my-agent' }],
    resolve: async value => value.startsWith('/') ? value : null,
    save: async config => saved.push(config),
    ...overrides,
  };
  return { io, services, output, operations, saved };
}
const signal = new AbortController().signal;
test('Bluetooth-first setup scans, explicitly pairs, verifies input, selects Agent and saves', async () => {
  const h = harness(['bluetooth', 'scan', '0', 'connect', 'test', '1', '0', 'terminal-basic', 'save']);
  const config = await setup(h.io, h.services, signal);
  assert.equal(config.controller.transport, 'bluetooth'); assert.equal(config.controller.inputVerified, true); assert.equal(config.agent.command, '/opt/my-agent');
  assert.deepEqual(h.operations, ['list', 'scan', 'list', 'pair', 'connect', 'probe', 'press:1', 'stop']);
  assert.match(h.output.join('\n'), /Connection route DEFAULT:bluetooth/);
  assert.equal(h.saved.length, 1);
});
test('deferred hardware remains unverified and custom arguments stay literal', async () => {
  const h = harness(['later', 'skip', 'custom', 'custom', 'terminal-basic', 'save'], ['missing', '/opt/custom agent', '--path', 'two words', '$(never execute)', '']);
  const config = await setup(h.io, h.services, signal);
  assert.deepEqual(config.agent, { command: '/opt/custom agent', args: ['--path', 'two words', '$(never execute)'] });
  assert.equal(config.controller.inputVerified, false); assert.deepEqual(h.operations, []);
  assert.match(h.output.join('\n'), /Executable not found/);
});
test('pairing failures offer retry/USB/defer without claiming input readiness', async () => {
  const h = harness(['bluetooth', 'bluetooth', 'later', 'skip', 'later', 'terminal-basic', 'save'], [], {
    bluetooth: { list: async () => { throw new Error('permission denied'); } },
  });
  const config = await setup(h.io, h.services, signal);
  assert.equal(config.controller.inputVerified, false); assert.match(h.output.join('\n'), /permission denied/);
});
test('no matching input or disconnected probe cannot silently pass and is always stopped', async () => {
  let stops = 0;
  for (const wrongTransport of [true, false]) {
    const h = harness(['usb', 'test', ...(wrongTransport ? [] : ['1']), 'skip', 'later', 'terminal-basic', 'save'], [], {
      probe: () => ({ start: async () => {}, devices: async () => [{ ...input, connection: wrongTransport ? 'wireless' : 'wired' }], press: async () => { throw new Error('disconnected'); }, stop: async () => { stops++; } }),
    });
    assert.equal((await setup(h.io, h.services, signal)).controller.inputVerified, false);
    assert.match(h.output.join('\n'), /INPUT NOT VERIFIED/);
  }
  assert.equal(stops, 2);
});
test('empty discovery can rescan; already-connected devices do not pair again', async () => {
  let scans = 0;
  const h = harness(['bluetooth', 'scan', 'scan', '0', 'back', '0', 'connect', 'skip', 'later', 'terminal-basic', 'save'], [], {
    bluetooth: { list: async scan => scan && ++scans === 2 ? [{ ...pad, paired: true, connected: true }] : [] },
  });
  const config = await setup(h.io, h.services, signal);
  assert.equal(config.controller.address, pad.address); assert.equal(config.controller.inputVerified, false);
  assert.match(h.output.join('\n'), /No nearby devices found/);
});
test('Bluetooth selection can switch to USB or defer without a pairing attempt', async () => {
  for (const choice of ['usb', 'later']) {
    const h = harness(['bluetooth', choice, 'skip', 'later', 'terminal-basic', 'save']);
    const config = await setup(h.io, h.services, signal);
    assert.equal(config.controller.transport, choice === 'usb' ? 'usb' : 'bluetooth');
    assert.deepEqual(h.operations, ['list']);
  }
});
test('cancel/save failure preserve configuration; abort never continues setup', async () => {
  const initial = { version: 1, controller: { transport: 'bluetooth', inputVerified: true }, agent: { command: '/opt/original', args: ['original'] }, profile: 'terminal-basic' };
  const h = harness(['later', 'skip', 'keep', 'terminal-basic', 'cancel']);
  assert.equal(await setup(h.io, h.services, signal, initial), null); assert.equal(h.saved.length, 0); assert.equal(initial.controller.inputVerified, true);
  const fail = harness(['later', 'skip', 'later', 'terminal-basic', 'save'], [], { save: async () => { throw new Error('disk full'); } });
  await assert.rejects(setup(fail.io, fail.services, signal), /disk full/);
  const cancelled = harness(['bluetooth', 'CANCEL']); await assert.rejects(setup(cancelled.io, cancelled.services, signal), /cancelled/); assert.equal(cancelled.saved.length, 0);
  const controller = new AbortController(); controller.abort();
  const aborted = harness(['bluetooth']); await assert.rejects(setup(aborted.io, aborted.services, controller.signal)); assert.equal(aborted.saved.length, 0);
});
test('partial discovery shows a warning and permits explicit selection without claiming completion', async () => {
  const h = harness(['bluetooth', 'scan', '0', 'connect', 'skip', 'later', 'terminal-basic', 'save']);
  h.services.bluetooth.scanWarning = 'SCAN INCOMPLETE: showing devices found so far.';
  const config = await setup(h.io, h.services, signal);
  assert.match(h.output.join('\n'), /SCAN INCOMPLETE/);
  assert.ok(!h.output.some(line => line.startsWith('Discovery complete')));
  assert.equal(config.controller.address, pad.address); assert.equal(config.controller.inputVerified, false);
  assert.deepEqual(h.operations, ['list', 'scan', 'list', 'pair', 'connect']);
});
test('connected controller stays selectable after an empty scan without leaving setup or reconnecting', async () => {
  const calls = [];
  const h = harness(['bluetooth', 'scan', '0', 'connect', 'skip', 'later', 'terminal-basic', 'save'], [], {
    bluetooth: { list: async scan => { calls.push(scan ? 'scan' : 'status'); return scan ? [] : [{ ...pad, paired: true, connected: true }]; }, pair: async () => assert.fail('unnecessary pairing'), connect: async () => assert.fail('unnecessary connection') },
  });
  const config = await setup(h.io, h.services, signal);
  assert.equal(config.controller.address, pad.address); assert.deepEqual(calls, ['status', 'scan', 'status']);
  assert.match(h.output.join('\n'), /connected \/ known/); assert.match(h.output.join('\n'), /No nearby devices found/);
  assert.match(h.output.join('\n'), /Use this connected controller/);
});
test('scan failure keeps known controller in the same picker without a recovery detour', async () => {
  const h = harness(['bluetooth', 'scan', '0', 'connect', 'skip', 'later', 'terminal-basic', 'save'], [], {
    bluetooth: { list: async scan => { if (scan) throw new Error('inquiry timed out'); return [{ ...pad, paired: true, connected: true }]; } },
  });
  assert.equal((await setup(h.io, h.services, signal)).controller.address, pad.address);
  assert.match(h.output.join('\n'), /SCAN NOT COMPLETED/);
  assert.ok(!h.output.includes('Recovery DEFAULT:bluetooth'));
});
test('cached known controller selection checks its connection instead of trusting old status', async () => {
  let reads = 0, connects = 0;
  const h = harness(['bluetooth', 'scan', '0', 'connect', 'skip', 'later', 'terminal-basic', 'save'], [], {
    bluetooth: {
      list: async () => { if (++reads > 1) throw new Error('status unavailable'); return [{ ...pad, paired: true, connected: true }]; },
      connect: async () => { connects++; return { ...pad, paired: true, connected: true }; },
      pair: async () => assert.fail('known paired controller should not be paired again'),
    },
  });
  assert.equal((await setup(h.io, h.services, signal)).controller.address, pad.address);
  assert.equal(connects, 1); assert.match(h.output.join('\n'), /status unknown \/ cached/);
});
