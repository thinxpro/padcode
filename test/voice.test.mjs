import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm, stat, symlink, chmod } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { VoiceCapture, removeStaleVoice, voiceDirectory, startAt, stopBelow } from '../dist/voice-session.js';
import { NativeAudio } from '../dist/audio.js';
import { setup } from '../dist/onboarding.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
// File removal is asynchronous; poll instead of assuming a fixed delay.
async function eventually(check, message) { const end = Date.now() + 2000; while (!check()) { assert.ok(Date.now() < end, message); await wait(5); } }
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'padcode-voice-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

// A scripted AudioPort whose recordings finish when the test says so.
function fakeAudio() {
  const recordings = [], plays = [];
  const audio = {
    supported: true,
    list: async () => [], permission: async () => 'authorized', request: async () => 'authorized',
    record(options) {
      let finish, level; const done = new Promise(r => { finish = r; });
      let live;
      const recording = { options, stopped: 0, cancelled: 0, done, onStarted() {}, onLevel(fn) { level = fn; }, onLive(fn) { live = fn; }, goLive: () => live?.(),
        stop() { recording.stopped++; }, cancel() { recording.cancelled++; }, finish: async (result) => { if (result.kind === 'stopped') await writeFile(options.path, 'RIFF'); finish(result); await wait(5); }, level: peak => level?.(peak) };
      writeFileSync(options.path, '');
      recordings.push(recording); return recording;
    },
    play(path) { let end; const done = new Promise(r => { end = r; }); const play = { path, stopped: 0, stop() { play.stopped++; end(); }, done, end }; plays.push(play); return play; },
  };
  return { audio, recordings, plays };
}
function voice(t, dir, settings = {}) {
  const f = fakeAudio(), calls = []; let routing = settings.routing ?? true, handler;
  let clock = 1000;
  const capture = new VoiceCapture(f.audio, dir, 'mic-1', {
    routing: () => routing,
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' ')[0]}`); },
    release: resume => { handler = undefined; calls.push(`release:${resume}`); },
    status: text => calls.push(`status:${text.split(' ')[0]}`),
    notice: text => calls.push(`notice:${text}`),
  }, () => clock);
  return { capture, ...f, calls, press: b => handler?.(b), setRouting: v => { routing = v; }, tick: ms => { clock += ms; } };
}

test('C4-A1 L2 hysteresis, debounce, held-at-start trigger and routing guard', async t => {
  const dir = await temporary(t), v = voice(t, dir, { routing: false });
  // Held through the launch barrier: no recording, and still none once routing starts until it is released.
  v.capture.trigger(0.9); v.tick(200); assert.equal(v.recordings.length, 0, 'held trigger at start recorded');
  v.setRouting(true); v.capture.trigger(1); v.capture.trigger(0.8); assert.equal(v.recordings.length, 0, 'held trigger recorded after the barrier');
  v.capture.trigger(0.1); v.tick(200);
  for (const value of [0.5, 0.64, 0.6, 0.3, 0.64]) v.capture.trigger(value);
  assert.equal(v.recordings.length, 0, 'below the start threshold recorded');
  v.capture.trigger(startAt); assert.equal(v.recordings.length, 1); assert.equal(v.recordings[0].options.maxSeconds, 60);
  assert.equal(v.recordings[0].options.device, 'mic-1'); assert.deepEqual(v.calls.slice(0, 1), ['capture:MIC']);
  // The REC clock starts with the first real audio, after a Bluetooth-style warm-up.
  v.recordings[0].level(0.5); assert.ok(!v.calls.includes('status:REC'), 'REC shown before audio arrived');
  v.recordings[0].goLive(); assert.ok(v.calls.includes('status:REC'));
  // Jitter above the stop threshold keeps recording.
  for (const value of [0.4, 0.36, 0.5, stopBelow]) v.capture.trigger(value);
  assert.equal(v.recordings[0].stopped, 0);
  // A release inside the 150 ms debounce is applied when the debounce ends.
  v.capture.trigger(0.1); assert.equal(v.recordings[0].stopped, 0);
  v.tick(200); await wait(170); assert.equal(v.recordings[0].stopped, 1);
  // A second press while the first job is still stopping is ignored.
  v.tick(200); v.capture.trigger(0.9); assert.equal(v.recordings.length, 1);
  await v.recordings[0].finish({ kind: 'stopped', seconds: 0.4 });
  assert.equal(v.capture.state, 'idle'); assert.ok(v.calls.includes('notice:RECORDED 0.4s / Options > Play last recording'));
  v.capture.trigger(0.1); v.tick(200);
  v.setRouting(false); v.capture.trigger(0.9); assert.equal(v.recordings.length, 1, 'recorded while the menu or pause owned the controller');
  v.setRouting(true); v.capture.trigger(0.1); v.tick(200); v.capture.trigger(0.9); assert.equal(v.recordings.length, 2);
  v.capture.dispose();
});

test('C4-A2/A3 cancel, replacement, errors, crashes and late results leave no stray files', async t => {
  const dir = await temporary(t), v = voice(t, dir);
  const press = () => { v.tick(200); v.capture.trigger(0.1); v.tick(200); v.capture.trigger(0.9); v.tick(200); };
  const record = async (result) => {
    press();
    const r = v.recordings.at(-1); v.capture.trigger(0.1); await r.finish(result); return r;
  };
  const first = await record({ kind: 'stopped', seconds: 1 });
  assert.ok(existsSync(first.options.path)); assert.equal(v.capture.last, first.options.path);
  const second = await record({ kind: 'stopped', seconds: 2 });
  await eventually(() => !existsSync(first.options.path), 'previous recording kept'); assert.equal(v.capture.last, second.options.path);
  // O cancels: the helper's cancelled result removes the file and keeps no recording.
  press();
  const third = v.recordings.at(-1); v.press('east'); assert.equal(third.cancelled, 1);
  v.press('south'); v.press('dpad_up'); assert.equal(third.cancelled, 1);
  await third.finish({ kind: 'stopped', seconds: 0.2 });
  await eventually(() => !existsSync(third.options.path), 'cancelled recording kept'); assert.ok(v.calls.includes('notice:RECORDING CANCELLED')); assert.equal(v.capture.last, undefined);
  for (const result of [{ kind: 'error', code: 'device-lost', message: 'The microphone was disconnected.' }, { kind: 'error', code: 'crash', message: 'The microphone helper stopped unexpectedly.' }, { kind: 'error', code: 'permission-denied', message: 'Microphone access is denied.' }]) {
    const r = await record(result);
    await eventually(() => !existsSync(r.options.path), 'failed recording kept'); assert.ok(v.calls.includes(`notice:MIC ERROR / ${result.message}`));
  }
  assert.equal(v.calls.filter(call => call.startsWith('capture')).length, v.calls.filter(call => call.startsWith('release')).length);
  // Released before audio arrived (or under 0.3 s): discarded as too short.
  const short = await record({ kind: 'stopped', seconds: 0.1 });
  await eventually(() => !existsSync(short.options.path), 'short recording kept');
  assert.ok(v.calls.includes('notice:RECORDING TOO SHORT / Hold L2 until REC appears')); assert.equal(v.capture.last, undefined, 'a too-short recording replaced nothing usable');
  // A result arriving after dispose only deletes its file.
  press();
  const late = v.recordings.at(-1); v.capture.dispose(); assert.equal(late.cancelled, 1);
  const before = v.calls.length; await late.finish({ kind: 'stopped', seconds: 1 });
  await eventually(() => !existsSync(late.options.path), 'late recording kept'); assert.equal(v.calls.length, before);
});

test('C4 playback captures the controller and O stops it', async t => {
  const dir = await temporary(t), v = voice(t, dir);
  v.capture.play(); assert.equal(v.plays.length, 0, 'played without a recording');
  v.capture.trigger(0.1); v.tick(200); v.capture.trigger(0.9); v.tick(200); v.capture.trigger(0.1);
  await v.recordings[0].finish({ kind: 'stopped', seconds: 1 });
  v.calls.length = 0; v.capture.play(); assert.deepEqual(v.calls, ['capture:PLAYING']); assert.equal(v.plays[0].path, v.capture.last);
  v.tick(200); v.capture.trigger(0.9); assert.equal(v.recordings.length, 1, 'recorded during playback');
  v.press('east'); await wait(5); assert.equal(v.plays[0].stopped, 1); assert.deepEqual(v.calls.slice(-1), ['release:true']); assert.equal(v.capture.state, 'idle');
  v.capture.dispose();
});

test('C4-A4 stale voice directories: only dead-owner private directories are removed', async t => {
  const root = await temporary(t);
  const dead = await voiceDirectory(root), live = await voiceDirectory(root);
  await writeFile(join(dead, 'owner'), '999999'); await writeFile(join(dead, 'rec-1.wav'), 'x');
  const loose = join(root, 'pcv-loose1'); await mkdir(loose, { mode: 0o755 }); await writeFile(join(loose, 'owner'), '999999');
  const noOwner = join(root, 'pcv-noown1'); await mkdir(noOwner, { mode: 0o700 });
  const target = join(root, 'elsewhere'); await mkdir(target, { mode: 0o700 }); await writeFile(join(target, 'owner'), '999999');
  await symlink(target, join(root, 'pcv-link01'));
  const other = join(root, 'not-padcode'); await mkdir(other, { mode: 0o700 }); await writeFile(join(other, 'owner'), '999999');
  assert.equal((await stat(dead)).mode & 0o777, 0o700); assert.equal((await stat(join(dead, 'owner'))).mode & 0o777, 0o600);
  const removed = await removeStaleVoice(root, pid => pid === process.pid);
  assert.equal(removed, 1);
  const left = (await readdir(root)).sort();
  assert.ok(!left.includes(dead.split('/').pop())); assert.ok(left.includes(live.split('/').pop()));
  for (const name of ['pcv-loose1', 'pcv-noown1', 'pcv-link01', 'elsewhere', 'not-padcode']) assert.ok(left.includes(name), name);
  assert.ok(existsSync(join(target, 'owner')), 'followed a symlink');
});

function harness(choices, audio) {
  const output = [];
  const io = {
    banner: text => output.push(text), say: text => output.push(text), ask: async () => { throw new Error('no text'); },
    choose: async (label, options, selected = 0) => {
      output.push(`${label} DEFAULT:${options[selected]?.value}`); output.push(options.map(option => option.label).join(' | '));
      const value = choices.shift(); assert.ok(options.some(option => option.value === value), `invalid choice ${value}: ${label}`); return value;
    },
  };
  const services = {
    bluetooth: { list: async () => [] }, probe: () => ({}), agents: async () => [], resolve: async () => null,
    save: async () => {}, audio,
  };
  return { io, services, output };
}
const base = ['later', 'skip', 'later', 'terminal-basic'];
test('C4-A6 setup voice step: keep off, choose with permission, denial recovery, no devices, unsupported', async t => {
  const dir = await temporary(t), log = join(dir, 'audio.log'), plays = join(dir, 'plays.log');
  const audio = settings => new NativeAudio({ command: process.execPath, args: [resolve('test/fixtures/audio-helper.mjs')], player: resolve('test/fixtures/fake-player.sh'), supported: true });
  const run = async (choices, settings = {}, initial) => {
    process.env.PADCODE_AUDIO_FIXTURE = JSON.stringify(settings); process.env.PADCODE_AUDIO_LOG = log; process.env.PADCODE_PLAY_LOG = plays;
    const h = harness([...base, ...choices, 'save'], audio(settings));
    try { return { config: await setup(h.io, h.services, new AbortController().signal, initial), text: h.output.join('\n') }; }
    finally { delete process.env.PADCODE_AUDIO_FIXTURE; delete process.env.PADCODE_AUDIO_LOG; delete process.env.PADCODE_PLAY_LOG; }
  };
  let r = await run(['off']);
  assert.equal(r.config.voice, null); assert.match(r.text, /MISSION 05 \/ VOICE \(optional\)/); assert.match(r.text, /VOICE {3}off/); assert.match(r.text, /MISSION 06 \/ SAVE POINT/);
  r = await run(['choose', '1', 'test'], { permission: 'not-determined', request: 'authorized', warmup: 300 });
  assert.deepEqual(r.config.voice, { microphone: { id: 'mic-2', name: 'Second Mic' } });
  assert.match(r.text, /macOS will now ask/); assert.match(r.text, /Audio stays on this Mac/); assert.match(r.text, /PLAYING BACK/);
  assert.match(r.text, /MIC STARTING\.\.\.\nRECORDING 3 SECONDS/, 'speak prompt shown before the microphone was live');
  assert.match(r.text, /Bluetooth headset microphones take about a second/); assert.match(r.text, /Second Mic \/ Bluetooth/); assert.match(r.text, /Fixture Mic \/ USB \/ system default/);
  assert.match(r.text, /Choose a microphone DEFAULT:0/, 'system default not preselected');
  const calls = (await import('node:fs')).readFileSync(log, 'utf8');
  assert.match(calls, /"request"/); assert.match(calls, /"record","--out",".*check\.wav","--max-seconds","3","--device","mic-2"/);
  assert.equal((await import('node:fs')).readFileSync(plays, 'utf8').trim().endsWith('check.wav'), true);
  r = await run(['keep'], {}, { version: 2, controller: { transport: 'bluetooth', inputVerified: false }, agent: null, profile: 'terminal-basic', voice: { microphone: { id: 'mic-2', name: 'Second Mic' } } });
  assert.deepEqual(r.config.voice, { microphone: { id: 'mic-2', name: 'Second Mic' } });
  r = await run(['choose', 'retry', 'off'], { permission: 'denied' });
  assert.equal(r.config.voice, null); assert.match(r.text, /Privacy & Security > Microphone/);
  r = await run(['choose', 'off'], { devices: [] });
  assert.equal(r.config.voice, null); assert.match(r.text, /No microphone is connected/);
  r = await run(['choose', '0', 'test', 'off'], { record: 'denied' });
  assert.equal(r.config.voice, null); assert.match(r.text, /VOICE NOT READY: Microphone access is denied/);
  const h = harness([...base, 'save'], new NativeAudio({ command: '/missing', supported: false }));
  const config = await setup(h.io, h.services, new AbortController().signal);
  assert.equal(config.voice, null); assert.match(h.output.join('\n'), /Voice capture currently requires macOS/);
  const files = (await readdir(tmpdir())).filter(name => name.startsWith('pcv-'));
  for (const name of files) { const owner = join(tmpdir(), name, 'owner'); if (existsSync(owner)) assert.notEqual((await import('node:fs')).readFileSync(owner, 'utf8'), String(process.pid), 'setup check directory kept'); }
});

test('C4 NativeAudio parses helper output, crashes and spawn failures', async t => {
  const dir = await temporary(t);
  const make = settings => { process.env.PADCODE_AUDIO_FIXTURE = JSON.stringify(settings); return new NativeAudio({ command: process.execPath, args: [resolve('test/fixtures/audio-helper.mjs')], supported: true }); };
  try {
    assert.deepEqual(await make({}).list(), [{ id: 'mic-1', name: 'Fixture Mic', default: true, transport: 'usb' }, { id: 'mic-2', name: 'Second Mic', default: false, transport: 'bluetooth' }]);
    assert.deepEqual(await make({ devices: [{ id: 'x\u001b', name: 'Evil\u001b[2J', default: 'yes', transport: 'laser' }, { name: 'no id' }] }).list(), [{ id: 'x', name: 'Evil[2J', default: false, transport: 'unknown' }]);
    assert.equal(await make({ permission: 'restricted' }).permission(), 'restricted');
    await assert.rejects(make({ permission: 'maybe' }).permission(), /unknown permission/);
    let recording = make({ warmup: 100 }).record({ path: join(dir, 'a.wav'), maxSeconds: 60 });
    const levels = []; let live = 0; recording.onLevel(peak => levels.push(peak)); recording.onLive(() => live++);
    await wait(200); recording.stop(); const stopped = await recording.done;
    assert.equal(stopped.kind, 'stopped'); assert.ok(levels.length); assert.equal(live, 1); assert.ok(existsSync(join(dir, 'a.wav')));
    recording = make({}).record({ path: join(dir, 'b.wav'), maxSeconds: 60 }); await wait(100); recording.cancel();
    assert.deepEqual(await recording.done, { kind: 'cancelled' }); assert.ok(!existsSync(join(dir, 'b.wav')));
    recording = make({ record: 'crash' }).record({ path: join(dir, 'c.wav'), maxSeconds: 60 });
    assert.deepEqual(await recording.done, { kind: 'error', code: 'crash', message: 'The microphone helper stopped unexpectedly.' });
    recording = make({ record: 'lost' }).record({ path: join(dir, 'd.wav'), maxSeconds: 60 });
    assert.equal((await recording.done).code, 'device-lost'); assert.ok(!existsSync(join(dir, 'd.wav')));
    recording = new NativeAudio({ command: join(dir, 'missing-helper'), supported: true }).record({ path: join(dir, 'e.wav'), maxSeconds: 60 });
    assert.equal((await recording.done).code, 'spawn');
  } finally { delete process.env.PADCODE_AUDIO_FIXTURE; }
});

const helper = resolve('build/native/padcode-audio');
test('C4-A5 native padcode-audio: synthetic WAV, file safety, stop, cancel, EOF, SIGTERM, cap and diagnose', async t => {
  // The helper is macOS-only; other platforms must not ship it and report voice as unavailable (covered above).
  if (process.platform !== 'darwin') { assert.ok(!existsSync(helper)); assert.equal(new NativeAudio().supported, false); return; }
  const dir = await temporary(t);
  const run = (args, input) => new Promise(resolvePromise => {
    const child = spawn(helper, args, { stdio: ['pipe', 'pipe', 'pipe'] }); let out = '';
    child.stdout.on('data', d => { out += d; }); child.on('close', code => { child.stdin.destroy(); resolvePromise({ code, lines: out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), child }); });
    input?.(child);
  });
  let r = await run(['record', '--synthetic', '--out', join(dir, 'a.wav')], child => setTimeout(() => child.stdin.write('stop\n'), 450));
  assert.equal(r.code, 0); assert.equal(r.lines[0].event, 'started'); assert.equal(r.lines[1].event, 'live'); assert.ok(r.lines.some(line => line.event === 'level'));
  const end = r.lines.at(-1); assert.equal(end.event, 'stopped');
  const file = (await import('node:fs')).readFileSync(join(dir, 'a.wav'));
  assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.equal(file.toString('ascii', 8, 12), 'WAVE');
  assert.equal(file.readUInt16LE(20), 1); assert.equal(file.readUInt16LE(22), 1); assert.equal(file.readUInt32LE(24), 16000); assert.equal(file.readUInt16LE(34), 16);
  assert.equal(file.readUInt32LE(40), file.length - 44); assert.equal(end.bytes, file.length);
  assert.equal((await stat(join(dir, 'a.wav'))).mode & 0o777, 0o600);
  r = await run(['record', '--synthetic', '--out', join(dir, 'a.wav')], child => child.stdin.end()); assert.equal(r.lines.at(-1).code, 'io');
  await symlink(join(dir, 'target.wav'), join(dir, 'link.wav'));
  r = await run(['record', '--synthetic', '--out', join(dir, 'link.wav')], child => child.stdin.end()); assert.equal(r.lines.at(-1).code, 'io'); assert.ok(!existsSync(join(dir, 'target.wav')));
  for (const [name, stop] of [['cancel', child => setTimeout(() => child.stdin.write('cancel\n'), 200)], ['eof', child => setTimeout(() => child.stdin.end(), 200)], ['term', child => setTimeout(() => child.kill('SIGTERM'), 200)]]) {
    r = await run(['record', '--synthetic', '--out', join(dir, `${name}.wav`)], stop);
    assert.equal(r.lines.at(-1).event, 'cancelled', name); assert.ok(!existsSync(join(dir, `${name}.wav`)), name);
  }
  r = await run(['record', '--synthetic', '--max-seconds', '0.3', '--out', join(dir, 'cap.wav')]);
  assert.equal(r.lines.at(-1).event, 'stopped'); assert.ok(Math.abs(r.lines.at(-1).seconds - 0.3) < 1e-9);
  r = await run(['record', '--out']); assert.equal(r.lines.at(-1).code, 'usage');
  r = await run(['diagnose']); assert.equal(r.lines[0].selfResponsible, true); assert.equal(r.lines[0].usageDescription, true);
  r = await run(['list']); assert.equal(r.lines[0].ok, true); assert.ok(Array.isArray(r.lines[0].devices));
  for (const device of r.lines[0].devices) { assert.equal(typeof device.id, 'string'); assert.equal(typeof device.name, 'string'); assert.equal(typeof device.default, 'boolean'); assert.ok(['bluetooth', 'usb', 'built-in', 'other', 'unknown'].includes(device.transport)); }
  r = await run(['permission']); assert.ok(['authorized', 'denied', 'restricted', 'not-determined'].includes(r.lines[0].status));
});
