import fcntl, json, os, pty, select, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

with tempfile.TemporaryDirectory(prefix='padcode-menu-') as root:
    events = Path(root) / 'events'
    events.write_text('')
    master, slave = pty.openpty()
    before = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 40, 0, 0))
    proc = subprocess.Popen([os.environ['PADCODE_NODE'], 'test/fixtures/menu-setup.mjs', str(events)], stdin=slave, stdout=slave, stderr=slave, env=dict(os.environ, TERM='xterm-256color'))
    output = b''
    cursor = 0
    def expect(token):
        global output, cursor
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline:
            pos = output.find(token.encode(), cursor)
            if pos >= 0:
                cursor = pos + len(token)
                return
            if select.select([master], [], [], .05)[0]: output += os.read(master, 65536)
        raise AssertionError((token, output))
    def event(value):
        with events.open('a') as stream: stream.write(json.dumps(value) + '\n')
    def press(button):
        event(dict(type='button', device=1, button=button, down=True))
        event(dict(type='button', device=1, button=button, down=False))
    def key(text): os.write(master, text.encode())
    try:
        expect('Select [1]'); key('1\n')
        expect('Select [1]'); key('2\n')
        expect('Select [1]'); key('1\n')
        expect('Select [1]')  # From here all choices use the controller.
        press('south'); expect('GAMEPAD READY')
        press('south'); expect('Choose the physical controller')
        press('south'); expect('PRESS ANY CONTROLLER BUTTON NOW')
        press('south'); expect('INPUT CHECK PASSED')
        expect('Select [1]')
        event(dict(type='button', device=1, button='dpad_down', down=True))
        expect('Select [2]')
        # Duplicate held-down input must not advance to item 3.
        event(dict(type='button', device=1, button='dpad_down', down=True))
        time.sleep(.08)
        event(dict(type='button', device=1, button='dpad_down', down=False))
        press('dpad_up'); expect('Select [1]')
        event(dict(type='button', device=1, button='south', down=True)); expect('MISSION 04')
        event(dict(type='button', device=1, button='south', down=True))
        time.sleep(.08)
        while select.select([master], [], [], 0)[0]: output += os.read(master, 65536)
        assert b'MISSION 05' not in output, 'held confirm crossed menus'
        event(dict(type='button', device=1, button='south', down=False))
        expect('Select [1]'); press('south'); expect('MISSION 05')
        expect('Select [1]')
        event(dict(type='disconnected', device=1)); expect('GAMEPAD DISCONNECTED')
        event(dict(type='connected', device=1, name='Test Pad', connection='wireless', family='playstation', serial='aa:bb:cc:dd:ee:ff'))
        press('south'); expect('GAMEPAD READY')
        press('south'); expect('SAVE COMPLETE')
        expect('PLAYER HUB'); expect('Select [1]')
        press('east')  # Circle chooses the explicit Exit option.
        deadline = time.monotonic() + 5
        while proc.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], .05)[0]: output += os.read(master, 65536)
        assert proc.poll() == 0, output
        assert termios.tcgetattr(slave) == before
        saved = json.loads(Path(str(events) + '.config').read_text())
        assert saved['controller']['inputVerified'] is True
        assert saved['agent']['command'] == '/opt/my-agent'
        assert Path(str(events) + '.starts').read_text() == 'start\n', 'competing helpers'
        try: os.kill(int(Path(str(events) + '.pid').read_text()), 0)
        except ProcessLookupError: pass
        else: raise AssertionError('menu helper was not reaped')
    finally:
        if proc.poll() is None: proc.kill(); proc.wait()
        os.close(master); os.close(slave)
print('Gamepad PTY passed: claim, menus, fresh input, hold, disconnect/reclaim, save, hub exit and single helper.')
