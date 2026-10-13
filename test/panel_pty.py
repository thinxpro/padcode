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

def no_popup(s):
    # tmux sends keyboard input to an open popup; wait until the controls popup has closed before typing to the Agent.
    s.until(lambda: subprocess.run(['pgrep', '-f', 'pane-menu.js'], capture_output=True).stdout == b'', message='controls popup did not close')

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
        # Opening and closing the menu faster than tmux answers must never end the session.
        for _ in range(12): s.press('start'); time.sleep(.02)
        # Let the barrier settle, then close the menu if the last press left it open.
        s.until(lambda: ('GAMEPAD ACTIVE' in s.panel() or 'GAMEPAD MENU' in s.panel()), message='rapid presses left no stable state'); s.quiet(1)
        if 'GAMEPAD MENU' in s.panel(): s.press('start')
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='session did not survive rapid Options presses')
        assert s.proc.poll() is None, 'coordinator exited after rapid Options presses'
        assert s.received() == expected, 'Options presses reached the Agent'
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
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
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
        no_popup(s); os.write(s.master, b'exit!')
        s.until(lambda: s.proc.poll() is not None); assert s.proc.returncode == 23, s.output[-800:]
        assert s.termios() == s.before
        assert Path(str(s.events) + '.starts').read_text() == 'start\n', 'fallback relaunched the input helper'
    finally: s.close()

def voice():
    """C4: push-to-talk on L2 with a fake microphone helper, playback, cancel, disconnect and cleanup."""
    play_log = tempfile.mktemp(prefix='pc-play-')
    s = Session('lines', extra={'PADCODE_VOICE': '1', 'PADCODE_PLAY_LOG': play_log, 'PADCODE_AUDIO_FIXTURE': json.dumps({'warmup': 400})})
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
        # A Bluetooth-style warm-up shows MIC STARTING; releasing before audio arrives is too short.
        trigger(32767); s.until(lambda: 'MIC STARTING' in s.panel(), message='warm-up status missing')
        time.sleep(.2); trigger(0); s.until(lambda: 'RECORDING TOO SHORT' in s.panel(), message='short recording kept'); active()
        time.sleep(.3)
        trigger(32767); s.until(lambda: 'MIC STARTING' in s.panel()); s.until(lambda: 'REC 00:0' in s.panel(), message='recording did not start')
        for button in ('south', 'dpad_up', 'left_shoulder', 'start'): s.press(button); s.quiet(.05)
        s.quiet(.3); trigger(0)
        s.until(lambda: 'RECORDED' in s.panel(), message='recording notice missing'); active()
        assert s.received() == b'', 'recording input reached the Agent'
        recordings = [f for f in os.listdir(directory) if f.endswith('.wav')]
        assert len(recordings) == 1, recordings
        # Options > Play last recording (inserted before End session).
        mark = len(s.output); s.press('start')
        s.until(lambda: b'Play last recording' in s.output[mark:], message='play item missing')
        for _ in range(7): s.press('dpad_down'); s.quiet(.05)
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
        s.event(dict(type='connected', device=1, name='Fixture PS4', connection='wireless', family='playstation', serial='aa:bb:cc:dd:ee:ff')); time.sleep(.3)
        s.press('start'); active()
        # Agent exit during a recording removes the session voice directory.
        time.sleep(.2); trigger(0); time.sleep(.2); trigger(32767); s.until(lambda: 'REC 00:0' in s.panel())
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
        assert s.received() == b'exit!'
        assert not os.path.exists(directory), 'voice directory survived the session'
    finally:
        s.close()
        if os.path.exists(play_log): os.unlink(play_log)

