import fcntl, json, os, pty, re, select, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

def scenario(mode, plain=False):
    with tempfile.TemporaryDirectory(prefix='pc-gamepad-agent-') as root:
        events=Path(root)/'events'; events.write_text('')
        master,slave=pty.openpty(); before=termios.tcgetattr(slave)
        fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,90,0,0))
        command=[os.environ['PADCODE_NODE'],'test/fixtures/gamepad-session.mjs',str(events)]
        if len(sys.argv)>1: command.append(sys.argv[1])
        proc=subprocess.Popen(command,stdin=slave,stdout=slave,stderr=slave,env=dict(os.environ,PADCODE_PYTHON=sys.executable,TERM='dumb' if plain else 'xterm-256color'))
        output=b''
        def pump(wait=.05):
            nonlocal output
            if select.select([master],[],[],wait)[0]: output+=os.read(master,65536)
        def until(check):
            deadline=time.monotonic()+7
            while not check() and time.monotonic()<deadline: pump()
            assert check(), output
        def received(): return b''.join(bytes.fromhex(s.decode()) for s in re.findall(rb'BYTES:([0-9a-f]+)',output))
        def event(value):
            with events.open('a') as stream: stream.write(json.dumps(value)+'\n')
        def edge(button,down): event(dict(type='button',device=1,button=button,down=down))
        def press(button): edge(button,True); edge(button,False)
        def quiet():
            end=time.monotonic()+.15
            while time.monotonic()<end: pump(.01)
        try:
            until(lambda:b'INFO:' in output and b'PAUSED' in output)
            time.sleep(.3)
            press('south'); quiet(); assert received()==b''
            press('start'); until(lambda:b'ACTIVE' in output)
            expected=b''
            for button,key in [('dpad_up',b'\x1b[A'),('dpad_down',b'\x1b[B'),('dpad_left',b'\x1b[D'),('dpad_right',b'\x1b[C'),('south',b'\r'),('east',b'\x1b'),('left_shoulder',b'\t'),('right_shoulder',b'\x1b[Z')]:
                press(button); expected+=key; until(lambda:received()==expected)
            os.write(master,'é🎮'.encode()); expected+='é🎮'.encode(); until(lambda:received()==expected)
            edge('south',True); expected+=b'\r'; until(lambda:received()==expected)
            edge('south',True); quiet(); assert received()==expected
            press('start'); edge('dpad_down',True); quiet(); assert received()==expected
            press('start'); edge('dpad_down',True); edge('south',True); quiet(); assert received()==expected
            edge('south',False); press('south'); expected+=b'\r'; until(lambda:received()==expected)
            event(dict(type='disconnected',device=1)); until(lambda:b'DISCONNECTED' in output)
            event(dict(type='connected',device=1,name='Fixture PS4',connection='wireless',serial='aa:bb:cc:dd:ee:ff'))
            time.sleep(.3); press('south'); quiet(); assert received()==expected
            press('start'); press('dpad_up'); expected+=b'\x1b[A'; until(lambda:received()==expected)
            helper=int(Path(str(events)+'.pid').read_text())
            if mode=='failure':
                os.kill(helper,signal.SIGTERM); until(lambda:b'INPUT LOST' in output)
                press('south'); quiet(); assert received()==expected
            if mode=='escape': os.write(master,b'\x1d'); status=130
            elif mode=='signal': proc.send_signal(signal.SIGTERM); status=143
            else: os.write(master,b'exit!'); status=23
            until(lambda:proc.poll() is not None)
            assert proc.returncode==status,(proc.returncode,output)
            assert termios.tcgetattr(slave)==before
            if not plain: assert b'\x1b[22;0t' in output and b'\x1b[23;0t' in output
            else: assert b'PADCODE GAMEPAD PAUSED' in output
            assert Path(str(events)+'.starts').read_text()=='start\n'
            try: os.kill(helper,0)
            except ProcessLookupError: pass
            else: raise AssertionError('input helper survived session exit')
        finally:
            if proc.poll() is None: proc.kill(); proc.wait()
            os.close(master);os.close(slave)

for mode in ('normal','escape','signal','failure'): scenario(mode,mode=='failure')
print('Gamepad Agent PTY passed: exact keys, keyboard Unicode, pause, holds, reconnect, failure, title and helper cleanup.')
