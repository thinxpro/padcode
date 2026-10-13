"""Runs the scripted README demo in a pseudo-terminal at a faster pace and prints its JSON result."""
import fcntl, json, os, pty, select, struct, subprocess, sys, termios, time
trace = sys.argv[1]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 34, 110, 0, 0))
env = dict(os.environ, TERM='xterm-256color', PADCODE_DEMO_TRACE=trace, PADCODE_DEMO_SPEED='0.35'); env.pop('TMUX', None)
proc = subprocess.Popen([os.environ['PADCODE_NODE'], 'scripts/demo/run.mjs'], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
os.close(slave)
deadline = time.monotonic() + 150
while proc.poll() is None and time.monotonic() < deadline:
    if select.select([master], [], [], .1)[0]:
        try: os.read(master, 65536)
        except OSError: pass
if proc.poll() is None: proc.kill(); proc.wait()
print(json.dumps({'code': proc.returncode}))
