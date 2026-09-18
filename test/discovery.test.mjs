import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeBluetooth } from '../dist/bluetooth.js';

test('native discovery preserves results and distinguishes completion, timeout, abort and cancellation', async t => {
  if (process.platform !== 'darwin') return assert.rejects(new NativeBluetooth(process.platform).list(true, new AbortController().signal), /macOS/);
  const root = await mkdtemp(join(tmpdir(), 'padcode-discovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  assert.equal(sdk.status, 0, sdk.stderr);
  const binary = join(root, 'discovery-test');
  const built = spawnSync('xcrun', ['clang', '-isysroot', sdk.stdout.trim(), '-fobjc-arc', '-Wall', '-Wextra', '-Werror', 'test/fixtures/discovery-harness.m', 'native/discovery.m', '-framework', 'Foundation', '-framework', 'IOBluetooth', '-o', binary], { encoding: 'utf8', timeout: 20000 });
  assert.equal(built.status, 0, built.stderr);
  const run = mode => {
    const r = spawnSync(binary, [mode], { encoding: 'utf8', timeout: 3000 });
    assert.equal(r.status, 0, `${mode}: ${r.stderr}`); return JSON.parse(r.stdout);
  };
  const complete = run('complete');
  assert.equal(complete.ok, true); assert.equal(complete.devices.length, 1);
  assert.equal(complete.devices[0].name, 'Wireless Controller'); assert.equal(complete.scan.complete, true);
  const empty = run('empty'); assert.deepEqual(empty.devices, []); assert.equal(empty.scan.complete, true);
  for (const mode of ['partial', 'stored-only']) {
    const result = run(mode); assert.equal(result.ok, true); assert.equal(result.devices.length, 1);
    assert.equal(result.devices[0].name, 'Unnamed Bluetooth device');
    assert.equal(result.devices[0].address, '00:11:22:33:44:55');
    assert.deepEqual(result.scan, { complete: false, started: true, discovered: 1, reason: 'deadline', nativeError: 0 });
  }
  const nativeError = run('error'); assert.equal(nativeError.ok, true); assert.equal(nativeError.scan.complete, false); assert.equal(nativeError.scan.reason, 'native-error'); assert.notEqual(nativeError.scan.nativeError, 0); assert.equal(nativeError.devices.length, 1);
  for (const [mode, code] of [['not-started','scan-not-started'], ['timeout','scan-timeout'], ['aborted','scan-aborted'], ['empty-error','scan-error'], ['start-error','scan-start'], ['cancel','cancelled'], ['pre-cancel','cancelled'], ['unavailable','scan-unavailable']]) {
    const result = run(mode); assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(result.devices, undefined);
  }
});
