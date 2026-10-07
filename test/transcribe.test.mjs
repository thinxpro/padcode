import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { cleanTranscript, speechLocale, transcribe, writeSilentWav, downloadModel, findModels, findWhisper, whisperTranscriber, modelDirectory, whisperModels } from '../dist/transcribe.js';
import { validateConfig, validTranscriber } from '../dist/config.js';
import { NativeAudio } from '../dist/audio.js';
import { previewText, wrapText, displayWidth } from '../dist/text-width.js';

async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'padcode-transcribe-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const fake = resolve('test/fixtures/fake-transcriber.mjs');
const command = (mode, extra = []) => ({ kind: 'command', command: process.execPath, args: [fake, mode, ...extra, '{audio}'], language: 'zh' });
const alive = pid => { const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }); return Boolean(r.stdout.trim()) && !r.stdout.trim().startsWith('Z'); };

test('C5-A1 transcript cleanup keeps text and line breaks, strips every control sequence', () => {
  assert.equal(cleanTranscript('  帮我修复 bug \r\n\r\n\r\n\r\n second\tline  '), '帮我修复 bug\n\nsecond line');
  const cleaned = cleanTranscript('ls\x1b[2J\x1b]0;evil\x07 \x1b[200~paste\x1b[201~ ok\u0085\x00\x7f');
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(cleaned)); assert.equal(cleaned, 'ls[2J]0;evil [200~paste[201~ ok');
  assert.equal(cleanTranscript('naïve 日本語 🎮'), 'naïve 日本語 🎮');
  assert.deepEqual(['zh', 'en', 'auto', 'ja'].map(speechLocale), ['zh-CN', 'en-US', 'auto', 'ja']);
});

