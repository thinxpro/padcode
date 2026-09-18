import test from 'node:test';
import assert from 'node:assert/strict';
import { EventDecoder, parseEvent, buttons, axes } from '../dist/protocol.js';
const ready = { v: 1, seq: 0, time: 0, type: 'ready', source: 'hardware', sdl: '3.4.16' };
const event = (fields = {}) => ({ v: 1, seq: 1, time: 1, type: 'connected', device: 1, name: '🎮', ...fields });
const line = value => Buffer.from(`${JSON.stringify(value)}\n`);
test('accepts each event and all supported buttons/axes', () => {
  for (const e of [ready, event(), event({ type: 'disconnected' }), ...buttons.map(button => event({ type: 'button', button, down: true })), ...axes.map(axis => event({ type: 'axis', axis, value: -32768 }))]) assert.deepEqual(parseEvent(JSON.stringify(e)), e);
});
test('rejects malformed JSON and invalid event schemas', () => {
  for (const value of [null, [], 3, {}, { ...ready, v: 2 }, { ...ready, seq: -1 }, { ...ready, time: NaN }, { ...ready, source: 'pretend' }, { ...ready, sdl: 3 }, { ...ready, sdl: 'a'.repeat(41) }, event({ device: 0 }), event({ name: 1 }), event({ name: 'a'.repeat(513) }), event({ type: 'other' }), event({ type: 'button', button: 'nope', down: true }), event({ type: 'button', button: 'south', down: 1 }), event({ type: 'axis', axis: 'leftx', value: 32768 }), event({ type: 'axis', axis: 'leftx', value: 0.5 }), event({ type: 'axis', axis: 'unknown', value: 0 })]) assert.throws(() => parseEvent(JSON.stringify(value)));
  assert.throws(() => parseEvent('{'), /JSON/);
});
test('decodes fragmented UTF-8, multiple records and final newline', () => {
  const decoder = new EventDecoder(), seen = [];
  for (const byte of Buffer.concat([line(ready), line(event())])) seen.push(...decoder.push(Buffer.from([byte])));
  decoder.end(); assert.deepEqual(seen, [ready, event()]);
});
test('rejects missing/duplicate handshake and sequence/time regressions', () => {
  for (const values of [[event()], [ready, { ...ready, seq: 1 }], [ready, event({ seq: 0 })], [ready, event(), event({ seq: 2, time: 0 })]]) {
    const d = new EventDecoder(); assert.throws(() => d.push(Buffer.concat(values.map(line))));
  }
});
test('bounded frames, incomplete records and invalid UTF-8 fail closed', () => {
  for (const chunk of [Buffer.from(' '.repeat(4097)), Buffer.from(' '.repeat(4097) + '\n'), Buffer.from([0xff])]) assert.throws(() => new EventDecoder().push(chunk));
  assert.throws(() => new EventDecoder().end(), /handshake/);
  const d = new EventDecoder(); d.push(line(ready)); d.push(Buffer.from('{')); assert.throws(() => d.end(), /Incomplete/);
  const utf = new EventDecoder(); utf.push(Buffer.from([0xe4])); assert.throws(() => utf.end());
});
