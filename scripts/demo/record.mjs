#!/usr/bin/env node
// Records docs/media/demo.gif and demo.mp4 from demo.tape with VHS. Run through npm run demo:record.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const limit = 5 * 1024 * 1024;
const has = name => Boolean(spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: process.env }).stdout.trim());
const missing = [['vhs', 'brew install vhs'], ['tmux', 'brew install tmux']].filter(([name]) => !has(name));
if (missing.length) {
  process.stderr.write(`padcode demo: missing ${missing.map(([name, hint]) => `${name} (${hint})`).join(', ')}.\n`);
  process.exit(2);
}
mkdirSync(join(root, 'docs/media'), { recursive: true });
const result = spawnSync('vhs', [join('scripts', 'demo', 'demo.tape')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const gif = statSync(join(root, 'docs/media/demo.gif')).size, mp4 = statSync(join(root, 'docs/media/demo.mp4')).size;
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
process.stdout.write(`docs/media/demo.gif ${mb(gif)}, docs/media/demo.mp4 ${mb(mp4)}\n`);
if (gif > limit) { process.stderr.write(`padcode demo: the GIF is larger than ${mb(limit)}; lower Framerate or Width in demo.tape.\n`); process.exit(1); }
