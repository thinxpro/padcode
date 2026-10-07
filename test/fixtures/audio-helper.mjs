// Fake padcode-audio for automated tests. Never counts as microphone evidence.
import { appendFileSync, openSync, writeSync, closeSync } from 'node:fs';
const settings = JSON.parse(process.env.PADCODE_AUDIO_FIXTURE ?? '{}');
const args = process.argv.slice(2);
if (process.env.PADCODE_AUDIO_LOG) appendFileSync(process.env.PADCODE_AUDIO_LOG, JSON.stringify(args) + '\n');
const out = value => process.stdout.write(JSON.stringify({ v: 1, ...value }) + '\n');
const command = args[0];
if (command === 'list') { out({ ok: true, devices: settings.devices ?? [{ id: 'mic-1', name: 'Fixture Mic', default: true }, { id: 'mic-2', name: 'Second Mic', default: false }] }); process.exit(0); }
if (command === 'permission') { out({ ok: true, status: settings.permission ?? 'authorized' }); process.exit(0); }
if (command === 'request') { out({ ok: true, status: settings.request ?? 'authorized' }); process.exit(0); }
if (command !== 'record') { out({ ok: false, event: 'error', code: 'usage', message: 'usage' }); process.exit(1); }
const path = args[args.indexOf('--out') + 1];
const mode = settings.record ?? 'ok';
if (mode === 'denied') { out({ ok: false, event: 'error', code: 'permission-denied', message: 'Microphone access is denied.' }); process.exit(1); }
const fd = openSync(path, 'wx', 0o600);
out({ event: 'started' });
const started = Date.now();
const meter = setInterval(() => out({ event: 'level', peak: 0.4 }), 50);
const end = (save) => {
  clearInterval(meter);
  if (save) {
    const seconds = Math.round((Date.now() - started) / 100) / 10, data = Buffer.alloc(44 + 32);
    data.write('RIFF', 0); data.write('WAVE', 8); writeSync(fd, data); closeSync(fd);
    out({ event: 'stopped', seconds, bytes: data.length });
  } else { closeSync(fd); import('node:fs').then(fs => { fs.rmSync(path, { force: true }); out({ event: 'cancelled' }); process.exit(0); }); return; }
  process.exit(0);
};
const cap = Number(args[args.indexOf('--max-seconds') + 1]);
if (cap > 0) setTimeout(() => end(true), cap * 1000);
if (mode === 'crash') setTimeout(() => process.exit(3), 150);
if (mode === 'lost') setTimeout(() => { clearInterval(meter); closeSync(fd); import('node:fs').then(fs => { fs.rmSync(path, { force: true }); out({ ok: false, event: 'error', code: 'device-lost', message: 'The microphone was disconnected.' }); process.exit(1); }); }, 150);
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (const line of buffer.split('\n').slice(0, -1)) { if (line === 'stop') end(true); if (line === 'cancel') end(false); }
  buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
});
process.stdin.on('end', () => end(false));
process.on('SIGTERM', () => end(false));
