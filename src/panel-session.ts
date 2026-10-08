import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';
import type { AgentGamepad } from './agent-gamepad.js';
import type { Config } from './config.js';
import { resolveExecutable } from './config.js';
import { restoreTerminal } from './agent-session.js';
import { SessionServer } from './session-ipc.js';
import { SessionControls, type HistoryCommand, type MenuView } from './session-controls.js';
import { removeStaleVoice, voiceDirectory, VoiceCapture } from './voice-session.js';
import type { AudioPort } from './audio.js';
import { previewText, wrapText } from './text-width.js';
import { basename } from 'node:path';
import { mapWidth, renderControllerMap } from './controller-map.js';
import { clientEnv, ControlClient, PrivateTmux } from './tmux.js';

type Agent = NonNullable<Config['agent']>;
type Output = Writable & { isTTY?: boolean; columns?: number; rows?: number };
export interface PanelReady { socket: string; directory: string; agentPane: string; panelPane: string }
export interface PanelOptions {
  tmux: string; cwd?: string; gamepad?: AgentGamepad; output?: Output; env?: NodeJS.ProcessEnv;
  onReady?: (ready: PanelReady) => void; startTimeout?: number;
  voice?: Config['voice']; audio?: AudioPort;
}
export class PanelFallback extends Error {}
// Inserted voice text is one line, so no byte of it can act as Enter.
export const insertionLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();
// Very short or yes/no-like transcripts could answer an approval prompt that appeared during transcription.
export const shortAnswer = (text: string) => [...text.replace(/\s/g, '')].length <= 2 || /^[\d\s\p{P}yYnN]*$/u.test(text);
const session = 'padcode';
const panelRows = (rows: number) => rows < 12 ? 1 : 2;

// Bindings refer only to the input-enabled Agent pane; the status pane has input disabled.
export function tmuxConfig(platform: NodeJS.Platform, color: boolean): string {
  const agentOnly = (action: string) => `if -F '#{pane_input_off}' '' "if -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' 'send -M' '${action}'"`;
  const appMouse = `if -F '#{&&:#{!=:#{pane_input_off},1},#{mouse_any_flag}}' 'send -M' ''`;
  return [
    'set -g status off', 'set -g prefix None', 'set -g prefix2 None', 'set -s escape-time 10', 'set -s extended-keys on',
    'set -g history-limit 10000', 'set -g mouse on', 'set -g focus-events on', 'set -g set-titles off', 'set -g remain-on-exit off',
    'set -g pane-border-lines single',
    `set -g pane-border-style '${color ? 'fg=colour8' : 'default'}'`, `set -g pane-active-border-style '${color ? 'fg=colour8' : 'default'}'`,
    ...(platform === 'darwin' ? ["set -s copy-command 'pbcopy'"] : []),
    'unbind -a -T prefix', 'unbind -a -T root',
    `bind -n WheelUpPane ${agentOnly('copy-mode -e')}`,
    `bind -n MouseDrag1Pane ${agentOnly('copy-mode -M')}`,
    `bind -n WheelDownPane ${appMouse}`, `bind -n MouseDown1Pane ${appMouse}`, `bind -n MouseUp1Pane ${appMouse}`,
    '',
  ].join('\n');
}

