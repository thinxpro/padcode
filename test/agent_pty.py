"""Real outer terminal regression, also run against the offline installed package."""
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path
NODE = os.environ['PADCODE_NODE']
CLI = str(Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/cli.js').resolve())
with tempfile.TemporaryDirectory(prefix='padcode-agent-') as directory:
    root = Path(directory)
    (root / 'padcode').mkdir()
    fixture = root / 'agent.py'
    fixture.write_text('''import os, signal, sys
print("AGENT_READY", flush=True)
signal.signal(signal.SIGINT, lambda *_: print("CHILD_INTERRUPT", flush=True))
for line in sys.stdin:
    print("ECHO:" + line.strip(), flush=True)
    if line.strip() == "exit!":
        print("FINAL_OUTPUT", flush=True)
        sys.exit(7)
''')
    config = root / 'padcode/config.json'
    config.write_text(json.dumps({'version':1, 'controller':{'transport':'bluetooth','inputVerified':False},'agent':{'command':sys.executable,'args':[str(fixture)]},'profile':'terminal-basic'}))
    def scenario(mode, hub=False, plain=False):
        master, slave = pty.openpty()
        before = termios.tcgetattr(slave)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',30,100,0,0))
        env = dict(os.environ, XDG_CONFIG_HOME=directory, TERM='dumb' if plain else 'xterm-256color')
        proc = subprocess.Popen([NODE,CLI,*([] if hub else ['run'])],stdin=slave,stdout=slave,stderr=slave,env=env,cwd=directory)
        output = b''; cursor = 0
        def expect(token):
            nonlocal output, cursor
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                index=output.find(token,cursor)
                if index>=0: cursor=index+len(token); return
                if select.select([master],[],[],.05)[0]: output+=os.read(master,65536)
                if proc.poll() is not None: break
            raise AssertionError((token,output))
        try:
            if hub:
                expect(b'Select [1]'); os.write(master,b'5\n')
            expect(b'Select [2]')
            assert b'AGENT_READY' not in output
            if mode=='cancel': os.write(master,b'\n'); expected=0
            else:
                os.write(master,b'1\n'); expect(b'AGENT_READY')
                if mode=='normal':
                    os.write(master,b'\x03'); expect(b'CHILD_INTERRUPT')
                    os.write(master,'héllo🎮\n'.encode()); expect('ECHO:héllo🎮'.encode())
                    os.write(master,b'exit!\n'); expect(b'FINAL_OUTPUT'); expected=7
                elif mode=='escape': os.write(master,b'\x1d'); expected=130
                else:
                    proc.send_signal(signal.SIGTERM if mode=='term' else signal.SIGINT)
                    expected=143 if mode=='term' else 130
            deadline=time.monotonic()+5
            while proc.poll() is None and time.monotonic()<deadline:
                if select.select([master],[],[],.05)[0]: output+=os.read(master,65536)
            assert proc.poll()==expected,(proc.poll(),output)
            assert termios.tcgetattr(slave)==before,'outer terminal flags not restored'
            if mode=='cancel': assert b'AGENT_READY' not in output
            elif not plain: assert b'\x1b[?1049l' in output and b'\x1b[?25h' in output
        finally:
            if proc.poll() is None: proc.kill(); proc.wait()
            os.close(master);os.close(slave)
    scenario('cancel')
    scenario('normal')
    scenario('normal',hub=True,plain=True)
    scenario('escape')
    scenario('term')
    scenario('int')
    config.unlink()
    master,slave=pty.openpty()
    try:
        p=subprocess.Popen([NODE,CLI,'run'],stdin=slave,stdout=slave,stderr=slave,env=dict(os.environ,XDG_CONFIG_HOME=directory))
        p.wait(timeout=5); assert p.returncode==1
        assert b'Choose an Agent first' in os.read(master,65536)
    finally: os.close(master);os.close(slave)
print('Agent outer PTY passed: confirmation, hub, literal Unicode input, Ctrl+C, exits, emergency stop, external signals and terminal restoration.')
