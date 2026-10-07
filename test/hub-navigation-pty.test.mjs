import test from 'node:test';
import { childEnv } from './child-env.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('every Player Hub screen returns to the Hub', { timeout: 150000 }, () => {
  const r = spawnSync('python3', ['test/hub-navigation-pty.py'], { encoding: 'utf8', timeout: 145000, env: childEnv({ PADCODE_NODE: process.execPath }) });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /Hub navigation PTY passed/);
});
