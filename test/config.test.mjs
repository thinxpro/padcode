import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, validateConfig, loadConfig, saveConfig, resolveExecutable, discoverAgents } from '../dist/config.js';
const valid = () => ({ version: 2, controller: { transport: 'bluetooth', inputVerified: false }, agent: null, profile: 'terminal-basic', voice: null });
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'padcode-config-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('configuration schema strips unrelated data and rejects invalid settings', () => {
  assert.deepEqual(validateConfig({ ...valid(), secret: 'do-not-persist' }), valid());
  for (const c of [null, {}, { ...valid(), version: 3 }, { ...valid(), voice: {} }, { ...valid(), voice: { microphone: { id: '', name: 'x' } } }, { ...valid(), voice: { microphone: { id: 'a\x1b', name: 'x' } } }, { ...valid(), voice: { microphone: { id: 'a', name: 7 } } }, { ...valid(), controller: {} }, { ...valid(), controller: { transport: 'bad', inputVerified: false } }, { ...valid(), controller: { transport: 'usb', inputVerified: 'yes' } }, { ...valid(), controller: { transport: 'usb', inputVerified: false, name: '\x1bunsafe' } }, { ...valid(), controller: { transport: 'bluetooth', inputVerified: false, address: 'invalid' } }, { ...valid(), agent: { command: 'relative', args: [] } }, { ...valid(), agent: { command: '/bin/echo', args: ['\0'] } }, { ...valid(), profile: 'unknown' }]) assert.throws(() => validateConfig(c));
  assert.equal(configPath({ XDG_CONFIG_HOME: '/tmp/custom' }), '/tmp/custom/padcode/config.json');
  assert.ok(configPath({ XDG_CONFIG_HOME: 'relative' }).startsWith('/'));
});
test('C4-A6 version 1 configuration migrates to version 2 with voice off and keeps voice data exact', async t => {
  const { voice, ...legacy } = { ...valid(), version: 1 };
  assert.deepEqual(validateConfig(legacy), valid()); assert.equal(voice, null);
  assert.deepEqual(validateConfig({ ...legacy, voice: { microphone: { id: 'ignored', name: 'v1 had no voice' } } }), valid());
  const withVoice = { ...valid(), voice: { microphone: { id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone', extra: 1 } } };
  assert.deepEqual(validateConfig(withVoice).voice, { microphone: { id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone' }, transcriber: null });
  assert.deepEqual(validateConfig({ ...valid(), voice: undefined }).voice, null);
  const dir = await temporary(t), file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify(legacy)); assert.deepEqual(await loadConfig(file), valid());
  await saveConfig(await loadConfig(file), file); assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 2);
});
test('private atomic save, reload, replacement and no leftover temporary files', async t => {
  const dir = await temporary(t), file = join(dir, 'settings', 'config.json');
  assert.equal(await loadConfig(file), null);
  const first = valid(); await saveConfig(first, file); assert.deepEqual(await loadConfig(file), first);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const next = { ...valid(), agent: { command: process.execPath, args: ['--literal', 'space argument', '$(never-run)'] } };
  await saveConfig(next, file); assert.deepEqual(await loadConfig(file), next);
  assert.deepEqual(await readdir(join(dir, 'settings')), ['config.json']);
  await assert.rejects(saveConfig({ ...next, version: 3 }, file)); assert.deepEqual(await loadConfig(file), next);
});
test('corrupt/oversized config and filesystem errors do not silently reset data', async t => {
  const dir = await temporary(t), file = join(dir, 'config.json');
  await writeFile(file, '{bad'); await assert.rejects(loadConfig(file), /Cannot read config/); assert.equal(await readFile(file, 'utf8'), '{bad');
  await writeFile(file, 'x'.repeat(65537)); await assert.rejects(loadConfig(file), /too large/);
  await assert.rejects(saveConfig(valid(), join(file, 'child')), /ENOTDIR|EEXIST/);
  const destination = join(dir, 'directory'); await mkdir(destination); await writeFile(join(destination, 'keep'), 'old');
  await assert.rejects(saveConfig(valid(), destination)); assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'old');
  assert.ok(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
});
test('Agent discovery checks executables but never runs them; arguments are not shell code', async t => {
  const dir = await temporary(t), executable = join(dir, 'codex'), sentinel = join(dir, 'executed');
  await writeFile(executable, `#!/bin/sh\ntouch '${sentinel}'\n`, { mode: 0o755 });
  await writeFile(join(dir, 'claude'), 'not executable');
  await mkdir(join(dir, 'gemini'));
  assert.deepEqual(await discoverAgents(dir), [{ label: 'codex', command: executable }]);
  assert.equal(await resolveExecutable('./codex', '', dir), executable);
  assert.equal(await resolveExecutable('codex', dir), executable);
  for (const command of ['', '\x1bfoo', 'codex; touch bad', 'claude', 'gemini']) assert.equal(await resolveExecutable(command, dir), null);
  await assert.rejects(stat(sentinel), { code: 'ENOENT' });
  await chmod(executable, 0o644); assert.equal(await resolveExecutable('codex', dir), null);
});
