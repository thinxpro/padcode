import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { childEnv } from './child-env.mjs';
test('full-screen menu: input rules, intro sweep, resize and terminal restoration', { timeout: 90000 }, () => {
  const r = spawnSync('python3', ['test/screen-menu-pty.py'], { encoding: 'utf8', timeout: 85000, env: childEnv({ PADCODE_NODE: process.execPath }) });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /Screen menu PTY passed/);
});
