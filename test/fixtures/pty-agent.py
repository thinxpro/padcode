import os, sys, signal, termios, tty, json, time
mode = sys.argv[1]
if mode == 'tail':
    os.write(1, b'Z' * 524288 + b'FINAL_TAIL\n')
    sys.exit(17)
if mode == 'descendant':
    child = os.fork()
    if child == 0:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        while True: os.write(1, b'Q' * 4096)
    sys.exit(0)
if mode == 'stall':
    tty.setraw(0)
    print('READY', flush=True)
    time.sleep(60)
if mode == 'group':
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    child = os.fork()
    if child == 0:
        while True: time.sleep(1)
    print('GROUP:%s:%s' % (os.getpid(), child), flush=True)
    while True: time.sleep(1)
if mode == 'basic':
    tty.setraw(0)
    print('INFO:' + json.dumps({'tty': [os.isatty(x) for x in (0,1,2)], 'cwd': os.getcwd(), 'args': sys.argv[2:], 'env': os.environ.get('PADCODE_PTY_FIXTURE'), 'size': list(os.get_terminal_size())}), flush=True)
    os.write(1, b'\x1b[?1049h\x1b[31mCOLOR\x1b[6n')
    signal.signal(signal.SIGWINCH, lambda *_: print('SIZE:%s' % list(os.get_terminal_size()), flush=True))
    signal.signal(signal.SIGINT, lambda *_: print('SIGNAL_INT', flush=True))
    while True:
        data = os.read(0, 4096)
        if not data: break
        print('BYTES:' + data.hex(), flush=True)
        if os.environ.get('PADCODE_PTY_LOG'):
            with open(os.environ['PADCODE_PTY_LOG'], 'a') as log: log.write(data.hex() + '\n')
        if b'exit!' in data:
            os.write(1, b'\x1b[?1049lFINAL\n')
            sys.exit(23)
