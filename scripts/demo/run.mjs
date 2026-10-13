#!/usr/bin/env node
// Plays the scripted README demo in this terminal: real Padcode from dist/, a virtual controller, a
// stand-in Agent, microphone and transcriber, and a HUD that labels the input as simulated.
// Everything lives in a temporary directory that is removed on exit. Requires tmux 3.2+ and a build.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commands } from './timeline.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const fail = message => { process.stderr.write(`padcode demo: ${message}\n`); process.exit(2); };
if (!process.stdin.isTTY || !process.stdout.isTTY) fail('the demo needs an interactive terminal.');
if (!existsSync(join(root, 'dist/onboarding.js'))) fail('build Padcode first (npm run build).');
const tmux = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim();
if (!tmux) fail('tmux 3.2 or later is required (brew install tmux).');

// A short, readable path: the launch confirmation shows it.
const base = existsSync('/tmp') ? realpathSync('/tmp') : tmpdir();
const dir = mkdtempSync(join(base, 'padcode-demo-'));
const socket = `padcode-demo-${process.pid}`;
const cleanup = () => {
  spawnSync(tmux, ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  rmSync(dir, { recursive: true, force: true });
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cleanup(); process.exit(130); });

const shim = (name, script, args = '') => {
  const path = join(dir, 'bin', name);
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${join(here, script)}" ${args}"$@"\n`);
  chmodSync(path, 0o755);
  return path;
};
mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'my-app')); mkdirSync(join(dir, 'config/padcode'), { recursive: true });
const agent = shim('demo-agent', 'agent.mjs', `"${join(dir, 'agent.json')}" `);
const transcriber = shim('demo-transcriber', 'transcriber.mjs');
writeFileSync(join(dir, 'config/padcode/config.json'), JSON.stringify({
  version: 2,
  controller: { transport: 'bluetooth', name: 'Virtual Pad', address: 'aa:bb:cc:dd:ee:ff', inputVerified: true, family: 'playstation' },
  agent: { command: agent, args: [], commands },
  profile: 'terminal-basic',
  voice: { microphone: { id: 'demo-mic', name: 'Demo Mic' }, transcriber: { kind: 'command', command: transcriber, args: ['{audio}'], language: 'en' }, insert: 'auto' },
}, null, 2));

const env = { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), PADCODE_DEMO_TMUX: tmux, PADCODE_DEMO_SOCKET: socket, COLORTERM: process.env.COLORTERM ?? 'truecolor' };
delete env.TMUX; delete env.TMUX_PANE; delete env.PADCODE_PANEL;
const config = join(dir, 'tmux.conf');
writeFileSync(config, [
  'set -g status off', 'set -g prefix None', 'set -g prefix2 None', 'unbind -a -T prefix', 'unbind -a -T root',
  'set -s escape-time 0', "set -g default-terminal 'xterm-256color'", "set -as terminal-features ',*:RGB'",
  'set -g pane-border-lines heavy', `set -g pane-border-style '${env.NO_COLOR === undefined ? 'fg=colour6' : 'default'}'`,
  `set -g pane-active-border-style '${env.NO_COLOR === undefined ? 'fg=colour6' : 'default'}'`, '',
].join('\n'));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const run = args => spawnSync(tmux, ['-L', socket, '-f', config, ...args], { env, encoding: 'utf8' });
const columns = process.stdout.columns || 100, rows = process.stdout.rows || 30;
const started = run(['new-session', '-d', '-s', 'demo', '-x', String(columns), '-y', String(rows), '-c', join(dir, 'my-app'),
  `${node} ${quote(join(here, 'session.mjs'))} ${quote(dir)}`]);
if (started.status !== 0) { cleanup(); fail(`tmux could not start: ${started.stderr.trim()}`); }
run(['split-window', '-v', '-l', '2', '-t', 'demo:0', '-c', dir, `${node} ${quote(join(here, 'hud.mjs'))} ${quote(dir)}`]);
run(['select-pane', '-t', 'demo:0.0']);
const client = spawn(tmux, ['-L', socket, '-f', config, 'attach-session', '-t', 'demo'], { stdio: 'inherit', env });
client.on('close', () => {
  let code = 1;
  try { code = Number(readFileSync(join(dir, 'exit'), 'utf8')) || 0; } catch {}
  cleanup();
  process.exit(code);
});
