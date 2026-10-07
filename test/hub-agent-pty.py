"""Player Hub -> Start agent session must keep controller control, exactly like padcode run."""
import fcntl, json, os, pty, re, select, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

def modes(attributes):
    # BSD kernels set the PENDIN state bit whenever canonical mode is re-enabled; it is not a terminal setting.
    copy = list(attributes); copy[3] &= ~getattr(termios, 'PENDIN', 0); return copy

with tempfile.TemporaryDirectory(prefix='padcode-hub-') as root:
    events = Path(root) / 'events'; events.write_text('')
    (Path(root) / 'padcode').mkdir()
    (Path(root) / 'padcode/config.json').write_text(json.dumps({'version': 1, 'controller': {'transport': 'bluetooth', 'address': 'aa:bb:cc:dd:ee:ff', 'inputVerified': True, 'name': 'Test Pad'},
        'agent': {'command': sys.executable, 'args': [str(Path('test/fixtures/pty-agent.py').resolve()), 'basic']}, 'profile': 'terminal-basic'}))
    master, slave = pty.openpty(); before = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 90, 0, 0))
    env = dict(os.environ, XDG_CONFIG_HOME=root, TERM='xterm-256color', PADCODE_PANEL='off')
    proc = subprocess.Popen([os.environ['PADCODE_NODE'], 'test/fixtures/hub-session.mjs', str(events)], stdin=slave, stdout=slave, stderr=slave, env=env)
    output = b''; cursor = 0
    def pump(wait=.05):
        global output
        if select.select([master], [], [], wait)[0]: output += os.read(master, 65536)
    def expect(token):
        global cursor
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            index = output.find(token, cursor)
            if index >= 0: cursor = index + len(token); return
            pump()
        raise AssertionError((token, output[-1500:]))
    def event(value):
        with events.open('a') as stream: stream.write(json.dumps(value) + '\n')
    def press(button): event(dict(type='button', device=1, button=button, down=True)); event(dict(type='button', device=1, button=button, down=False))
    def received(): return b''.join(bytes.fromhex(s.decode()) for s in re.findall(rb'BYTES:([0-9a-f]+)', output))
    def wait_for(check):
        deadline = time.monotonic() + 8
        while not check() and time.monotonic() < deadline: pump()
        assert check(), output[-1500:]
    try:
        expect(b'PLAYER HUB'); expect(b'GAMEPAD READY'); expect(b'Select [1]')
        time.sleep(.3)
        press('dpad_up'); expect(b'Select [5]')          # Wraps to Start agent session.
        press('south'); expect(b'MISSION START'); expect(b'Select [2]')
        press('dpad_up'); expect(b'Select [1]')
        press('south'); expect(b'INFO:')
        expect(b'PADCODE GAMEPAD ACTIVE')                 # No Options press needed after the Hub.
        assert received() == b'', 'launch confirmation reached the Agent'
        expected = b''
        for button, key in [('dpad_up', b'\x1b[A'), ('south', b'\r'), ('east', b'\x1b'), ('left_shoulder', b'\t'), ('right_shoulder', b'\x1b[Z')]:
            press(button); expected += key; wait_for(lambda: received() == expected)
        os.write(master, 'é'.encode()); expected += 'é'.encode(); wait_for(lambda: received() == expected)
        os.write(master, b'exit!')
        deadline = time.monotonic() + 5
        while proc.poll() is None and time.monotonic() < deadline: pump()
        assert proc.returncode == 23, (proc.returncode, output[-800:])
        assert modes(termios.tcgetattr(slave)) == modes(before)
        assert Path(str(events) + '.starts').read_text() == 'start\n', 'Hub launch restarted the input helper'
    finally:
        if proc.poll() is None: proc.kill(); proc.wait()
        os.close(master); os.close(slave)
print('Hub Agent PTY passed: Hub launch transfers the controller, activates without Options and keeps one helper.')
