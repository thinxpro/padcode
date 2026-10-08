"""Every Player Hub screen returns to the Hub; only Exit, q or a signal leaves Padcode."""
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

def modes(attributes):
    # BSD kernels set the PENDIN state bit whenever canonical mode is re-enabled; it is not a terminal setting.
    copy = list(attributes); copy[3] &= ~getattr(termios, 'PENDIN', 0); return copy

class Hub:
    def __init__(self, display='transparent'):
        self.dir = tempfile.TemporaryDirectory(prefix='padcode-nav-'); root = Path(self.dir.name)
        self.events = root / 'events'; self.events.write_text('')
        (root / 'padcode').mkdir()
        (root / 'padcode/config.json').write_text(json.dumps({'version': 1, 'controller': {'transport': 'bluetooth', 'address': 'aa:bb:cc:dd:ee:ff', 'inputVerified': True, 'name': 'Test Pad'},
            'agent': {'command': sys.executable, 'args': [str(Path('test/fixtures/pty-agent.py').resolve()), 'basic']}, 'profile': 'terminal-basic'}))
        self.config = (root / 'padcode/config.json').read_text()
        self.master, self.slave = pty.openpty(); self.before = termios.tcgetattr(self.slave)
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 90, 0, 0))
        env = dict(os.environ, XDG_CONFIG_HOME=str(root), TERM='xterm-256color', PADCODE_FIXTURE_TAIL='1')
        env.pop('TMUX', None)
        if display == 'transparent': env['PADCODE_PANEL'] = 'off'
        self.root = root
        self.proc = subprocess.Popen([os.environ['PADCODE_NODE'], 'test/fixtures/hub-session.mjs', str(self.events)], stdin=self.slave, stdout=self.slave, stderr=self.slave, env=env)
        self.output = b''; self.cursor = 0
    def pump(self, wait=.05):
        if select.select([self.master], [], [], wait)[0]: self.output += os.read(self.master, 65536)
    def expect(self, token, limit=8):
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline:
            index = self.output.find(token, self.cursor)
            if index >= 0: self.cursor = index + len(token); return
            self.pump()
        raise AssertionError((token, self.output[-1500:]))
    def absent(self, token, seconds=.4):
        end = time.monotonic() + seconds
        while time.monotonic() < end: self.pump(.02)
        assert token not in self.output[self.cursor:], (token, self.output[-800:])
    def event(self, value):
        with self.events.open('a') as stream: stream.write(json.dumps(value) + '\n')
    def edge(self, button, down): self.event(dict(type='button', device=1, button=button, down=down))
    def press(self, button): self.edge(button, True); self.edge(button, False)
    def hub(self):
        self.expect(b'PLAYER HUB'); self.expect(b'GAMEPAD READY'); self.expect(b'Select [1]'); time.sleep(.3)
    def pick(self, index):
        # Index is 1-based; the Hub cursor starts on item 1 and wraps.
        for _ in range(index - 1): self.press('dpad_down'); self.expect(b'Select [%d]' % (_ + 2))
        self.press('south')
    def finish(self, status):
        deadline = time.monotonic() + 6
        while self.proc.poll() is None and time.monotonic() < deadline: self.pump()
        assert self.proc.returncode == status, (self.proc.returncode, self.output[-800:])
        assert modes(termios.tcgetattr(self.slave)) == modes(self.before)
        pid = int(Path(str(self.events) + '.pid').read_text())
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try: os.kill(pid, 0)
            except ProcessLookupError: break
            time.sleep(.05)
        else: raise AssertionError('input helper survived')
    def close(self):
        if self.proc.poll() is None: self.proc.kill(); self.proc.wait()
        os.close(self.master); os.close(self.slave); self.dir.cleanup()

def launch(h):
    h.pick(1); h.expect(b'MISSION START'); h.expect(b'Select [2]')
    h.press('dpad_up'); h.expect(b'Select [1]'); h.press('south')

