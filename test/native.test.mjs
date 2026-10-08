import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventDecoder } from '../dist/protocol.js';
const binary = 'build/native/padcode-controller';
test('real SDL virtual gamepad flows through production JSONL serializer', () => {
  const r = spawnSync(binary, ['--virtual-test'], { timeout: 10000 });
  assert.equal(r.status, 0, `${r.error ?? ''} ${r.stderr}`);
  const d = new EventDecoder(), events = d.push(r.stdout); d.end();
  assert.equal(events[0].source, 'virtual'); assert.equal(events[0].sdl, '3.4.16');
  const connected = events.find(e => e.type === 'connected'); assert.ok(connected); assert.match(connected.name, /"virtual" \\ test\ncontroller/);
  const button = events.filter(e => e.type === 'button' && e.button === 'south'); assert.deepEqual(button.map(e => e.down), [true, false]);
  const axis = events.filter(e => e.type === 'axis' && e.axis === 'leftx'); assert.ok(axis.some(e => e.value === 24576)); assert.equal(axis.at(-1).value, 0);
  assert.equal(events.at(-1).type, 'disconnected'); assert.equal(events.at(-1).device, connected.device);
});
test('helper rejects unknown options', () => {
  const r = spawnSync(binary, ['--not-valid'], { encoding: 'utf8', timeout: 3000 }); assert.equal(r.status, 2); assert.match(r.stderr, /Usage/); assert.equal(r.stdout, '');
});
test('P1 macOS helpers are universal and run on macOS 13 or later', { skip: process.platform !== 'darwin' && 'macOS build only' }, () => {
  for (const name of ['padcode-controller', 'padcode-bluetooth', 'padcode-audio']) {
    const path = `build/native/${name}`;
    assert.deepEqual(spawnSync('lipo', ['-archs', path], { encoding: 'utf8' }).stdout.trim().split(/\s+/).sort(), ['arm64', 'x86_64'], name);
    for (const arch of ['arm64', 'x86_64']) assert.match(spawnSync('vtool', ['-arch', arch, '-show-build', path], { encoding: 'utf8' }).stdout, /minos 13\.0\n/, `${name} ${arch}`);
  }
});
