import test from 'node:test';
import assert from 'node:assert/strict';
import { insertionLine, shortAnswer } from '../dist/panel-session.js';
import { parseToAgent, parseFromAgent } from '../dist/session-ipc.js';
import { validateConfig } from '../dist/config.js';
import { cleanTranscript } from '../dist/transcribe.js';

test('C6-A1 inserted text is one cleaned line that cannot contain Enter or escape bytes', () => {
  assert.equal(insertionLine('이 bug 고쳐 줘\n\n그다음 테스트'), '이 bug 고쳐 줘 그다음 테스트');
  assert.equal(insertionLine('  a \n  b  '), 'a b');
  for (const raw of ['ok\r\n\x1b[201~\x1b]52;c;evil\x07rm -rf\u0085\n', '\x1b[200~x\x1b[201~\r', 'line\nline\rline']) {
    const line = insertionLine(cleanTranscript(raw));
    assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(line), JSON.stringify(line));
  }
});

test('C6-A2 short-answer guard holds tiny or yes/no-like transcripts for review', () => {
  for (const text of ['1', 'y', 'N', '네', 'OK', '2.', ' 12 ', '1, 2', 'yes'.slice(0, 1), '！？', '3。']) assert.equal(shortAnswer(text), true, text);
  for (const text of ['로그인 화면 고쳐', 'run the tests', 'yes please continue', '수정 bug']) assert.equal(shortAnswer(text), false, text);
});

test('C6 IPC: paste chunks, undo and undo results are bounded and control-free', () => {
  assert.deepEqual(parseToAgent(JSON.stringify({ t: 'paste-part', text: '안녕 🎮' })), { t: 'paste-part', text: '안녕 🎮' });
  assert.deepEqual(parseToAgent('{"t":"paste-end"}'), { t: 'paste-end' });
  assert.deepEqual(parseToAgent('{"t":"undo","count":21}'), { t: 'undo', count: 21 });
  for (const bad of [{ t: 'paste-part', text: '' }, { t: 'paste-part', text: 'a\rb' }, { t: 'paste-part', text: '\x1b[201~' }, { t: 'paste-part', text: 'x'.repeat(1025) }, { t: 'paste-end', x: 1 }, { t: 'undo', count: 0 }, { t: 'undo', count: 1.5 }, { t: 'undo', count: 70000 }]) {
    assert.throws(() => parseToAgent(JSON.stringify(bad)), JSON.stringify(bad));
  }
  assert.deepEqual(parseFromAgent('{"t":"undo-result","ok":false,"reason":"input"}'), { t: 'undo-result', ok: false, reason: 'input' });
  assert.throws(() => parseFromAgent('{"t":"undo-result","ok":"yes","reason":""}'));
});

test('C6 configuration: insertion mode defaults to auto and rejects unknown values', () => {
  const base = { version: 2, controller: { transport: 'usb', inputVerified: false }, agent: null, profile: 'terminal-basic' };
  const voice = { microphone: { id: 'm', name: 'Mic' }, transcriber: { kind: 'system', language: 'zh' } };
  assert.equal(validateConfig({ ...base, voice }).voice.insert, 'auto');
  assert.equal(validateConfig({ ...base, voice: { ...voice, insert: 'review' } }).voice.insert, 'review');
  assert.throws(() => validateConfig({ ...base, voice: { ...voice, insert: 'submit' } }));
});
