import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('Player Hub launch transfers the controller into the Agent session', { timeout: 40000 }, () => {
  const r = spawnSync('python3', ['test/hub-agent-pty.py'], { encoding: 'utf8', timeout: 38000, env: { ...process.env, PADCODE_NODE: process.execPath } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /Hub Agent PTY passed/);
});
