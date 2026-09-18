import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import termios
import time

NODE = os.environ['PADCODE_NODE']

def scenario(mode, action, plain=False):
    master, slave = pty.openpty()
    before = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 80, 0, 0))
    env = dict(os.environ, TERM='dumb' if plain else 'xterm-256color')
    if plain: env['NO_COLOR'] = ''
    proc = subprocess.Popen([NODE, 'test/fixtures/session.mjs', mode, 'tty'], stdin=slave, stdout=slave, stderr=slave, env=env)
    output = bytearray()
    deadline = time.monotonic() + 7
    acted = False
    child_pids = []
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.05)[0]:
                try: output.extend(os.read(master, 65536))
                except OSError as e:
                    if e.errno != errno.EIO: raise
            if not acted and (b'DEMO / SYNTHETIC' in output or b'INSERT CONTROLLER' in output):
                # Observe child processes while alive, then assert none survive exit.
                pids = subprocess.run(['pgrep', '-P', str(proc.pid)], capture_output=True, text=True)
                child_pids = [int(x) for x in pids.stdout.split()]
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 16, 40, 0, 0))
                proc.send_signal(signal.SIGWINCH)
                time.sleep(1.0 if mode == 'demo' else 0.1)
                if action == 'signal': proc.send_signal(signal.SIGTERM)
                else: os.write(master, action)
                acted = True
            if proc.poll() is not None:
                while select.select([master], [], [], 0)[0]:
                    output.extend(os.read(master, 65536))
                break
        assert proc.poll() is not None, f'{mode}: process failed to exit'
        assert termios.tcgetattr(slave) == before, f'{mode}: termios not restored'
        if plain: assert b'\x1b' not in output, 'dumb terminal got ANSI controls'
        else:
            assert b'\x1b[?1049h' in output and b'\x1b[?25l' in output
            assert b'\x1b[?25h\x1b[?1049l' in output, f'{mode}: missing screen/cursor restore'
        expected = 1 if mode in ['missing', 'malformed', 'crash'] else 143 if action == 'signal' else 130 if action == b'\x03' else 0
        assert proc.returncode == expected, (mode, proc.returncode, bytes(output))
        for pid in child_pids:
            try: os.kill(pid, 0)
            except ProcessLookupError: pass
            else: raise AssertionError(f'helper {pid} survived session')
        return output.decode(errors='replace')
    finally:
        if proc.poll() is None: proc.kill(); proc.wait()
        os.close(master); os.close(slave)

for mode, action, plain in [('demo', b'q', False), ('demo', b'\x1b', False), ('demo', b'q', True), ('wait', b'\x03', False), ('stubborn', 'signal', False), ('missing', b'q', False), ('malformed', b'q', False), ('crash', b'q', False)]:
    scenario(mode, action, plain)
print('PTY checks passed: UI, resize, quit, signals, failures, termios and helper cleanup.')
