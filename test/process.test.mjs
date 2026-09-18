import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, helperPath } from '../dist/process.js';
test('bounded runner handles Unicode, nonzero exits and missing executables', async () => {
  const result = await runCommand(process.execPath, ['-e', 'const b=Buffer.from("手柄");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20);process.stderr.write("error");process.exitCode=7']);
  assert.equal(result.stdout, '手柄'); assert.equal(result.stderr, 'error'); assert.equal(result.code, 7);
  assert.match(helperPath('padcode-controller'), /build\/native\/padcode-controller$/);
  await assert.rejects(runCommand('/padcode-missing-executable', []), /ENOENT/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.from([255]))']), /encoded data/);
});
test('timeouts, output limits and cancellation reap child processes', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 60 }), /timed out/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.stdout.write("a".repeat(5000));setInterval(()=>{},1000)'], { maxBytes: 100 }), /output limit/);
  const controller = new AbortController();
  const pending = runCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(runCommand(process.execPath, [], { signal: controller.signal }));
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.kill(process.pid,"SIGTERM")']), /SIGTERM/);
});
