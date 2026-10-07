import json, os, pty, select, subprocess, sys, tempfile, termios, time
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='padcode-menu-text-') as root:
    events = Path(root) / 'events'; events.write_text('')
    master, slave = pty.openpty(); before = termios.tcgetattr(slave)
    proc = subprocess.Popen([os.environ['PADCODE_NODE'], 'test/fixtures/menu-setup.mjs', str(events), 'text'], stdin=slave, stdout=slave, stderr=slave, env=dict(os.environ, TERM='dumb', NO_COLOR=''))
    output = b''; cursor = 0
    def expect(token):
        global output, cursor
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            pos = output.find(token.encode(), cursor)
            if pos >= 0: cursor = pos + len(token); return
            if select.select([master], [], [], .03)[0]: output += os.read(master, 65536)
        raise AssertionError((token, output))
    def press(button):
        with events.open('a') as stream:
            for down in [True, False]: stream.write(json.dumps(dict(type='button', device=1, button=button, down=down)) + '\n')
    try:
        expect('Select [1]')
        os.write(master, b'\x1b[B'); expect('Select [2]')
        os.write(master, b'\x1b[A'); expect('Select [1]')
        press('south'); expect('GAMEPAD READY')
        aborted = len(sys.argv) > 1
        if aborted: os.write(master, b'\x03')
        else:
            press('south'); expect('Literal text:')
            press('south'); press('east'); press('dpad_down'); time.sleep(.08)
            os.write(master, 'literal 帮我修复 🎮\n'.encode()); expect('TEXT RESULT: literal 帮我修复 🎮')  # Unicode survives the terminal prompt.
            expect('Return menu'); expect('Select [1]'); press('east'); expect('ACTION: back')
        deadline = time.monotonic() + 5
        while proc.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], .03)[0]: output += os.read(master, 65536)
        assert proc.poll() == (130 if aborted else 0), output
        assert termios.tcgetattr(slave) == before
        assert b'\x1b' not in output
        try: os.kill(int(Path(str(events) + '.pid').read_text()), 0)
        except ProcessLookupError: pass
        else: raise AssertionError('helper was not reaped')
    finally:
        if proc.poll() is None: proc.kill(); proc.wait()
        os.close(master); os.close(slave)
print('Plain PTY passed: text ignores gamepad actions, literal input, circle Back, terminal restoration.')
