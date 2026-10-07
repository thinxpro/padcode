import fcntl, json, os, pty, re, select, signal, statistics, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

TMUX = os.environ['PADCODE_TMUX']
KEYS = [('dpad_up', b'\x1b[A'), ('dpad_down', b'\x1b[B'), ('dpad_left', b'\x1b[D'), ('dpad_right', b'\x1b[C'),
        ('south', b'\r'), ('east', b'\x1b'), ('left_shoulder', b'\t'), ('right_shoulder', b'\x1b[Z')]

def controlling(slave):
    def setup():
        os.setsid(); fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    return setup

def alive(pid):
    try: os.kill(pid, 0)
    except ProcessLookupError: return False
    state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith('Z')

class Session:
    def __init__(self, mode='basic', tmux=TMUX, rows=30, cols=90, extra=None):
        self.root = tempfile.mkdtemp(prefix='pc-panel-')
        self.events = Path(self.root) / 'events'; self.events.write_text('')
        self.master, self.slave = pty.openpty()
        self.resize(rows, cols)
        self.before = termios.tcgetattr(self.slave); self.before[3] &= ~getattr(termios, 'PENDIN', 0); self.path = os.ttyname(self.slave)
        self.log = Path(self.root) / 'received'; self.log.write_text('')
        env = dict(os.environ, PADCODE_PYTHON=sys.executable, PADCODE_TMUX=tmux, PADCODE_PTY_LOG=str(self.log), TERM='xterm-256color', **(extra or {}))
        env.pop('TMUX', None); env.pop('NO_COLOR', None)
        self.proc = subprocess.Popen([os.environ['PADCODE_NODE'], 'test/fixtures/panel-session.mjs', str(self.events), mode],
                                     stdin=self.slave, stdout=self.slave, stderr=self.slave, env=env, preexec_fn=controlling(self.slave))
        self.output = b''
    def termios(self):
        # The session leader's exit revokes the original slave descriptor on macOS.
        fd = os.open(self.path, os.O_RDWR | os.O_NOCTTY)
        # BSD kernels set the PENDIN state bit whenever canonical mode is re-enabled; it is not a terminal setting.
        try: attributes = termios.tcgetattr(fd); attributes[3] &= ~getattr(termios, 'PENDIN', 0); return attributes
        finally: os.close(fd)
    def resize(self, rows, cols): fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    def pump(self, wait=.05):
        if select.select([self.master], [], [], wait)[0]:
            try: self.output += os.read(self.master, 65536)
            except OSError: time.sleep(wait)
    def until(self, check, limit=8, message=''):
        deadline = time.monotonic() + limit
        while not check() and time.monotonic() < deadline: self.pump()
        assert check(), message or self.output[-2000:]
    def quiet(self, seconds=.2):
        end = time.monotonic() + seconds
        while time.monotonic() < end: self.pump(.01)
    def ready(self):
        path = Path(str(self.events) + '.ready')
        self.until(path.exists, message='panel session never became ready')
        self.info = json.loads(path.read_text()); return self.info
    def tmux(self, *args, check=True):
        return subprocess.run([TMUX, '-S', self.info['socket'], *args], capture_output=True, text=True, check=check)
    def capture(self, pane, escapes=False):
        flags = ['-p', '-e'] if escapes else ['-p']
        return self.tmux('capture-pane', *flags, '-t', self.info[pane]).stdout
    def panel_id(self):
        panes = self.tmux('list-panes', '-F', '#{pane_id} #{pane_input_off}').stdout.split('\n')
        return next((pane.split()[0] for pane in panes if pane.endswith(' 1')), '')
    def panel(self):
        pane = self.panel_id()
        return self.tmux('capture-pane', '-p', '-t', pane).stdout if pane else ''
    def agent(self): return self.capture('agentPane')
    def received(self):
        return b''.join(bytes.fromhex(line) for line in self.log.read_text().split())
    def event(self, value):
        with self.events.open('a') as stream: stream.write(json.dumps(value) + '\n')
    def edge(self, button, down): self.event(dict(type='button', device=1, button=button, down=down))
    def press(self, button): self.edge(button, True); self.edge(button, False)
    def close(self):
        if self.proc.poll() is None: self.proc.kill(); self.proc.wait()
        os.close(self.master); os.close(self.slave)
        if hasattr(self, 'info'): subprocess.run([TMUX, '-S', self.info['socket'], 'kill-server'], capture_output=True)

def strip_reply(data):
    match = re.match(rb'\x1b\[\d+;\d+R', data)
    assert match, ('missing cursor-position reply', data)
    return data[match.end():]

