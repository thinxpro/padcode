const mode = process.argv[2];
let seq = 0;
const emit = e => process.stdout.write(JSON.stringify({ v: 1, seq: seq++, time: 0, ...e }) + '\n');
if (mode === 'bad') process.stdout.write('{bad}\n');
else if (mode === 'exit') process.exit(1);
else {
  emit({ type: 'ready', source: 'virtual', sdl: 'fixture' });
  if (mode !== 'empty') {
    emit({ type: 'connected', device: 1, name: 'Controller', connection: 'wireless', serial: 'aa:bb:cc:dd:ee:ff' });
    if (mode === 'held') emit({ type: 'button', device: 1, button: 'south', down: true });
    if (mode === 'disconnect') setTimeout(() => emit({ type: 'disconnected', device: 1 }), 120);
    else if (mode !== 'quiet') {
      setTimeout(() => emit({ type: 'button', device: mode === 'held' ? 1 : 2, button: 'south', down: true }), 80);
      setTimeout(() => emit({ type: 'button', device: 1, button: 'south', down: false }), 110);
      setTimeout(() => emit({ type: 'button', device: 1, button: 'east', down: true }), 180);
    }
  }
}
setInterval(() => {}, 1000);
