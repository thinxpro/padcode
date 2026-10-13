import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './child-env.mjs';
import { sentence } from '../scripts/demo/timeline.mjs';

const demoDirs = () => readdirSync(realpathSync('/tmp')).filter(name => name.startsWith('padcode-demo-')).sort();

// The README demo needs tmux like the controls-pane suite; a missing binary is a failed gate.
test('scripted demo plays the full storyline through real Padcode screens and cleans up', { timeout: 170000 }, () => {
  const tmux = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(tmux, 'tmux 3.2+ is required for the demo suite. Install it before npm run check.');
  const work = mkdtempSync(join(tmpdir(), 'padcode-demo-test-')), trace = join(work, 'trace.jsonl');
  const before = demoDirs();
  try {
    const r = spawnSync('python3', ['test/demo_pty.py', trace], { encoding: 'utf8', timeout: 165000, env: childEnv({ PADCODE_NODE: process.execPath }) });
    assert.equal(r.status, 0, r.stderr);
    const entries = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(entries.filter(entry => entry.error), []);
    const step = name => { const found = entries.find(entry => entry.step === name); assert.ok(found, `step ${name} missing`); return found; };
    assert.match(step('hub').screen, /PLAYER HUB[\s\S]*START AGENT SESSION\s+demo-agent in my-app/);
    assert.match(step('hub').screen, /Demo Mic \/ demo-transc/);
    assert.match(step('confirm').screen, /MISSION START[\s\S]*EXEC \S+\/bin\/demo-agent[\s\S]*PROJECT \S+\/my-app/);
    assert.match(step('session').screen, /demo-agent[\s\S]*PADCODE . GAMEPAD/);
    // Dictation is typed into the Agent's input and not sent until X.
    assert.equal(step('inserted').agent.input, sentence);
    assert.deepEqual(step('inserted').agent.submitted, []);
    assert.match(step('inserted').screen, /INSERTED 43 CHARS/);
    assert.match(step('approval').screen, /Apply this edit\?[\s\S]*1\. Yes, apply it/);
    assert.deepEqual(step('answered').agent.answers, ['yes']);
    assert.match(step('commands').screen, /QUICK COMMANDS[\s\S]*\/test\s+Custom/);
    assert.equal(step('typed').agent.input, '/test');
    assert.deepEqual(step('tested').agent.submitted, [sentence, '/test']);
    assert.match(step('controls').screen, /PADCODE CONTROLS[\s\S]*End session/);
    assert.match(step('end').screen, /END SESSION\?/);
    assert.match(step('over').screen, /SESSION OVER/);
    assert.equal(step('over').agent.phase, 'exited');
    // Every recorded screen after launch carries the simulated-input label.
    for (const entry of entries.filter(entry => entry.screen)) assert.match(entry.hud, /VIRTUAL CONTROLLER \/ scripted demo/, entry.step);
    assert.ok(entries.some(entry => entry.step === 'done'));
    assert.equal(JSON.parse(r.stdout).code, 0, r.stdout);
    assert.deepEqual(demoDirs(), before, 'the demo left its temporary directory behind');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('demo refuses to run without a terminal and the recorder names missing tools', () => {
  const plain = spawnSync(process.execPath, ['scripts/demo/run.mjs'], { encoding: 'utf8', env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(plain.status, 2);
  assert.match(plain.stderr, /needs an interactive terminal/);
  const record = spawnSync(process.execPath, ['scripts/demo/record.mjs'], { encoding: 'utf8', env: childEnv({ PATH: '/nonexistent' }) });
  assert.equal(record.status, 2);
  assert.match(record.stderr, /missing vhs \(brew install vhs\), tmux \(brew install tmux\)/);
});