def finish(s, status):
    s.until(lambda: s.proc.poll() is not None)
    assert s.proc.returncode == status, (s.proc.returncode, s.output[-1500:])
    s.quiet(.2)
    assert s.termios() == s.before
    assert b'[exited]' not in s.output and b'[server exited]' not in s.output and b'[detached' not in s.output
    assert not Path(s.info['directory']).exists(), 'private directory survived'
    assert s.tmux('list-sessions', check=False).returncode != 0, 'private tmux server survived'
    helper = int(Path(str(s.events) + '.pid').read_text())
    deadline = time.monotonic() + 3
    while alive(helper) and time.monotonic() < deadline: time.sleep(.05)
    assert not alive(helper), 'input helper survived session exit'

def normal():
    s = Session()
    try:
        s.ready()
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='status pane never showed activation')
        s.until(lambda: s.log.read_text())
        reply = s.received()
        assert strip_reply(reply) == b'', reply
        expected = reply
        latencies = []
        for button, key in KEYS:
            started = time.monotonic(); s.press(button); expected += key
            s.until(lambda: s.received() == expected); latencies.append(time.monotonic() - started)
        for _ in range(12):
            started = time.monotonic(); s.press('dpad_down'); expected += b'\x1b[B'
            s.until(lambda: s.received() == expected); latencies.append(time.monotonic() - started)
        os.write(s.master, 'é🎮'.encode()); expected += 'é🎮'.encode(); s.until(lambda: s.received() == expected)
        # C2-P2: native alternate screen and colors stay in the Agent pane, never the status text.
        assert '\x1b[31mCOLOR' in s.capture('agentPane', True)
        # Status updates from the controls menu never draw into the Agent pane.
        s.press('start'); s.until(lambda: 'MENU' in s.panel())
        s.press('start'); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        assert 'PADCODE' not in s.agent() and 'GAMEPAD' not in s.agent()
        # C2-P3: resize reaches the Agent PTY and keeps the status pane height fixed.
        s.resize(40, 100); s.until(lambda: 'SIZE:[100, 37]' in s.agent().replace('\n', ''))
        heights = s.tmux('list-panes', '-F', '#{pane_id} #{pane_height} #{pane_active} #{pane_input_off}').stdout.split()
        assert heights == [s.info['agentPane'], '37', '1', '0', s.info['panelPane'], '2', '0', '1'], heights
        s.resize(10, 40); s.until(lambda: 'SIZE:[40, 8]' in s.agent().replace('\n', ''))
        s.resize(30, 90); s.until(lambda: 'SIZE:[90, 27]' in s.agent().replace('\n', ''))
        # C2-A4: history mode holds controller input and re-arms after a neutral release.
        s.tmux('copy-mode', '-t', s.info['agentPane'])
        s.until(lambda: 'HISTORY' in s.panel())
        s.press('south'); s.edge('dpad_up', True); s.quiet(.3)
        s.tmux('send-keys', '-X', '-t', s.info['agentPane'], 'cancel')
        s.until(lambda: 'ARMING' in s.panel())
        s.quiet(.4); assert 'ARMING' in s.panel(), 'history exit armed with a held button'
        s.edge('dpad_up', False); s.until(lambda: 'ACTIVE' in s.panel())
        assert s.received() == expected, 'controller input leaked through history mode'
        s.press('south'); expected += b'\r'; s.until(lambda: s.received() == expected)
        # C2-A7: a crashed status worker is replaced and the Agent keeps receiving input.
        old = s.panel_id(); panel_pid = int(s.tmux('display', '-p', '-t', old, '#{pane_pid}').stdout)
        os.kill(panel_pid, signal.SIGKILL)
        s.until(lambda: s.panel_id() not in ('', old))
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.press('dpad_left'); expected += b'\x1b[D'; s.until(lambda: s.received() == expected)
        os.write(s.master, b'exit!'); finish(s, 23)
        assert b'FINAL' in s.output.split(b'\x1b[?1049l')[-1], 'final Agent screen was not printed'
        ordered = sorted(latencies)
        print('fixture-path latency ms p50=%.1f p95=%.1f n=%d' % (statistics.median(ordered) * 1000, ordered[int(len(ordered) * .95) - 1] * 1000, len(ordered)))
    finally: s.close()

def escape():
    s = Session()
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        os.write(s.master, b'\x1d'); finish(s, 130)
    finally: s.close()

def group_pids(s):
    s.until(lambda: 'GROUP:' in s.agent())
    return [int(pid) for pid in re.search(r'GROUP:(\d+):(\d+)', s.agent()).groups()]

def gone(pids, limit=5):
    deadline = time.monotonic() + limit
    while any(alive(pid) for pid in pids) and time.monotonic() < deadline: time.sleep(.05)
    return not any(alive(pid) for pid in pids)