def journey(display):
    h = Hub(display)
    try:
        h.hub()
        # N1: cancelling the launch confirmation returns to the Hub.
        h.pick(1); h.expect(b'MISSION START'); h.expect(b'Select [2]'); time.sleep(.1)
        h.press('east'); h.hub(); assert b'LAUNCH CANCELLED' in h.output
        # N2: an Agent exit returns to the Hub, and the next launch activates the controller again.
        launch(h); h.expect(b'ACTIVE'); time.sleep(.1)
        os.write(h.master, b'exit!'); h.hub(); assert b'SESSION OVER / Agent exited with status 23' in h.output
        # N3: Ctrl+] returns to the Hub.
        launch(h); h.expect(b'ACTIVE'); time.sleep(.1)
        os.write(h.master, b'\x1d'); h.hub(); assert b'SESSION OVER / Agent exited with status 130' in h.output
        if display == 'panel': return h
        # N4: Controller Lab needs O held for one second, then release.
        h.pick(3); h.expect(b'HOLD O 1S / Q BACK'); time.sleep(.3)
        h.press('east'); h.absent(b'PLAYER HUB', .6)
        h.edge('east', True); h.expect(b'RELEASE O TO RETURN', 3); h.absent(b'PLAYER HUB', .3)
        h.edge('east', False); h.hub()
        h.pick(3); h.expect(b'HOLD O 1S / Q BACK'); os.write(h.master, b'q'); h.hub()
        # N5: the demo returns on O and on q.
        h.pick(5); h.expect(b'O / Q BACK'); time.sleep(.3); h.press('east'); h.hub()
        h.pick(5); h.expect(b'O / Q BACK'); os.write(h.master, b'q'); h.hub()
        # Voice settings from the Hub: choose a microphone, change nothing on O, then turn voice off.
        h.pick(2); h.expect(b'VOICE SETTINGS'); h.expect(b'Select [1]'); time.sleep(.3)
        h.press('dpad_down'); h.expect(b'Select [2]'); h.press('south')      # Choose a microphone.
        h.expect(b'Audio stays on this Mac'); h.expect(b'Choose a microphone'); h.expect(b'Select [1]'); h.press('south')
        h.expect(b'Microphone check'); h.expect(b'Select [1]'); h.press('dpad_down'); h.expect(b'Select [2]'); h.press('south')
        h.expect(b'VOICE / TRANSCRIPTION'); h.expect(b'Select [1]')
        for n in (2, 3, 4): h.press('dpad_down'); h.expect(b'Select [%d]' % n)
        h.press('south')                                                  # No transcription.
        h.hub(); assert b'VOICE ON / Fixture Mic' in h.output
        saved = json.loads((h.root / 'padcode/config.json').read_text())
        assert saved['version'] == 2 and saved['voice'] == {'microphone': {'id': 'mic-1', 'name': 'Fixture Mic'}, 'transcriber': None, 'insert': 'auto'}, saved
        assert saved['agent'] == json.loads(h.config)['agent'] and saved['controller'] == json.loads(h.config)['controller']
        h.pick(2); h.expect(b'Keep microphone Fixture Mic'); h.expect(b'Select [1]'); time.sleep(.3); h.press('east')
        h.hub(); assert b'VOICE UNCHANGED' in h.output
        assert json.loads((h.root / 'padcode/config.json').read_text())['voice'] is not None
        h.pick(2); h.expect(b'Turn voice off'); h.expect(b'Select [1]'); time.sleep(.3); h.press('dpad_down'); h.expect(b'Select [2]'); h.press('south')
        h.hub(); assert b'VOICE OFF' in h.output
        assert json.loads((h.root / 'padcode/config.json').read_text())['voice'] is None
        h.config = (h.root / 'padcode/config.json').read_text()
        # N6: cancelling Edit configuration keeps the file and returns to the Hub.
        h.pick(4); h.expect(b'Select ['); time.sleep(.3); h.press('east')
        h.hub(); assert b'No configuration changes saved.' in h.output
        assert (h.root / 'padcode/config.json').read_text() == h.config
        return h
    except BaseException:
        h.close(); raise

for display in ('transparent', 'panel'):
    h = journey(display)
    try:
        h.press('east'); h.finish(0)                       # O on the Hub selects Exit.
    finally: h.close()
h = Hub()
try:
    h.hub(); os.write(h.master, b'\x03'); h.finish(130)    # Ctrl+C at the Hub keeps its status.
finally: h.close()
print('Hub navigation PTY passed: voice settings, cancel, Agent exit, Ctrl+], lab hold-O, demo, config cancel, exit and Ctrl+C.')
