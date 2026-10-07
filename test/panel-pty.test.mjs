import test from 'node:test';
import { childEnv } from './child-env.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// C2 requires tmux; a missing binary is a failed gate, not a skipped test.
test('tmux controls pane isolates status from the Agent PTY through its full lifecycle', { timeout: 150000 }, () => {
  const tmux = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(tmux, 'tmux 3.2+ is required for the C2 controls-pane suite. Install it before npm run check.');
  const r = spawnSync('python3', ['test/panel_pty.py'], { encoding: 'utf8', timeout: 145000, env: childEnv({ PADCODE_NODE: process.execPath, PADCODE_TMUX: tmux }) });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /Panel PTY passed/);
  process.stdout.write(`# ${r.stdout.split('\n').find(line => line.startsWith('fixture-path latency'))}\n`);
});