def terminate():
    s = Session('group')
    try:
        s.ready(); pids = group_pids(s)
        # C3-A8: an open controls popup is closed and reaped with the session.
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel()); s.press('start'); s.until(lambda: 'MENU' in s.panel())
        s.until(lambda: b'PADCODE CONTROLS' in s.output)
        s.proc.send_signal(signal.SIGTERM); finish(s, 143)
        popups = subprocess.run(['pgrep', '-f', s.info['socket'] + '.*display-popup'], capture_output=True, text=True).stdout.split()
        assert not popups, ('controls popup survived', popups)
        assert gone(pids), 'Agent process group survived SIGTERM'
    finally: s.close()

def crash():
    s = Session('group')
    try:
        s.ready(); pids = group_pids(s)
        server = int(s.tmux('display', '-p', '#{pid}').stdout)
        s.proc.kill(); s.proc.wait()
        assert gone(pids + [server]), 'Agent or private tmux server survived a coordinator crash'
    finally: s.close()

def fallback():
    root = tempfile.mkdtemp(prefix='pc-fake-tmux-'); fake = Path(root) / 'tmux'
    fake.write_text('#!/bin/sh\necho "fixture tmux failure" >&2\nexit 1\n'); fake.chmod(0o755)
    s = Session('basic', tmux=str(fake))
    try:
        s.until(lambda: b'FALLBACK:PanelFallback' in s.output)
        s.until(lambda: b'ACTIVE' in s.output and b'INFO:' in s.output)
        s.press('dpad_up'); s.until(lambda: s.received() == b'\x1b[A')
        os.write(s.master, b'exit!')
        s.until(lambda: s.proc.poll() is not None); assert s.proc.returncode == 23, s.output[-800:]
        assert s.termios() == s.before
        assert Path(str(s.events) + '.starts').read_text() == 'start\n', 'fallback relaunched the input helper'
    finally: s.close()

def voice():
    """C4: push-to-talk on L2 with a fake microphone helper, playback, cancel, disconnect and cleanup."""
    play_log = tempfile.mktemp(prefix='pc-play-')
    s = Session('lines', extra={'PADCODE_VOICE': '1', 'PADCODE_PLAY_LOG': play_log})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.until(lambda: 'HISTORY LINE 199' in s.agent())
        def trigger(value): s.event(dict(type='axis', device=1, axis='left_trigger', value=value))
        def active(): s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        owners = lambda: [d for d in os.listdir(tempfile.gettempdir()) if d.startswith('pcv-') and os.path.exists(os.path.join(tempfile.gettempdir(), d, 'owner')) and open(os.path.join(tempfile.gettempdir(), d, 'owner')).read() == str(s.proc.pid)]
        s.until(lambda: len(owners()) == 1, message='session voice directory missing')
        directory = os.path.join(tempfile.gettempdir(), owners()[0])
        assert oct(os.stat(directory).st_mode & 0o777) == '0o700'
        # Hold L2: recording captures the controller; nothing reaches the Agent.
        trigger(32767); s.until(lambda: 'REC 00:0' in s.panel(), message='recording did not start')
        for button in ('south', 'dpad_up', 'left_shoulder', 'start'): s.press(button); s.quiet(.05)
        s.quiet(.3); trigger(0)
        s.until(lambda: 'RECORDED' in s.panel(), message='recording notice missing'); active()
        assert s.received() == b'', 'recording input reached the Agent'
        recordings = [f for f in os.listdir(directory) if f.endswith('.wav')]
        assert len(recordings) == 1, recordings
        # Options > Play last recording (inserted before End session).
        mark = len(s.output); s.press('start')
        s.until(lambda: b'Play last recording' in s.output[mark:], message='play item missing')
        for _ in range(4): s.press('dpad_down'); s.quiet(.05)
        s.press('south'); s.until(lambda: 'PLAYING' in s.panel()); active()
        s.until(lambda: os.path.exists(play_log) and open(play_log).read().strip().endswith(recordings[0]))
        # A new recording replaces the previous file; O cancels and keeps none.
        trigger(32767); s.until(lambda: 'REC 00:0' in s.panel()); s.press('east')
        s.until(lambda: 'RECORDING CANCELLED' in s.panel()); trigger(0); active()
        assert [f for f in os.listdir(directory) if f.endswith('.wav')] == [], 'cancel kept a recording'
        # Disconnect during recording cancels it.
        time.sleep(.2); trigger(32767); s.until(lambda: 'REC 00:0' in s.panel())
        s.event(dict(type='disconnected', device=1)); s.until(lambda: 'DISCONNECTED' in s.panel())
        s.until(lambda: [f for f in os.listdir(directory) if f.endswith('.wav')] == [], message='disconnect kept a recording')
        s.event(dict(type='connected', device=1, name='Fixture PS4', connection='wireless', serial='aa:bb:cc:dd:ee:ff')); time.sleep(.3)
        s.press('start'); active()
        # Agent exit during a recording removes the session voice directory.
        time.sleep(.2); trigger(0); time.sleep(.2); trigger(32767); s.until(lambda: 'REC 00:0' in s.panel())
        os.write(s.master, b'exit!'); finish(s, 23)
        assert s.received() == b'exit!'
        assert not os.path.exists(directory), 'voice directory survived the session'
    finally:
        s.close()
        if os.path.exists(play_log): os.unlink(play_log)

