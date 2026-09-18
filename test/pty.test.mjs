import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Python's standard-library PTY verifies actual termios and escape cleanup, not mocked streams.
test('real PTY UI, resize, raw mode cleanup and child reaping', { timeout: 30000 }, () => {
  const r = spawnSync('python3', ['test/pty_check.py'], { encoding: 'utf8', timeout: 28000, env: { ...process.env, PADCODE_NODE: process.execPath } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /PTY checks passed/);
});
