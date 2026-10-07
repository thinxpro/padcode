import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('terminal-only setup and subsequent player hub work in a real PTY', { timeout: 30000 }, () => {
  const result = spawnSync('python3', ['test/onboarding_pty.py'], { encoding: 'utf8', timeout: 28000, env: { ...process.env, PADCODE_NODE: process.execPath } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /Onboarding PTY passed/);
});
