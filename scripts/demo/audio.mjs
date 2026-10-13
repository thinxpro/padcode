#!/usr/bin/env node
// Stand-in microphone helper for the scripted demo. It records nothing: the WAV it writes is a silent header.
import { closeSync, openSync, writeSync } from 'node:fs';

const args = process.argv.slice(2);
const out = value => process.stdout.write(JSON.stringify({ v: 1, ...value }) + '\n');
const command = args[0];
if (command === 'list') { out({ ok: true, devices: [{ id: 'demo-mic', name: 'Demo Mic', default: true, transport: 'built-in' }] }); process.exit(0); }
if (['permission', 'request', 'speech-permission', 'speech-request'].includes(command)) { out({ ok: true, status: 'authorized' }); process.exit(0); }
if (command !== 'record') { out({ ok: false, event: 'error', code: 'usage', message: 'The demo microphone only records.' }); process.exit(1); }
const fd = openSync(args[args.indexOf('--out') + 1], 'wx', 0o600);
let started;
out({ event: 'started' });
setTimeout(() => { started = Date.now(); out({ event: 'live' }); }, 120);
let phase = 0;
const meter = setInterval(() => out({ event: 'level', peak: 0.25 + 0.2 * Math.abs(Math.sin(phase++ / 2)) }), 60);
const end = save => {
  clearInterval(meter);
  const header = Buffer.alloc(44); header.write('RIFF', 0); header.write('WAVE', 8);
  writeSync(fd, header); closeSync(fd);
  out(save ? { event: 'stopped', seconds: started === undefined ? 0 : (Date.now() - started) / 1000, bytes: 44 } : { event: 'cancelled' });
  process.exit(0);
};
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (const line of buffer.split('\n').slice(0, -1)) { if (line === 'stop') end(true); if (line === 'cancel') end(false); }
  buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
});
process.stdin.on('end', () => end(false));
process.on('SIGTERM', () => end(false));
