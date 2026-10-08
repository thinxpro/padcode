import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { VoiceCapture } from '../dist/voice-session.js';
import { SessionControls, draftItems } from '../dist/session-controls.js';
import { NativeAudio } from '../dist/audio.js';
import { setup } from '../dist/onboarding.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
async function eventually(check, message) { const end = Date.now() + 3000; while (!check()) { assert.ok(Date.now() < end, message); await wait(5); } }
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'padcode-draft-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

// Fake microphone whose recordings stop immediately; transcription goes through the system tier of a fake AudioPort.
function session(t, dir, transcriber, speech = {}) {
  const calls = [], drafts = []; let handler, clock = 1000;
  const audio = {
    supported: true, requests: 0,
    record(options) { writeFileSync(options.path, 'RIFF'); let live, finish; const done = new Promise(r => { finish = r; }); const recording = { done, onStarted() {}, onLevel() {}, onLive(fn) { live = fn; }, stop() { finish({ kind: 'stopped', seconds: 1.5 }); }, cancel() { finish({ kind: 'cancelled' }); } }; setTimeout(() => live?.(), 1); return recording; },
    async transcribe(path, locale, signal) {
      calls.push(`transcribe:${locale}`);
      if (speech.slow) { await new Promise(r => signal.addEventListener('abort', r)); return { ok: false, code: 'cancelled', message: 'x' }; }
      return speech.result ?? { ok: true, text: ` 修复 bug\x1b[31m ` };
    },
    async speechRequest() { audio.requests++; return speech.answer ?? 'authorized'; },
  };
  const voice = new VoiceCapture(audio, dir, 'mic', {
    routing: () => true,
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' ')[0]}`); },
    release: resume => { handler = undefined; calls.push(`release:${resume}`); },
    status: text => calls.push(`status:${text.split(' ')[0]}`),
    notice: text => calls.push(`notice:${text}`),
    draft: text => drafts.push(text),
  }, () => clock, 60, transcriber);
  const take = () => { clock += 200; voice.trigger(0.1); clock += 200; voice.trigger(0.9); clock += 200; voice.trigger(0.1); };
  return { voice, audio, calls, drafts, take, press: b => handler?.(b) };
}

test('C5-A2 recording -> TRANSCRIBING -> cleaned draft; nothing else happens to the Agent', async t => {
  const dir = await temporary(t), s = session(t, dir, { kind: 'system', language: 'zh' });
  s.take(); await eventually(() => s.drafts.length === 1, 'no draft');
  assert.deepEqual(s.drafts, ['修复 bug[31m']); assert.ok(s.calls.includes('capture:TRANSCRIBING...')); assert.ok(s.calls.includes('transcribe:zh-CN'));
  assert.equal(s.voice.state, 'idle'); assert.ok(s.voice.last, 'recording kept for playback');
  assert.equal(s.calls.filter(c => c.startsWith('capture')).length >= 1, true); assert.equal(s.calls.at(-1), 'release:true');
  s.voice.dispose();
});

test('C5-A2 empty, failed, cancelled, late and permission-required transcriptions', async t => {
  const dir = await temporary(t);
  let s = session(t, dir, { kind: 'system', language: 'zh' }, { result: { ok: true, text: '' } });
  s.take(); await eventually(() => s.calls.some(c => c.startsWith('notice:NO SPEECH')));
  assert.deepEqual(s.drafts, []); s.voice.dispose();
  s = session(t, dir, { kind: 'system', language: 'zh' }, { result: { ok: false, code: 'exit', message: 'model missing' } });
  s.take(); await eventually(() => s.calls.includes('notice:TRANSCRIPTION FAILED / model missing')); s.voice.dispose();
  s = session(t, dir, { kind: 'system', language: 'zh' }, { slow: true });
  s.take(); await eventually(() => s.voice.state === 'transcribing'); s.press('south'); s.press('dpad_up'); assert.equal(s.voice.state, 'transcribing');
  s.press('east'); await eventually(() => s.calls.includes('notice:TRANSCRIPTION CANCELLED')); assert.deepEqual(s.drafts, []); s.voice.dispose();
  s = session(t, dir, { kind: 'system', language: 'zh' }, { slow: true });
  s.take(); await eventually(() => s.voice.state === 'transcribing'); const before = s.calls.length; s.voice.dispose(); await wait(30);
  assert.deepEqual(s.drafts, []); assert.equal(s.calls.length, before, 'late transcription result acted after session end');
  s = session(t, dir, { kind: 'system', language: 'zh' }, { result: { ok: false, code: 'speech-permission-required', message: 'x' } });
  s.take(); await eventually(() => s.calls.includes('notice:SPEECH READY / Hold L2 to record again'));
  assert.equal(s.audio.requests, 1); assert.ok(s.calls.includes('notice:SPEECH PERMISSION / Answer the macOS dialog for Padcode Audio')); s.voice.dispose();
  s = session(t, dir, { kind: 'system', language: 'zh' }, { result: { ok: false, code: 'speech-permission-required', message: 'x' }, answer: 'denied' });
  s.take(); await eventually(() => s.calls.some(c => c.startsWith('notice:SPEECH DENIED'))); s.voice.dispose();
});

test('C5 draft review context: keep, rerecord, discard, reopen and every button', () => {
  const calls = []; let handler;
  const controls = new SessionControls({
    capture: (fn, status) => { handler = fn; calls.push(`capture:${status.split(' / ')[0]}`); }, release: r => { handler = undefined; calls.push(`release:${r}`); },
    interrupt: () => calls.push('interrupt'), showMenu: view => calls.push(view ? `menu:${view.title}:${view.selected}:${view.body ?? '-'}:${view.items.join('|')}` : 'menu:close'),
    history: c => calls.push(`history:${c}`), end: () => calls.push('end'), notice: text => calls.push(`notice:${text}`), insert: text => calls.push(`insert:${text}`),
  });
  controls.openDraft('帮我修复 bug');
  assert.equal(controls.context, 'draft'); assert.deepEqual(calls, ['capture:VOICE DRAFT', `menu:VOICE DRAFT:0:帮我修复 bug:${draftItems.join('|')}`]);
  for (const button of ['dpad_left', 'dpad_right', 'west', 'north', 'left_shoulder', 'right_shoulder', 'back', 'guide']) handler(button);
  assert.equal(calls.length, 2, 'unmapped buttons acted in the draft');
  handler('east'); assert.equal(controls.context, 'agent'); assert.equal(controls.draftText, '帮我修复 bug'); assert.deepEqual(calls.slice(-2), ['menu:close', 'release:true']);
  // Reopen from the controls menu: "Review voice draft" sits before End session.
  calls.length = 0; controls.openMenu(); assert.match(calls.at(-1), /Review voice draft\|End session/);
  for (let i = 0; i < 6; i++) handler('dpad_down');
  handler('south'); assert.equal(controls.context, 'draft');
  handler('dpad_down'); handler('dpad_down'); handler('south'); assert.equal(controls.draftText, undefined); assert.ok(calls.includes('notice:DRAFT DISCARDED / Hold L2 to record again'));
  controls.openDraft('second'); handler('dpad_up'); handler('south'); assert.equal(controls.draftText, undefined); assert.ok(calls.includes('notice:DRAFT DISCARDED'));
  // Default X inserts the reviewed text; the draft stays available for Insert again.
  controls.openDraft('third'); handler('south'); assert.equal(controls.draftText, 'third'); assert.deepEqual(calls.slice(-1), ['insert:third']);
  controls.openDraft('kept'); handler('dpad_down'); handler('south'); assert.equal(controls.draftText, 'kept'); assert.ok(!calls.includes('insert:kept'));
  controls.openDraft('fourth'); handler('start'); assert.equal(controls.draftText, 'fourth'); assert.equal(controls.context, 'agent');
  controls.openDraft('keyboard'); controls.key('confirm', 3); assert.equal(controls.draftText, undefined);
  // A draft arriving while the menu is open waits for the menu to close and is offered in the menu.
  controls.openMenu(); calls.length = 0; controls.openDraft('waiting'); assert.equal(controls.context, 'menu'); assert.deepEqual(calls, []);
});

// Detection is injected so the real whisper-cli or models on this machine never leak into the test.
let tools;
function harness(choices, audio, answers = []) {
  const output = [];
  const io = {
    banner: text => output.push(text), say: text => output.push(text),
    ask: async label => { output.push(`ASK ${label}`); assert.ok(answers.length, `missing answer: ${label}`); return answers.shift(); },
    choose: async (label, options, selected = 0) => {
      output.push(`${label} DEFAULT:${options[selected]?.value}`); output.push(options.map(option => option.label).join(' | '));
      const value = choices.shift(); assert.ok(options.some(option => option.value === value), `invalid choice ${value}: ${label} [${options.map(o => o.value)}]\n${output.slice(-8).join('\n')}`); return value;
    },
  };
  return { io, output, services: { bluetooth: { list: async () => [] }, probe: () => ({}), agents: async () => [], resolve: async () => null, save: async () => {}, audio, whisper: tools } };
}
const base = ['later', 'skip', 'later', 'terminal-basic', 'choose', '0', 'skip'];
test('C5-A3 setup transcription tiers: macOS speech, whisper.cpp detection and consented download, custom command, self-test', async t => {
  const dir = await temporary(t), bin = join(dir, 'bin'), data = join(dir, 'data');
  await mkdir(bin); await mkdir(join(data, 'padcode/models'), { recursive: true });
  const fakeWhisper = join(bin, 'whisper-cli');
  await writeFile(fakeWhisper, `#!/bin/sh\nexec "${process.execPath}" "${resolve('test/fixtures/fake-transcriber.mjs')}" ok "$@"\n`, { mode: 0o755 });
  const model = join(data, 'padcode/models/ggml-small.bin'); await writeFile(model, Buffer.alloc(2 * 1024 * 1024));
  const saved = { PATH: process.env.PATH, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  const server = createServer((request, response) => { response.writeHead(404); response.end(); }); server.listen(0); await once(server, 'listening');
  t.after(() => { process.env.PATH = saved.PATH; if (saved.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved.XDG_DATA_HOME; delete process.env.PADCODE_AUDIO_FIXTURE; delete process.env.PADCODE_MODEL_SOURCE; server.close(); });
  process.env.PATH = `${bin}:/usr/bin:/bin`; process.env.XDG_DATA_HOME = data;
  let installed = true;
  tools = { findWhisper: async () => installed ? fakeWhisper : null, findModels: async () => [model] };
  const audio = settings => { process.env.PADCODE_AUDIO_FIXTURE = JSON.stringify(settings); return new NativeAudio({ command: process.execPath, args: [resolve('test/fixtures/audio-helper.mjs')], player: resolve('test/fixtures/fake-player.sh'), supported: true }); };
  const run = async (choices, settings = {}, answers = []) => { const h = harness([...base, ...choices, 'save'], audio(settings), answers); const config = await setup(h.io, h.services, new AbortController().signal); return { config, text: h.output.join('\n') }; };

  let r = await run(['system', 'zh', 'try', 'done', 'auto'], { speech: 'not-determined', speechRequest: 'authorized' });
  assert.deepEqual(r.config.voice.transcriber, { kind: 'system', language: 'zh' });
  assert.match(r.text, /Padcode sends audio nowhere/); assert.match(r.text, /Speech Recognition/); assert.match(r.text, /SELF-TEST PASSED/); assert.match(r.text, /HEARD {2}system zh-CN: 你好 world/);
  assert.match(r.text, /VOICE {3}Fixture Mic \/ macOS on-device speech \(zh\)/);
  // Keeping the microphone after an update: the lost grant is requested before anything records.
  const initial = { version: 2, controller: { transport: 'bluetooth', inputVerified: false }, agent: null, profile: 'terminal-basic', voice: { microphone: { id: 'mic-1', name: 'Fixture Mic' }, transcriber: { kind: 'system', language: 'zh' } } };
  let h = harness(['later', 'skip', 'later', 'terminal-basic', 'keep', 'keep', 'auto', 'save'], audio({ permission: 'not-determined', request: 'authorized' }));
  let config = await setup(h.io, h.services, new AbortController().signal, initial);
  assert.deepEqual(config.voice, { ...initial.voice, insert: 'auto' }); assert.match(h.output.join('\n'), /macOS will now ask whether Padcode Audio may use the microphone/);
  // A denied microphone makes the try fail with guidance and offers Try again instead of moving on.
  h = harness(['later', 'skip', 'later', 'terminal-basic', 'keep', 'system', 'zh', 'try', 'try', 'done', 'review', 'save'], audio({ permission: 'denied' }));
  config = await setup(h.io, h.services, new AbortController().signal, initial);
  const text = h.output.join('\n');
  assert.equal((text.match(/Privacy & Security > Microphone/g) ?? []).length >= 3, true); assert.match(text, /Try it DEFAULT:try\nTry again \| Done/);
  assert.ok(!/RECORDING 5 SECONDS/.test(text), 'recorded without microphone access');
  r = await run(['system', 'en', 'none'], { speech: 'denied' });
  assert.equal(r.config.voice.transcriber, null); assert.match(r.text, /TRANSCRIPTION NOT READY: Speech recognition is not allowed/);
  r = await run(['system', 'other', 'done', 'review'], {}, ['ja']);
  assert.deepEqual(r.config.voice.transcriber, { kind: 'system', language: 'ja' });
  r = await run(['whisper', 'zh', 'found:0', 'done', 'auto']);
  assert.deepEqual(r.config.voice.transcriber, { kind: 'command', command: fakeWhisper, args: ['-m', model, '-l', '{language}', '-nt', '-np', '-f', '{audio}'], language: 'zh' });
  // Download needs consent; declining downloads nothing, and a failed download reports and cleans up.
  r = await run(['whisper', 'zh', 'download:0', 'cancel', 'none']);
  assert.match(r.text, /SOURCE {3}https:\/\/huggingface.co\/ggerganov\/whisper.cpp\/resolve\/main\/ggml-large-v3-turbo-q5_0.bin/); assert.match(r.text, /574 MB/);
  assert.match(r.text, /Model download cancelled; nothing was downloaded/);
  process.env.PADCODE_MODEL_SOURCE = `http://127.0.0.1:${server.address().port}`;
  r = await run(['whisper', 'zh', 'download:0', 'yes', 'none']);
  assert.match(r.text, /TRANSCRIPTION NOT READY: Download failed \(HTTP 404\)/);
  assert.deepEqual((await readdir(join(data, 'padcode/models'))).sort(), ['ggml-small.bin']);
  installed = false;
  r = await run(['whisper', 'zh', 'none']); assert.match(r.text, /whisper.cpp is not installed.*brew install whisper-cpp/);
  r = await run(['custom', 'auto', 'done', 'auto'], {}, [process.execPath, resolve('test/fixtures/fake-transcriber.mjs'), 'ok', '{audio}', '']);
  assert.deepEqual(r.config.voice.transcriber, { kind: 'command', command: process.execPath, args: [resolve('test/fixtures/fake-transcriber.mjs'), 'ok', '{audio}'], language: 'auto' });
  r = await run(['custom', 'zh', 'none'], {}, [process.execPath, 'no-audio-placeholder', '']);
  assert.match(r.text, /Add an argument containing \{audio\}/);
  r = await run(['custom', 'zh', 'none'], {}, [process.execPath, resolve('test/fixtures/fake-transcriber.mjs'), 'fail', '{audio}', '']);
  assert.match(r.text, /Self-test failed: The transcriber exited with status 3/); assert.equal(r.config.voice.transcriber, null);
  const owned = name => { try { return readFileSync(join(tmpdir(), name, 'owner'), 'utf8') === String(process.pid); } catch { return false; } };
  const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith('pcv-') && owned(name));
  assert.deepEqual(leftovers, [], 'setup self-test folders kept');
});