export async function runPanelAgent(agent: Agent, options: PanelOptions): Promise<number> {
  const output = options.output ?? process.stdout, env = options.env ?? process.env;
  if (!await resolveExecutable(agent.command)) throw new Error('Configured Agent executable is unavailable. Run padcode config.');
  const directory = await mkdtemp(join(tmpdir(), 'pc-'));
  const color = env.NO_COLOR === undefined;
  const tmux = new PrivateTmux(options.tmux, join(directory, 't'), join(directory, 'c'));
  const node = process.execPath, gamepad = options.gamepad;
  const paneAgent = fileURLToPath(new URL('./pane-agent.js', import.meta.url));
  const panePanel = fileURLToPath(new URL('./pane-panel.js', import.meta.url));
  const paneMenu = fileURLToPath(new URL('./pane-menu.js', import.meta.url));
  let server: SessionServer | undefined, control: ControlClient | undefined, client: ChildProcess | undefined;
  let launched = false, serverStarted = false, finished = false;
  const signals: [NodeJS.Signals, number][] = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]];
  const handlers = new Map<NodeJS.Signals, () => void>();
  let gamepadStarted: Promise<void> | undefined, voiceDir: string | undefined, voice: VoiceCapture | undefined;
  const teardown = async () => {
    voice?.dispose();
    if (voiceDir) await rm(voiceDir, { recursive: true, force: true });
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    // An unstarted source is left for the transparent fallback; a started one is released here.
    if (gamepadStarted) { await gamepadStarted; await gamepad?.stop(); }
    await control?.close().catch(() => {});
    if (serverStarted) await tmux.run(['kill-server']).catch(() => {});
    if (client && client.exitCode === null && client.signalCode === null) {
      client.kill('SIGTERM');
      await new Promise(resolve => { const timer = setTimeout(resolve, 1000); client!.once('close', () => { clearTimeout(timer); resolve(undefined); }); });
    }
    await server?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await writeFile(join(directory, 'c'), tmuxConfig(process.platform, color), { mode: 0o600 });
    server = await SessionServer.listen(join(directory, 'i'));
    const ipc = server, token = server.token;
    const paneEnv = ['-e', `PADCODE_IPC=${join(directory, 'i')}`, '-e', `PADCODE_SESSION=${token}`];
    const columns = Math.max(20, output.columns || 80), rows = Math.max(6, output.rows || 24), height = panelRows(rows);
    const connected = (role: 'agent' | 'panel') => new Promise<void>((resolve, reject) => {
      if (ipc.connected(role)) { resolve(); return; }
      const timer = setTimeout(() => reject(new PanelFallback(`The ${role} pane did not start.`)), options.startTimeout ?? 5000);
      ipc.on('connect', joined => { if (joined === role) { clearTimeout(timer); resolve(); } });
    });
    const agentJoined = connected('agent'), panelJoined = connected('panel');
    agentJoined.catch(() => {}); panelJoined.catch(() => {});
    serverStarted = true;
    const [agentPane, agentPid] = (await tmux.run(['new-session', '-d', '-P', '-F', '#{pane_id} #{pane_pid}', '-s', session, '-x', String(columns), '-y', String(rows), '-c', options.cwd ?? process.cwd(), ...paneEnv, '--', node, paneAgent], clientEnv(env))).trim().split(' ');
    if (!/^%\d+$/.test(agentPane ?? '') || !/^\d+$/.test(agentPid ?? '')) throw new PanelFallback('tmux returned unexpected pane identifiers.');
    // Popups inherit the private channel from the session environment rather than command-line arguments.
    await tmux.run(['set-environment', '-t', session, 'PADCODE_IPC', join(directory, 'i'), ';', 'set-environment', '-t', session, 'PADCODE_SESSION', token]);
    // Dead status panes are not kept: if every Padcode process is gone, the private server exits with its panes.
    const createPanel = async (lines: number) => {
      const pane = (await tmux.run(['split-window', '-v', '-d', '-l', String(lines), '-P', '-F', '#{pane_id}', '-t', agentPane!, ...paneEnv, '--', node, panePanel])).trim();
      if (!/^%\d+$/.test(pane)) throw new PanelFallback('tmux returned unexpected pane identifiers.');
      await tmux.run(['select-pane', '-d', '-t', pane, ';',
        'set-hook', '-g', 'window-resized', `if -F '#{<:#{window_height},12}' 'resize-pane -t ${pane} -y 1' 'resize-pane -t ${pane} -y 2'`]);
      return pane;
    };
    let panelPane = await createPanel(height);
    await agentJoined;
    await panelJoined.catch(() => {});
    control = new ControlClient(tmux, session);
    const live = control;
    let latest = 'STARTING / Waiting for Agent', respawns = 0;
    ipc.on('connect', role => { if (role === 'panel') ipc.send('panel', { t: 'status', text: latest }); });
    ipc.send('panel', { t: 'status', text: latest });
    ipc.on('disconnect', role => {
      if (role !== 'panel' || finished) return;
      // A crashed status worker is replaced; the Agent keeps running either way.
      if (respawns++ >= 3) return;
      tmux.run(['display', '-p', '-t', agentPane!, '#{window_height}'])
        .then(rows => createPanel(panelRows(Number(rows) || 24))).then(pane => { panelPane = pane; }).catch(() => {});
    });
    let signalled: number | undefined;
    const terminate = (code: number) => { signalled ??= code; try { process.kill(Number(agentPid), 'SIGTERM'); } catch { /* Already gone. */ } };
    // The controls popup is drawn over the Agent pane, so the Agent is neither resized nor overwritten.
    let popup: ChildProcess | undefined, menuView: MenuView | null = null, closingPopup = false, popupKind = 'menu';
    const kindOf = (view: MenuView) => view.map ? 'map' : view.body !== undefined ? 'body' : 'menu';
    // Draft previews are bounded so every popup message fits one IPC line; the full draft stays here.
    const sendView = (view: MenuView) => ({ ...view, ...(view.body === undefined ? {} : { body: previewText(view.body) }) });
    // The menu can close or change while tmux is queried, so the view is read again after every await,
    // only one open runs at a time, and a failure never escapes into the session.
    let opening = false;
    const openPopup = () => { if (!opening) void openPopupOnce().catch(() => {}); };
    const openPopupOnce = async () => {
      if (popup || finished || !menuView) return;
      opening = true;
      try {
        const clients = await tmux.run(['list-clients', '-F', '#{client_name} #{client_control_mode}']).catch(() => '');
        const name = clients.split('\n').map(line => line.split(' ')).find(([, controlMode]) => controlMode === '0')?.[0];
        // Drafts get a wider popup with room for the wrapped text; the Agent pane is never resized.
        const [cols, rows] = (await tmux.run(['display', '-p', '-t', agentPane!, '#{window_width} #{window_height}']).catch(() => '80 24')).trim().split(' ').map(Number);
        const view = menuView;
        if (!view || popup || finished) return;
        if (!name) { controls.lost(); return; }
        spawnPopup(name, view, cols || 80, rows || 24);
      } finally { opening = false; }
    };
    const spawnPopup = (name: string, view: MenuView, cols: number, rows: number) => {
      const shell = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
      popupKind = kindOf(view);
      const width = popupKind === 'map' ? Math.min(mapWidth + 4, Math.max(30, cols - 2)) : popupKind === 'body' ? Math.min(72, Math.max(30, cols - 4)) : 46;
      const bodyLines = popupKind === 'map' ? renderControllerMap(view.map!, width - 4, false).length + 1 : popupKind === 'body' ? wrapText(view.body!, width - 4).length + 1 : 0;
      const height = Math.min(Math.max(8, rows - 2), view.items.length + 6 + bodyLines);
      popup = spawn(tmux.binary, tmux.args(['display-popup', '-c', name, '-E', '-w', String(width), '-h', String(height), '-x', 'C', '-y', 'C', `${shell(node)} ${shell(paneMenu)}`]), { stdio: 'ignore', env: clientEnv(env) });
      popup.on('error', () => {});
      popup.on('close', () => {
        popup = undefined;
        if (finished) return;
        if (closingPopup) { closingPopup = false; if (menuView) openPopup(); }
        else if (menuView) controls.lost();
      });
    };
    const showMenu = (view: MenuView | null) => {
      menuView = view;
      if (!view) { if (popup) { closingPopup = true; ipc.send('menu', { t: 'close' }); } return; }
      if (popup && !closingPopup && kindOf(view) !== popupKind) { closingPopup = true; ipc.send('menu', { t: 'close' }); return; }
      if (popup && !closingPopup) ipc.send('menu', { t: 'menu', ...sendView(view) }); else openPopup();
    };
    ipc.on('connect', role => { if (role === 'menu') ipc.send('menu', menuView && !closingPopup ? { t: 'menu', ...sendView(menuView) } : { t: 'close' }); });
    const historyCommands: Record<HistoryCommand, string[]> = {
      enter: ['copy-mode', '-e', '-t', agentPane!], up: ['send-keys', '-X', '-t', agentPane!, 'scroll-up'], down: ['send-keys', '-X', '-t', agentPane!, 'scroll-down'],
      'page-up': ['send-keys', '-X', '-t', agentPane!, 'page-up'], 'page-down': ['send-keys', '-X', '-t', agentPane!, 'page-down'], exit: ['send-keys', '-X', '-t', agentPane!, 'cancel'],
    };
    let history = Promise.resolve();
    if (options.voice && options.audio?.supported && gamepad) {
      await removeStaleVoice().catch(() => 0);
      voiceDir = await voiceDirectory();
      voice = new VoiceCapture(options.audio, voiceDir, options.voice.microphone.id, {
        routing: () => gamepad.routing && controls.context === 'agent',
        capture: (handler, status) => gamepad.capture(handler, status),
        release: resume => gamepad.releaseCapture(resume),
        status: text => { latest = text; ipc.send('panel', { t: 'status', text }); },
        notice: text => ipc.send('panel', { t: 'notice', text }),
        draft: text => {
          if ((options.voice!.insert ?? 'auto') === 'auto' && !shortAnswer(text) && controls.context === 'agent') insertText(text);
          else {
            controls.openDraft(text);
            if (controls.context !== 'draft') ipc.send('panel', { t: 'notice', text: 'VOICE DRAFT READY / Options > Review voice draft' });
          }
        },
      }, Date.now, 60, options.voice.transcriber);
      gamepad.onTrigger(value => voice?.trigger(value));
    }
    // The bridge refuses an undo once anything else reached the Agent after the insertion.
    let inserted: number | undefined, undoRerecord = false;
    function insertText(text: string): void {
      const line = insertionLine(text), chars = [...line];
      if (!chars.length || finished) return;
      for (let i = 0; i < chars.length; i += 300) ipc.send('agent', { t: 'paste-part', text: chars.slice(i, i + 300).join('') });
      ipc.send('agent', { t: 'paste-end' });
      inserted = chars.length;
      ipc.send('panel', { t: 'notice', text: `INSERTED ${chars.length} chars / X or Enter sends, Options > Undo voice insert` });
    }
    ipc.on('undo', result => {
      inserted = undefined;
      ipc.send('panel', { t: 'notice', text: result.ok ? undoRerecord ? 'VOICE INSERT UNDONE / Hold L2 to record again' : 'VOICE INSERT UNDONE'
        : 'UNDO UNAVAILABLE / The input changed after the voice insert' });
    });
    const controls = new SessionControls({
      insert: text => insertText(text),
      canUndo: () => inserted !== undefined,
      undo: rerecord => { if (inserted === undefined) return; undoRerecord = rerecord; ipc.send('agent', { t: 'undo', count: inserted }); },
      hasRecording: () => Boolean(voice?.last),
      notice: text => ipc.send('panel', { t: 'notice', text }),
      mapProfile: () => ({ claude: basename(agent.command) === 'claude', voice: Boolean(voice) }),
      play: () => voice?.play(),
      capture: (handler, status) => gamepad?.capture(handler, status),
      release: resume => gamepad?.releaseCapture(resume),
      // Esc stops the running task in Claude Code; Ctrl+C there clears input and a second one exits.
      interrupt: () => ipc.send('agent', { t: 'keys', data: Buffer.from([0x1b]).toString('base64') }),
      // Ctrl+E Ctrl+U clears a readline-style input line; Ctrl+C or double Esc could exit or rewind instead.
      clear: () => ipc.send('agent', { t: 'keys', data: Buffer.from([0x05, 0x15]).toString('base64') }),
      showMenu,
      history: command => { history = history.then(() => tmux.run(historyCommands[command])).then(() => {}, () => {}); },
      end: () => terminate(130),
    });
    ipc.on('action', action => { if (action.name === 'pick') controls.key('confirm', action.index); else controls.key(action.name); });
    gamepad?.onControl(event => { if (event === 'menu') controls.openMenu(); else { voice?.cancel(); controls.lost(); } });
    let modes = Promise.resolve();
    live.onMode(pane => {
      if (pane !== agentPane) return;
      modes = modes.then(async () => {
        const [state] = await live.command(`display -p -t ${agentPane} '#{pane_in_mode}'`);
        if (state === '1') { voice?.cancel(); controls.historyEntered(); } else controls.historyLeft();
      }).catch(() => {});
    });
    options.onReady?.({ socket: tmux.socket, directory, agentPane: agentPane!, panelPane });
    // From here the Agent may run; failures end the session instead of relaunching it.
    const result = new Promise<number>(resolve => {
      ipc.on('exit', code => resolve(code));
      ipc.on('disconnect', role => { if (role === 'agent') resolve(1); });
    });
    const outer: Record<string, string | null> = { TMUX: env.TMUX ?? null, TMUX_PANE: env.TMUX_PANE ?? null };
    ipc.send('agent', { t: 'launch', launch: { command: agent.command, args: agent.args, cwd: options.cwd ?? process.cwd(), env: outer } });
    launched = true;
    let unsubscribe = () => {};
    const abort = new AbortController();
    if (gamepad) {
      unsubscribe = gamepad.subscribe(bytes => ipc.send('agent', { t: 'keys', data: bytes.toString('base64') }),
        text => { latest = text; ipc.send('panel', { t: 'status', text }); }, () => ipc.send('agent', { t: 'cancel' }));
      gamepad.enableMenu();
      gamepadStarted = gamepad.start(abort.signal).catch(() => gamepad.suspend('UNAVAILABLE / Keyboard available'));
    } else { latest = 'KEYBOARD ONLY / No controller configured'; ipc.send('panel', { t: 'status', text: latest }); }
    for (const [signal, code] of signals) { const handler = () => terminate(code); handlers.set(signal, handler); process.on(signal, handler); }
    client = spawn(tmux.binary, tmux.args(['attach-session', '-t', session]), { stdio: 'inherit', env: clientEnv(env) });
    client.on('error', () => terminate(1));
    client.on('close', () => { if (!finished) terminate(signalled ?? 129); });
    const code = await result;
    voice?.dispose(); controls.lost(); finished = true; abort.abort(); unsubscribe(); gamepad?.suspend();
    if (popup) { ipc.send('menu', { t: 'close' }); popup.kill('SIGTERM'); }
    const screen = await tmux.run(['capture-pane', '-p', '-e', '-J', '-t', agentPane!]).catch(() => '');
    ipc.send('agent', { t: 'close' });
    await tmux.run(['detach-client', '-s', session, '-E', 'exit 0']).catch(() => {});
    if (client.exitCode === null && client.signalCode === null) {
      await new Promise(resolve => { const timer = setTimeout(resolve, 2000); client!.once('close', () => { clearTimeout(timer); resolve(undefined); }); });
    }
    const tail = screen.replace(/\s+$/u, '');
    if (!output.destroyed) await new Promise<void>(resolve => output.write(`${restoreTerminal}${tail ? `${tail}\x1b[0m\n` : ''}`, () => resolve()));
    return signalled ?? code;
  } catch (error) {
    if (!launched) throw error instanceof PanelFallback ? error : new PanelFallback((error as Error).message);
    throw error;
  } finally { await teardown(); }
}
