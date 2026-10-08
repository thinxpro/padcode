import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
appendFileSync(path + '.starts', 'start\n');
writeFileSync(path + '.pid', String(process.pid));
// Restarted helpers can skip events written for an earlier helper.
let seq = 0, offset = process.env.PADCODE_FIXTURE_TAIL === '1' ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
const emit = event => process.stdout.write(JSON.stringify({ v: 1, seq: seq++, time: 0, ...event }) + '\n');
emit({ type: 'ready', source: 'virtual', sdl: 'menu-fixture' });
emit({ type: 'connected', device: 1, name: 'Test Pad', connection: 'wireless', family: process.env.PADCODE_FIXTURE_FAMILY ?? 'playstation', serial: 'aa:bb:cc:dd:ee:ff' });
setInterval(() => {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (; offset < lines.length; offset++) emit(JSON.parse(lines[offset]));
}, 10);