def draft():
    """C5: L2 -> TRANSCRIBING -> VOICE DRAFT popup with the cleaned text; keep, reopen, discard; O cancels a slow job."""
    s = Session('lines', extra={'PADCODE_VOICE': '1', 'PADCODE_TRANSCRIBER': 'ok', 'PADCODE_INSERT': 'review'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        def trigger(value): s.event(dict(type='axis', device=1, axis='left_trigger', value=value))
        def active(): s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        trigger(32767); s.until(lambda: 'REC 00:0' in s.panel()); s.quiet(.3)
        mark = len(s.output); trigger(0)
        s.until(lambda: 'VOICE DRAFT' in s.panel(), message='draft review did not open')
        s.until(lambda: '로그인 bug 고치고'.encode() in s.output[mark:], message='draft text missing from the popup')
        for button in ('dpad_left', 'west', 'left_shoulder'): s.press(button); s.quiet(.05)
        s.press('east'); active()                                  # O keeps the draft.
        assert s.received() == b'', 'draft review wrote to the Agent'
        mark = len(s.output); s.press('start')
        s.until(lambda: b'Review voice draft' in s.output[mark:], message='menu lacks Review voice draft')
        for _ in range(7): s.press('dpad_down'); s.quiet(.05)
        mark = len(s.output); s.press('south')
        s.until(lambda: 'VOICE DRAFT' in s.panel() and '로그인 bug'.encode() in s.output[mark:])
        os.write(s.master, b'3'); s.until(lambda: 'DRAFT DISCARDED' in s.panel()); active()   # Popup keyboard: 3 = Discard.
        mark = len(s.output); s.press('start'); s.until(lambda: b'PADCODE CONTROLS' in s.output[mark:]); s.quiet(.3)
        assert b'Review voice draft' not in s.output[mark:], 'discarded draft still offered'
        s.press('east'); active()
        assert s.received() == b''
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()
    s = Session('lines', extra={'PADCODE_VOICE': '1', 'PADCODE_TRANSCRIBER': 'sleep'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.event(dict(type='axis', device=1, axis='left_trigger', value=32767)); s.until(lambda: 'REC 00:0' in s.panel()); s.quiet(.3)
        s.event(dict(type='axis', device=1, axis='left_trigger', value=0)); s.until(lambda: 'TRANSCRIBING' in s.panel())
        s.press('south'); s.quiet(.2); assert 'TRANSCRIBING' in s.panel()
        s.press('east'); s.until(lambda: 'TRANSCRIPTION CANCELLED' in s.panel())
        s.until(lambda: subprocess.run(['pgrep', '-f', 'fake-transcriber.mjs sleep'], capture_output=True).stdout == b'', message='cancelled transcriber still running')
        assert s.received() == b''
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

def insert():
    """C6: transcripts go straight into the Agent input (bracketed, one line, no Enter); undo and its refusal; short-answer guard."""
    def record(s):
        s.event(dict(type='axis', device=1, axis='left_trigger', value=32767)); s.until(lambda: 'REC 00:0' in s.panel(), message='insert step 1'); s.quiet(.3)
        s.event(dict(type='axis', device=1, axis='left_trigger', value=0))
    def menu_pick(s, label):
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='controller not active before opening the menu')
        mark = len(s.output); s.press('start'); s.until(lambda: label.encode() in s.output[mark:], message=f'{label} missing from the menu')
        # Popup items read '▶ 2  Label' (current) or '  3  Label' since UI-4.
        items = re.findall(rb'(?:\xe2\x96\xb6| |>) (\d)  ([^\r\n\x1b]+)', s.output[mark:])
        index = next(int(n) for n, text in items if text.decode(errors='ignore').startswith(label))
        for _ in range(index - 1): s.press('dpad_down'); s.quiet(.05)
        s.press('south')
    sentence = '로그인 bug 고치고，테스트도 실행해。'.encode()
    s = Session('paste', extra={'PADCODE_VOICE': '1', 'PADCODE_TRANSCRIBER': 'ok'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 2')
        record(s); expected = b'\x1b[200~' + sentence + b'\x1b[201~'
        s.until(lambda: s.received() == expected, message='transcript was not inserted with paste markers')
        s.until(lambda: 'INSERTED 21 CHARS' in s.panel(), message='insert step 3'); s.quiet(.4)
        assert s.received() == expected, 'insertion submitted or added bytes'
        menu_pick(s, 'Undo voice insert'); expected += b'\x7f' * 21
        s.until(lambda: s.received() == expected, message='undo did not remove exactly the inserted characters'); s.until(lambda: 'VOICE INSERT UNDONE' in s.panel(), message='insert step 4')
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 5'); time.sleep(.3)
        record(s); expected += b'\x1b[200~' + sentence + b'\x1b[201~'; s.until(lambda: s.received() == expected, message='insert step 6')
        no_popup(s); os.write(s.master, b'x'); expected += b'x'; s.until(lambda: s.received() == expected, message='insert step 7')
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 8')
        menu_pick(s, 'Undo voice insert'); s.until(lambda: 'UNDO UNAVAILABLE' in s.panel(), message='undo after typing was not refused')
        s.quiet(.3); assert s.received() == expected, 'refused undo still wrote bytes'
        # Clear input after an insertion makes undo unsafe as well.
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='active before clear'); time.sleep(.3)
        record(s); expected += b'\x1b[200~' + sentence + b'\x1b[201~'; s.until(lambda: s.received() == expected, message='insert before clear')
        menu_pick(s, 'Clear input'); expected += b'\x05\x15'; s.until(lambda: s.received() == expected, message='clear bytes')
        menu_pick(s, 'Undo voice insert'); s.until(lambda: 'UNDO UNAVAILABLE' in s.panel(), message='undo after clear was not refused')
        s.quiet(.3); assert s.received() == expected
        # A controller key after the insertion also makes undo unsafe.
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 9'); time.sleep(.3)
        record(s); expected += b'\x1b[200~' + sentence + b'\x1b[201~'; s.until(lambda: s.received() == expected, message='insert step 10')
        s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 11')
        s.press('dpad_left'); expected += b'\x1b[D'; s.until(lambda: s.received() == expected, message='insert step 12')
        menu_pick(s, 'Undo voice insert'); s.until(lambda: 'UNDO UNAVAILABLE' in s.panel(), message='undo after a controller key was not refused')
        s.quiet(.3); assert s.received() == expected
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()
    # Without bracketed paste the text is still one line: no CR/LF or ESC ever reaches the Agent.
    s = Session('lines', extra={'PADCODE_VOICE': '1', 'PADCODE_TRANSCRIBER': 'mixed'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 13')
        record(s); s.until(lambda: s.received() == 'fix 🎮 로그인 둘째 줄 é'.encode(), message='plain insertion was not one cleaned line')
        s.quiet(.3); assert s.received() == 'fix 🎮 로그인 둘째 줄 é'.encode()
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()
    # A one-character transcript opens the draft popup; X inserts it from there.
    s = Session('paste', extra={'PADCODE_VOICE': '1', 'PADCODE_TRANSCRIBER': 'short'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='insert step 14')
        record(s); s.until(lambda: 'VOICE DRAFT' in s.panel(), message='short answer was not held for review')
        s.quiet(.3); assert s.received() == b'', 'short answer was inserted without review'
        s.press('south'); s.until(lambda: s.received() == b'\x1b[200~1\x1b[201~', message='insert step 15')
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

def sticks():
    """Sticks and editing buttons reach the Agent as exact keys; inside the menu the stick navigates instead."""
    s = Session('lines', extra={'PADCODE_EDITING': 'claude'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.until(lambda: 'HISTORY LINE 199' in s.agent())
        def axis(name, value): s.event(dict(type='axis', device=1, axis=name, value=value))
        expected = b''
        for name, value, key in [('leftx', -32767, b'\x1b[D'), ('lefty', 32767, b'\x1b[B'), ('rightx', 32767, b'\x1b[1;5C'), ('righty', -32767, b'\x1b[H'), ('righty', 32767, b'\x1b[F')]:
            axis(name, value); expected += key; s.until(lambda: s.received() == expected, message=f'{name} did not send its key')
            axis(name, 0); s.quiet(.1)
        for button, key in [('west', b'\x7f'), ('north', b'\x17'), ('left_stick', b'\x1b[3~'), ('right_stick', b'\x1f')]:
            s.press(button); expected += key; s.until(lambda: s.received() == expected, message=f'{button} did not send its key')
        axis('right_trigger', 32767); expected += b'\n'; s.until(lambda: s.received() == expected, message='R2 newline missing'); axis('right_trigger', 0)
        # Holding the stick repeats; releasing stops.
        axis('leftx', 32767); s.quiet(.9); axis('leftx', 0); s.quiet(.3)
        moved = s.received()[len(expected):]
        assert moved.count(b'\x1b[C') >= 5 and moved.replace(b'\x1b[C', b'') == b'', moved
        expected = s.received(); s.quiet(.4); assert s.received() == expected, 'repeat continued after release'
        # In the controls menu the left stick moves the selection and nothing reaches the Agent.
        mark = len(s.output); s.press('start'); s.until(lambda: b'PADCODE CONTROLS' in s.output[mark:])
        axis('lefty', 32767); s.quiet(.1); axis('lefty', 0); s.quiet(.2)
        s.until(lambda: '▶ 2  Pause gamepad mapping'.encode() in s.output[mark:], message='stick did not move the menu selection')
        s.press('start'); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        assert s.received() == expected, 'menu stick input reached the Agent'
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

def codex_profile():
    """The Codex profile sends Ctrl+J on R2 and Ctrl+T on R3, and the controller map shows the Codex labels."""
    s = Session('lines', extra={'PADCODE_EDITING': 'codex'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        def axis(name, value): s.event(dict(type='axis', device=1, axis=name, value=value))
        s.press('right_stick'); s.until(lambda: s.received() == b'\x14', message='R3 did not send Ctrl+T')
        axis('right_trigger', 32767); s.until(lambda: s.received() == b'\x14\n', message='R2 did not send Ctrl+J'); axis('right_trigger', 0)
        s.press('west'); s.until(lambda: s.received() == b'\x14\n\x7f', message='shared keys changed under the Codex profile')
        expected = s.received()
        mark = len(s.output); s.press('start'); s.until(lambda: b'PADCODE CONTROLS' in s.output[mark:])
        for _ in range(6): s.press('dpad_down'); s.quiet(.05)
        mark = len(s.output); s.press('south'); s.until(lambda: 'CONTROLLER MAP' in s.panel())
        for label in (b'Transcript on/off', b'New line (no send)', b'Tab (queue message)', b'Shift+Tab (collab mode)'):
            s.until(lambda: label in s.output[mark:], message=f'controller map missing {label!r}')
        assert b'Undo' not in s.output[mark:], 'controller map shows the Claude Code R3 label'
        s.press('start'); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.quiet(.3); assert s.received() == expected, 'map input reached the Agent'
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

def xbox_names():
    """An Xbox controller gets Xbox names in the status pane, its legend, the menu hints and the controller map."""
    s = Session('lines', extra={'PADCODE_FIXTURE_FAMILY': 'xbox'})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel(), message='xbox session not active')
        # Legend keys are padded key caps in colour since UI-4, so the pane text reads ' A  ENTER'.
        s.until(lambda: 'MENU  MENU' in s.panel() and ' A  ENTER' in s.panel() and ' LB  TAB' in s.panel(), message='status pane not using Xbox names')
        assert 'OPTIONS' not in s.panel() and 'SQ ' not in s.panel()
        mark = len(s.output); s.press('start'); s.until(lambda: b'PADCODE CONTROLS' in s.output[mark:])
        s.until(lambda: 'A CONFIRM, B BACK' in s.panel(), message='menu status not using Xbox names')
        for _ in range(6): s.press('dpad_down'); s.quiet(.05)
        mark = len(s.output); s.press('south')
        s.until(lambda: b'HOME' in s.output[mark:] and b'XBOX WIRELESS CONTROLLER' in s.output[mark:], message='controller map not the Xbox layout')
        assert b'TOUCHPAD' not in s.output[mark:]
        s.press('start'); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

def short_map():
    """In a short terminal the controller map switches to its compact legend instead of cutting lines off."""
    s = Session('lines', rows=20)
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        mark = len(s.output); s.press('start'); s.until(lambda: b'PADCODE CONTROLS' in s.output[mark:])
        for _ in range(6): s.press('dpad_down'); s.quiet(.05)
        mark = len(s.output); s.press('south'); s.until(lambda: 'CONTROLLER MAP' in s.panel())
        s.until(lambda: b'Delete word, hold' in s.output[mark:] and b'Ends the session' in s.output[mark:], message='compact map incomplete')
        s.quiet(.3); assert b'more lines' not in s.output[mark:], 'map cut off in a short terminal'
        s.press('start'); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

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
        s.event(dict(type='connected', device=1, name='Fixture PS4', connection='wireless', family='playstation', serial='aa:bb:cc:dd:ee:ff')); time.sleep(.3)
        s.press('south'); s.quiet(.3); assert s.received() == expected
        s.press('start'); active()
        # C3-A4: End session needs the confirmation; the default keeps the session running.
        choose(7); s.until(lambda: 'END SESSION?' in s.panel()); s.press('south'); s.until(lambda: 'MENU' in s.panel())
        s.press('east'); active(); assert s.proc.poll() is None
        # Clear input sends exactly Ctrl+E Ctrl+U.
        choose(4); expected += b'\x05\x15'; s.until(lambda: s.received() == expected); active()
        # Controller map: the drawing appears, O returns to the menu, nothing reaches the Agent.
        mark = len(s.output); choose(6); s.until(lambda: 'CONTROLLER MAP' in s.panel()); s.until(lambda: b'TOUCHPAD' in s.output[mark:] and b'L STICK' in s.output[mark:], message='controller map not drawn')
        s.press('east'); s.until(lambda: 'GAMEPAD MENU' in s.panel()); s.press('start'); active(); assert s.received() == expected
        choose(7); s.until(lambda: 'END SESSION?' in s.panel()); s.press('dpad_down'); s.quiet(.05); s.press('south')
        finish(s, 130)
        assert s.received() == expected
    finally: s.close()

def commands():
    """Quick commands: Share opens the palette, choices are typed without Enter, the touchpad types @."""
    s = Session('lines', extra={'PADCODE_COMMANDS': json.dumps(['/review staged', '/frontend:component'])})
    try:
        s.ready(); s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        s.until(lambda: 'HISTORY LINE 199' in s.agent())
        expected = s.received()
        def active(): s.until(lambda: 'GAMEPAD ACTIVE' in s.panel())
        def palette():
            mark = len(s.output); s.press('back')
            s.until(lambda: 'GAMEPAD COMMANDS' in s.panel() and b'QUICK COMMANDS' in s.output[mark:] and b'/review staged' in s.output[mark:], message='quick commands did not open')
        # Item 1 types exactly '/', and palette presses never reach the Agent.
        palette()
        for button in ('left_shoulder', 'right_shoulder', 'north', 'west', 'touchpad', 'dpad_left'): s.press(button); s.quiet(.03)
        s.press('south'); expected += b'/'; s.until(lambda: s.received() == expected, message='slash not typed'); active()
        # A custom command is typed as keystrokes with no Enter, and the status pane says how to run it.
        palette(); s.press('dpad_down'); s.quiet(.05); s.press('dpad_down'); s.quiet(.05); s.press('south')
        expected += b'/review staged'; s.until(lambda: s.received() == expected, message='custom command not typed')
        s.until(lambda: 'TYPED /REVIEW STAGED' in s.panel().upper(), message='typed notice missing'); active()
        # The touchpad types @ directly.
        s.press('touchpad'); expected += b'@'; s.until(lambda: s.received() == expected)
        # Share again and O both close without typing; the keyboard number 4 picks the second custom command.
        palette(); s.press('back'); active(); palette(); s.press('east'); active()
        palette(); os.write(s.master, b'4'); expected += b'/frontend:component'; s.until(lambda: s.received() == expected); active()
        # From the controls menu: Quick commands is item 6 and O returns to the menu.
        mark = len(s.output); s.press('start'); s.until(lambda: b'Quick commands' in s.output[mark:])
        for _ in range(5): s.press('dpad_down'); s.quiet(.05)
        mark = len(s.output); s.press('south'); s.until(lambda: b'QUICK COMMANDS' in s.output[mark:])
        s.press('east'); s.until(lambda: 'GAMEPAD MENU' in s.panel()); s.press('start'); active()
        s.quiet(.3); assert s.received() == expected, 'palette navigation reached the Agent'
        no_popup(s); os.write(s.master, b'exit!'); finish(s, 23)
    finally: s.close()

for scenario in (normal, controls, commands, sticks, codex_profile, short_map, xbox_names, voice, draft, insert, escape, terminate, crash, fallback): scenario()
print('Panel PTY passed: controls menu, quick commands, sticks, Codex profile, voice capture, voice drafts, voice insertion, exact keys, CPR, isolation, resize, history hold, worker respawn, exits, crash cleanup and fallback.')
