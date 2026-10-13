#!/usr/bin/env node
// Virtual controller for the scripted demo: speaks the helper protocol and replays events appended to a file.
// It is never hardware evidence.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
// The Hub starts a new helper after each session; it must not replay earlier presses.
let seq = 0, offset = readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
const emit = event => process.stdout.write(JSON.stringify({ v: 1, seq: seq++, time: 0, ...event }) + '\n');
emit({ type: 'ready', source: 'virtual', sdl: 'padcode-demo' });
emit({ type: 'connected', device: 1, name: 'Virtual Pad', connection: 'wireless', family: 'playstation', serial: 'aa:bb:cc:dd:ee:ff' });
setInterval(() => {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (; offset < lines.length; offset++) emit(JSON.parse(lines[offset]));
}, 10);
