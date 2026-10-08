"""Full-screen menu (Player Hub) input rules, intro sweep, resize and terminal restoration under a real PTY."""
import fcntl, os, pty, re, select, signal, struct, subprocess, termios, time

NODE = os.environ['PADCODE_NODE']

def modes(attributes):
    copy = list(attributes); copy[3] &= ~getattr(termios, 'PENDIN', 0); return copy

class Menu:
    def __init__(self, intro=0, term='xterm-256color', extra=None):
        self.master, self.slave = pty.openpty(); self.before = termios.tcgetattr(self.slave)
        self.size(80, 24)
        env = {k: v for k, v in os.environ.items() if k not in ('CI', 'PADCODE_NO_ANIM', 'NO_COLOR')}
        read, self.feed = os.pipe()
        env.update(TERM=term, INTRO=str(intro), FEED_FD=str(read), **(extra or {}))
        self.proc = subprocess.Popen([NODE, 'test/fixtures/screen-menu.mjs'], stdin=self.slave, stdout=self.slave, stderr=self.slave, env=env, pass_fds=(read,))
        os.close(read)
        self.output = b''; self.cursor = 0
    def size(self, cols, rows): fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    def pump(self, wait=.05):
        if select.select([self.master], [], [], wait)[0]:
            try: self.output += os.read(self.master, 65536)
            except OSError: pass
    def expect(self, token, limit=6):
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline:
            index = self.output.find(token, self.cursor)
            if index >= 0: self.cursor = index + len(token); return
            self.pump()
        raise AssertionError((token, self.output[-1200:]))
    def key(self, data): os.write(self.master, data)
    def pad(self, line): os.write(self.feed, (line + '\n').encode())
    def finish(self, token):
        self.expect(token)
        deadline = time.monotonic() + 5
        while self.proc.poll() is None and time.monotonic() < deadline: self.pump()
        assert self.proc.returncode == 0, (self.proc.returncode, self.output[-600:])
        assert modes(termios.tcgetattr(self.slave)) == modes(self.before), 'terminal modes not restored'
        out = self.output
        if b'\x1b[?1049h' in out:
            assert out.rindex(b'\x1b[?1049l') < out.index(token), 'alternate screen still active at exit'
            assert out.rindex(b'\x1b[?25h') > out.rindex(b'\x1b[?25l'), 'cursor left hidden'
        os.close(self.feed); os.close(self.master); os.close(self.slave)

# Sweep plays, settles, then keyboard, digits, invalid number, gamepad, status, resize and Enter.
m = Menu(intro=600)
m.expect(b'\x1b[?1049h'); m.expect(b'SHINE on')
m.expect(b'SHINE -', 3)
frames = len(re.findall(rb'SHINE on', m.output))
assert frames >= 5, f'sweep too short: {frames} frames'
time.sleep(.3); m.pump()
assert b'SHINE on' not in m.output[m.cursor:], 'sweep resumed after settling'
m.key(b'\x1b[B'); m.expect(b'SEL 2')
m.key(b'4'); m.expect(b'SEL 4')
m.key(b'9'); m.expect(b'FLASH Choose 1-4.')
m.pad('up'); m.expect(b'SEL 3')
m.pad('status:GAMEPAD READY / test'); m.expect(b'STATUS GAMEPAD READY / test')
m.size(50, 20); m.proc.send_signal(signal.SIGWINCH); m.expect(b'W 50')
m.key(b'\r'); m.finish(b'RESULT three')

# Any input ends the sweep at once; it never resumes.
m = Menu(intro=3000)
m.expect(b'SHINE on'); m.key(b'\x1b[B'); m.expect(b'SEL 2 SHINE -')
time.sleep(.4); m.pump()
assert b'SHINE on' not in m.output[m.cursor:], 'sweep resumed after input'
m.pad('confirm'); m.finish(b'RESULT two')

# A gamepad action also ends the sweep.
m = Menu(intro=3000)
m.expect(b'SHINE on'); m.pad('down'); m.expect(b'SEL 2 SHINE -'); m.pad('cancel'); m.finish(b'RESULT quit')

# No sweep without motion.
for extra in ({'PADCODE_NO_ANIM': '1'}, {'CI': 'true'}, {'NO_COLOR': ''}):
    m = Menu(intro=600, extra=extra)
    m.expect(b'FRAME 1'); time.sleep(.3); m.pump()
    assert b'SHINE on' not in m.output, extra
    m.key(b'\x1b'); m.finish(b'RESULT quit')

# Escape picks the back item; q and Ctrl+C cancel; Ctrl+C also cancels the caller.
m = Menu(); m.expect(b'FRAME 1'); m.key(b'q'); m.finish(b'ERROR Setup cancelled.\r')
m = Menu(); m.expect(b'FRAME 1'); m.key(b'\x03'); m.finish(b'ERROR Setup cancelled. ABORTED')
m = Menu(); m.expect(b'FRAME 1'); m.key(b'2\r'); m.finish(b'RESULT two')

# TERM=dumb: no alternate screen and no control sequences at all.
m = Menu(term='dumb'); m.expect(b'FRAME 1'); m.key(b'\x1b[B'); m.expect(b'SEL 2'); m.key(b'\r'); m.finish(b'RESULT two')
assert b'\x1b' not in m.output.replace(b'\x1b[B', b''), m.output[-400:]

print('Screen menu PTY passed: sweep, input ends sweep, no-motion, keys, digits, gamepad, status, resize, escape, q, Ctrl+C, dumb terminal.')
