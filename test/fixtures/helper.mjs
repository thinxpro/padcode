const mode = process.argv[2];
const ready = { v: 1, seq: 0, time: 0, type: 'ready', source: 'virtual', sdl: 'fixture' };
if (mode === 'silent') { setInterval(() => {}, 1000); }
else if (mode === 'malformed') { process.stdout.write('{bad}\n'); setInterval(() => {}, 1000); }
else if (mode === 'truncated') { process.stdout.write(JSON.stringify(ready)); }
else if (mode === 'empty') { /* Intentionally no handshake. */ }
else {
  process.stdout.write(JSON.stringify(ready) + '\n');
  if (mode === 'crash') { process.stderr.write('fixture failed\x1b[31m'); process.exitCode = 7; }
  else if (mode === 'burst' || mode === 'flood') {
    let seq = 1;
    const batch = () => {
      for (let i = 0; i < 200; i++) {
        process.stdout.write(JSON.stringify({ v: 1, seq: seq++, time: 1, type: 'axis', device: 1, axis: 'leftx', value: 123 }) + '\n');
      }
    };
    if (mode === 'burst') for (let i = 0; i < 100; i++) batch();
    else setInterval(batch, 10);
  }
  else if (mode === 'bad-utf8') { process.stdout.write(Buffer.from([0xff])); }
  else if (mode === 'oversized') { process.stdout.write('x'.repeat(5000)); }
  else if (mode === 'good') { /* Clean finite stream. */ }
  else {
    process.stderr.write(`HELPER_PID=${process.pid}\n`);
    if (mode === 'stubborn') process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  }
}
