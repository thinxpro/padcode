import fcntl
import json
import re
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

NODE = os.environ['PADCODE_NODE']
CLI = str(Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/cli.js').resolve())

class Terminal:
    def __init__(self, root, args=None, plain=True):
        self.plain = plain
        self.master, self.slave = pty.openpty()
        self.before = termios.tcgetattr(self.slave)
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 80 if plain else 40, 0, 0))
        env = dict(os.environ, XDG_CONFIG_HOME=str(root), TERM='dumb' if plain else 'xterm-256color', PATH='/usr/bin:/bin')
        if plain: env['NO_COLOR'] = ''
        else: env.pop('NO_COLOR', None)
        self.proc = subprocess.Popen([NODE, CLI, *(args or [])], stdin=self.slave, stdout=self.slave, stderr=self.slave, env=env, cwd=str(root))
        self.output = b''
        self.cursor = 0
    def expect(self, token):
        token = token.encode()
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            pos = self.output.find(token, self.cursor)
            if pos >= 0:
                self.cursor = pos + len(token)
                return
            if select.select([self.master], [], [], .05)[0]:
                self.output += os.read(self.master, 65536)
            if self.proc.poll() is not None: break
        raise AssertionError(f'missing {token!r}\n{self.output!r}')
    def answer(self, text, default=1):
        self.expect(f'Select [{default}]')
        os.write(self.master, (text + '\n').encode())
    def hub(self, text):
        # The Player Hub is a full-screen menu: a digit moves the cursor, Enter confirms.
        self.expect('MENU 1/')
        os.write(self.master, (text + '\n').encode())
    def text(self, prompt, text):
        self.expect(prompt)
        os.write(self.master, (text + '\n').encode())
    def voice(self):
        # Voice is optional: macOS offers the step with voice off by default; other platforms say why it is unavailable.
        self.expect('MISSION 05 / VOICE (optional)')
        if sys.platform == 'darwin': self.answer('1')
        else: self.expect('Voice capture currently requires macOS')
    def finish(self, status=0):
        # A real terminal keeps draining output during raw-mode restoration. Waiting
        # without reading can block tcsetattr(TCSADRAIN) on macOS PTYs.
        deadline = time.monotonic() + 5
        while self.proc.poll() is None and time.monotonic() < deadline:
            if select.select([self.master], [], [], .05)[0]:
                self.output += os.read(self.master, 65536)
        if self.proc.poll() is None:
            while select.select([self.master], [], [], 0)[0]:
                self.output += os.read(self.master, 65536)
            raise AssertionError(f'process did not exit: {self.output!r}')
        assert self.proc.returncode == status, (self.proc.returncode, self.output)
        assert termios.tcgetattr(self.slave) == self.before, 'terminal flags not restored'
        if self.plain: assert b'\x1b' not in self.output, 'TERM=dumb received ANSI'
        # Theme colours are 256-colour or truecolor sequences since UI-0; the old 16-colour code is retired.
        else: assert re.search(rb'\x1b\[[0-9;]*38;[25];', self.output), 'theme colour missing'
    def close(self):
        if self.proc.poll() is None: self.proc.kill(); self.proc.wait()
        os.close(self.master); os.close(self.slave)

with tempfile.TemporaryDirectory(prefix='padcode-onboarding-') as directory:
    root = Path(directory)
    fake = root / 'my agent'
    sentinel = root / 'agent-executed'
    fake.write_text(f'#!/bin/sh\ntouch "{sentinel}"\n')
    fake.chmod(0o755)
    config = root / 'padcode' / 'config.json'
    terminal = Terminal(root)
    try:
        terminal.answer('9')  # Invalid selection is retried.
        terminal.expect('Choose one of the displayed numbers.')
        terminal.answer('3')  # Bluetooth deferred, no actual radio activity.
        terminal.answer('2', default=2)
        terminal.answer('1')  # Custom Agent, controlled PATH has no discovered candidates.
        terminal.text('Executable path or command (no arguments):', str(fake))
        terminal.text('Argument 1', '--literal')
        terminal.text('Argument 2', ' two words ')
        terminal.text('Argument 3', '')
        terminal.answer('1')  # Key profile.
        terminal.voice()
        terminal.expect('VOICE   off')
        terminal.answer('1')  # Save.
        terminal.expect('SAVE COMPLETE')
        terminal.hub('6')  # Hub exit.
        terminal.finish()
    finally: terminal.close()
    data = json.loads(config.read_text())
    assert data['controller'] == {'transport': 'bluetooth', 'inputVerified': False}
    assert data['agent'] == {'command': str(fake), 'args': ['--literal', ' two words ']}
    assert not sentinel.exists(), 'setup executed the Agent'
    original = config.read_bytes()
    terminal = Terminal(root)
    try:
        terminal.expect('PLAYER HUB')
        assert b'MISSION 01' not in terminal.output
        terminal.hub('6'); terminal.finish()
    finally: terminal.close()
    terminal = Terminal(root, ['config'])
    try:
        terminal.answer('3'); terminal.answer('2', default=2)
        terminal.answer('1')  # Keep the saved command and args.
        terminal.answer('1'); terminal.voice(); terminal.answer('2')  # Cancel save.
        terminal.expect('No configuration changes saved.'); terminal.expect('PLAYER HUB')
        terminal.hub('6'); terminal.finish()
    finally: terminal.close()
    assert config.read_bytes() == original, 'cancel modified existing configuration'
    terminal = Terminal(root, ['config'])
    try:
        terminal.expect('Select [1]')
        terminal.proc.send_signal(signal.SIGINT)
        terminal.finish(130)
    finally: terminal.close()
    assert config.read_bytes() == original
    terminal = Terminal(root, ['config'], plain=False)
    try:
        terminal.expect('Select [1]')
        os.write(terminal.master, b'\x03')
        terminal.finish(130)
    finally: terminal.close()
    assert config.read_bytes() == original
    terminal = Terminal(root)
    try:
        terminal.expect('PLAYER HUB')
        terminal.hub('5')
        terminal.expect('DEMO / SYNTHETIC')
        os.write(terminal.master, b'q'); terminal.expect('PLAYER HUB')  # The demo returns to the Hub.
        terminal.hub('6'); terminal.finish()
    finally: terminal.close()
    terminal = Terminal(root, ['config'])
    try:
        terminal.answer('q'); terminal.expect('PLAYER HUB')  # Cancelling an edit keeps the saved file.
        terminal.hub('6'); terminal.finish()
    finally: terminal.close()
    assert config.read_bytes() == original
    config.write_text('{broken')
    terminal = Terminal(root)
    try:
        terminal.expect('Cannot read config')
        terminal.answer('2'); terminal.finish(1)
    finally: terminal.close()
    assert config.read_text() == '{broken'
    terminal = Terminal(root)
    try:
        terminal.expect('Cannot read config')
        terminal.answer('1')  # Explicitly reconfigure, then cancel; corrupt file preserved.
        terminal.answer('q'); terminal.finish()
    finally: terminal.close()
    assert config.read_text() == '{broken'
print('Onboarding PTY passed: first run, literal command, save, reload, cancel, signal, corrupt config.')