def controls():
    """C3: the Options menu, pause, interrupt, history, popup keyboard and confirmed end session."""
    s = Session('lines')
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.until(lambda: 'HISTORY LINE 199' in s.agent())
        base = s.received()
        def menu():
            mark = len(s.output); s.press('start')
            s.until(lambda: 'MENU' in s.panel() and b'PADCODE CONTROLS' in s.output[mark:], message='controls popup did not open')
        def choose(index):
            menu()
            for _ in range(index): s.press('dpad_down'); s.quiet(.05)
            s.press('south')
        def active(): s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        # C3-A2: 100 X presses in Agent context are exactly 100 Enter bytes.
        for _ in range(100): s.press('south')
        expected = base + b'\r' * 100; s.until(lambda: s.received() == expected)
        # Menu presses never reach the Agent; Resume re-arms after release.
        menu()
        for button in ('dpad_down', 'dpad_up', 'left_shoulder', 'right_shoulder', 'dpad_left', 'dpad_right', 'north', 'west'): s.press(button); s.quiet(.03)
        s.press('south'); s.until(lambda: 'ARMING' in s.panel() or 'GAMEPAD ACTIVE' in s.panel()); active()
        assert s.received() == expected, 'menu input reached the Agent'
        assert s.tmux('list-panes', '-F', '#{pane_width}x#{pane_height}').stdout.split()[0] == '90x27', 'popup resized the Agent'
        # Pause from the menu; Options then resumes as in C1.
        choose(1); s.until(lambda: 'PAUSED' in s.panel()); s.press('south'); s.quiet(.3)
        assert s.received() == expected
        s.press('start'); active(); s.press('south'); expected += b'\r'; s.until(lambda: s.received() == expected)
        # C3-A4: interrupt writes exactly one Esc.
        choose(3); expected += b'\x1b'; s.until(lambda: s.received() == expected); active(); s.quiet(.3)
        assert s.received() == expected
        # C3-A7: the popup accepts the keyboard: number 4 picks Send interrupt.
        menu(); os.write(s.master, b'4'); expected += b'\x1b'; s.until(lambda: s.received() == expected); active()
        menu(); os.write(s.master, b'\x1b[B'); s.quiet(.2); os.write(s.master, b'\x1b'); active()
        assert s.received() == expected
        # C3-A5: history from the menu scrolls with the D-pad and leaves on O.
        for _ in range(3): s.press('south')
        expected += b'\r' * 3; s.until(lambda: s.received() == expected)
        choose(2); s.until(lambda: 'HISTORY' in s.panel())
        s.until(lambda: s.tmux('display', '-p', '-t', s.info['agentPane'], '#{pane_in_mode}').stdout.strip() == '1')
        for button in ('dpad_up', 'dpad_up', 'left_shoulder', 'south', 'west'): s.press(button); s.quiet(.05)
        s.until(lambda: int(s.tmux('display', '-p', '-t', s.info['agentPane'], '#{scroll_position}').stdout.strip() or 0) > 0, message='history did not scroll')
        s.press('east'); active()
        assert s.tmux('display', '-p', '-t', s.info['agentPane'], '#{pane_in_mode}').stdout.strip() == '0'
        assert s.received() == expected, 'history input reached the Agent'
        # C3-A6: a disconnect closes the menu and requires the C1 rearm.
        menu(); s.event(dict(type='disconnected', device=1)); s.until(lambda: 'DISCONNECTED' in s.panel())
        s.event(dict(type='connected', device=1, name='Fixture PS4', connection='wireless', serial='aa:bb:cc:dd:ee:ff')); time.sleep(.3)
        s.press('south'); s.quiet(.3); assert s.received() == expected
        s.press('start'); active()
        # C3-A4: End session needs the confirmation; the default keeps the session running.
        choose(4); s.until(lambda: 'END SESSION?' in s.panel()); s.press('south'); s.until(lambda: 'MENU' in s.panel())
        s.press('east'); active(); assert s.proc.poll() is None
        choose(4); s.until(lambda: 'END SESSION?' in s.panel()); s.press('dpad_down'); s.quiet(.05); s.press('south')
        finish(s, 130)
        assert s.received() == expected
    finally: s.close()

for scenario in (normal, controls, voice, escape, terminate, crash, fallback): scenario()
print('Panel PTY passed: controls menu, voice capture, exact keys, CPR, isolation, resize, history hold, worker respawn, exits, crash cleanup and fallback.')