test('C5-A1 command transcriber: literal argv, output contract and every failure path', async t => {
  const dir = await temporary(t), wav = join(dir, 'a b;$(touch x).wav'); await writeSilentWav(wav);
  const run = (spec, timeout) => transcribe(spec, wav, {}, timeout).done;
  assert.deepEqual(await run(command('ok')), { ok: true, text: '帮我修复登录页面的 bug，然后运行测试。' });
  assert.deepEqual(await run(command('unicode')), { ok: true, text: 'naïve café 日本語 🎮 한국어' });
  const controls = await run(command('controls')); assert.equal(controls.ok, true); assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(controls.text)); assert.match(controls.text, /ok\nline2  tab\n\nend$/);
  assert.deepEqual(await run(command('empty')), { ok: true, text: '' });
  assert.equal((await run(command('oversize'))).code, 'too-long');
  assert.equal((await run(command('invalid'))).code, 'encoding');
  const failed = await run(command('fail')); assert.equal(failed.code, 'exit'); assert.match(failed.message, /status 3: model .*not.*found second line/); assert.ok(!failed.message.includes('\x1b'));
  assert.equal((await run({ ...command('ok'), command: join(dir, 'missing') })).code, 'spawn');
  const args = await run({ kind: 'command', command: process.execPath, args: [fake, 'args', '--lang={language}', '{audio}', '$(echo {audio})', ';'], language: 'zh' });
  assert.deepEqual(JSON.parse(args.text), [`--lang=zh`, wav, `$(echo ${wav})`, ';']); assert.ok(!existsSync(join(dir, 'x')), 'argument evaluated by a shell');
  const slow = transcribe(command('sleep'), wav, {}, 300); const timed = await slow.done; assert.equal(timed.code, 'timeout');
  const job = transcribe(command('sleep'), wav, {}); await new Promise(r => setTimeout(r, 150)); job.cancel();
  assert.equal((await job.done).code, 'cancelled');
  const ps = spawnSync('pgrep', ['-f', `${fake} sleep`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(ps, '', 'cancelled or timed-out transcriber still running');
});

test('C5-A0 macOS on-device tier through the helper: locale, unsupported language, permission and cancel', async t => {
  const dir = await temporary(t), wav = join(dir, 'a.wav'); await writeSilentWav(wav);
  const audio = settings => { process.env.PADCODE_AUDIO_FIXTURE = JSON.stringify(settings); return new NativeAudio({ command: process.execPath, args: [resolve('test/fixtures/audio-helper.mjs')], supported: true }); };
  try {
    assert.deepEqual(await transcribe({ kind: 'system', language: 'zh' }, wav, audio({})).done, { ok: true, text: 'system zh-CN: 你好 world' });
    assert.deepEqual(await transcribe({ kind: 'system', language: 'en' }, wav, audio({ text: ' a\x1b[31m\r\nb ' })).done, { ok: true, text: 'a[31m\nb' });
    assert.equal((await transcribe({ kind: 'system', language: 'ja' }, wav, audio({ transcribe: 'unsupported' })).done).code, 'unsupported-language');
    assert.equal((await transcribe({ kind: 'system', language: 'zh' }, wav, audio({ transcribe: 'permission' })).done).code, 'speech-permission-required');
    const job = transcribe({ kind: 'system', language: 'zh' }, wav, audio({ transcribe: 'slow' })); await new Promise(r => setTimeout(r, 200)); job.cancel();
    assert.equal((await job.done).code, 'cancelled');
    assert.equal(await audio({ speech: 'denied' }).speechPermission(), 'denied');
    assert.equal(await audio({ speechRequest: 'authorized' }).speechRequest(), 'authorized');
  } finally { delete process.env.PADCODE_AUDIO_FIXTURE; }
  const helper = resolve('build/native/padcode-audio');
  if (process.platform === 'darwin') {
    // Real helper: unsupported on-device languages fail without network fallback; usage errors are structured.
    const real = new NativeAudio({ command: helper, supported: true });
    const result = await real.transcribe(wav, 'xx-XX', new AbortController().signal);
    assert.equal(result.ok, false); assert.ok(['unsupported-language', 'speech-permission-required'].includes(result.code), result.code);
    assert.ok(['authorized', 'denied', 'restricted', 'not-determined'].includes(await real.speechPermission()));
  } else assert.ok(!existsSync(helper));
});

test('C5-A3 configuration: both transcriber kinds, placeholders, languages and migration', () => {
  const base = { version: 2, controller: { transport: 'usb', inputVerified: false }, agent: null, profile: 'terminal-basic' };
  const mic = { id: 'mic', name: 'Mic' };
  assert.equal(validateConfig({ ...base, voice: { microphone: mic } }).voice.transcriber, null);
  assert.deepEqual(validateConfig({ ...base, voice: { microphone: mic, transcriber: { kind: 'system', language: 'zh', extra: 1 } } }).voice.transcriber, { kind: 'system', language: 'zh' });
  const good = { kind: 'command', command: '/opt/homebrew/bin/whisper-cli', args: ['-f', '{audio}', '-l', '{language}'], language: 'auto' };
  assert.deepEqual(validateConfig({ ...base, voice: { microphone: mic, transcriber: good } }).voice.transcriber, good);
  for (const bad of [{ ...good, args: ['-f', 'x.wav'] }, { ...good, command: 'whisper-cli' }, { ...good, language: 'chinese' }, { ...good, language: 'ZH' }, { ...good, kind: 'cloud' }, { kind: 'system', language: '' }, { ...good, args: ['{audio}', 'a\x1bb'] }]) {
    assert.equal(validTranscriber(bad), false, JSON.stringify(bad));
    assert.throws(() => validateConfig({ ...base, voice: { microphone: mic, transcriber: bad } }));
  }
  assert.deepEqual(whisperTranscriber('/bin/w', '/m.bin', 'zh'), { kind: 'command', command: '/bin/w', args: ['-m', '/m.bin', '-l', '{language}', '-nt', '-np', '-f', '{audio}'], language: 'zh' });
});

test('C5-A3 whisper.cpp detection and model folders', async t => {
  const dir = await temporary(t), bin = join(dir, 'bin'), home = join(dir, 'home');
  await mkdir(bin); await writeFile(join(bin, 'whisper-cli'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(await findWhisper({ PATH: bin }), join(bin, 'whisper-cli'));
  const data = join(dir, 'data'); await mkdir(join(data, 'padcode/models'), { recursive: true });
  await writeFile(join(data, 'padcode/models/ggml-small.bin'), Buffer.alloc(2 * 1024 * 1024));
  await writeFile(join(data, 'padcode/models/ggml-tiny.bin'), 'too small');
  await writeFile(join(data, 'padcode/models/notes.txt'), Buffer.alloc(2 * 1024 * 1024));
  assert.equal(modelDirectory({ XDG_DATA_HOME: data }), join(data, 'padcode/models'));
  const found = await findModels({ XDG_DATA_HOME: data });
  assert.ok(found.includes(join(data, 'padcode/models/ggml-small.bin'))); assert.ok(!found.some(path => path.endsWith('ggml-tiny.bin') || path.endsWith('notes.txt')));
  assert.equal(whisperModels.every(model => /^[0-9a-f]{64}$/.test(model.sha256) && model.size > 1e8), true);
});

test('C5-A3 consented model download: progress, checksum, size limit, HTTP errors and abort leave no partial files', async t => {
  const dir = await temporary(t), payload = Buffer.alloc(300000, 7);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  let slow = false;
  const server = createServer((request, response) => {
    if (request.url === '/redirect/model.bin') { response.writeHead(302, { location: '/files/model.bin' }); response.end(); return; }
    if (request.url !== '/files/model.bin') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-length': payload.length });
    if (!slow) { response.end(payload); return; }
    response.write(payload.subarray(0, 1000));
  });
  server.listen(0); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, model = { file: 'model.bin', size: payload.length, sha256, label: 'test' };
  const progress = [];
  const saved = await downloadModel(model, join(dir, 'models'), { source: `${base}/redirect`, onProgress: (bytes, total) => progress.push([bytes, total]) });
  assert.deepEqual(await readFile(saved), payload); assert.equal(progress.at(-1)[0], payload.length);
  assert.equal((await stat(saved)).mode & 0o777, 0o600); assert.equal((await stat(join(dir, 'models'))).mode & 0o777, 0o700);
  await rm(saved);
  await assert.rejects(downloadModel({ ...model, sha256: '0'.repeat(64) }, join(dir, 'models'), { source: `${base}/files` }), /checksum/);
  await assert.rejects(downloadModel({ ...model, size: 1000 }, join(dir, 'models'), { source: `${base}/files` }), /larger than expected/);
  await assert.rejects(downloadModel({ ...model, file: 'missing.bin' }, join(dir, 'models'), { source: `${base}/files` }), /HTTP 404/);
  slow = true; const abort = new AbortController(); setTimeout(() => abort.abort(), 200);
  await assert.rejects(downloadModel(model, join(dir, 'models'), { source: `${base}/files`, signal: abort.signal }));
  assert.deepEqual(await readdir(join(dir, 'models')), [], 'partial or failed downloads left files');
});

test('draft text helpers: display width, wrapping and bounded previews', () => {
  assert.equal(displayWidth('ab日本🎮'), 8);
  assert.deepEqual(wrapText('帮我修复登录页面', 6), ['帮我修', '复登录', '页面']);
  assert.deepEqual(wrapText('a\nbc', 1), ['a', 'b', 'c']);
  const long = '修'.repeat(2000), preview = previewText(long);
  assert.ok(Buffer.byteLength(preview) < 2500); assert.match(preview, /\(\+1200 more characters\)$/);
  assert.equal(previewText('short'), 'short');
});
