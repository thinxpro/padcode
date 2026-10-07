import test from 'node:test';
import { childEnv } from './child-env.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('controller events operate the terminal setup and hub through a real PTY', { timeout: 30000 }, () => {
  const result = spawnSync('python3', ['test/menu-pty.py'], { encoding: 'utf8', timeout: 25000, env: childEnv({ PADCODE_NODE: process.execPath }) });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
test('plain terminal text entry ignores gamepad actions and circle selects Back', { timeout: 20000 }, () => {
  const result = spawnSync('python3', ['test/menu-text-pty.py'], { encoding: 'utf8', timeout: 15000, env: childEnv({ PADCODE_NODE: process.execPath }) });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
test('Ctrl+C in a controller-operated menu restores terminal and reaps the helper', { timeout: 20000 }, () => {
  const result = spawnSync('python3', ['test/menu-text-pty.py', 'abort'], { encoding: 'utf8', timeout: 15000, env: childEnv({ PADCODE_NODE: process.execPath }) });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
