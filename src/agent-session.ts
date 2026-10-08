import { AgentGamepad, type ControllerSource } from './agent-gamepad.js';
import { fileURLToPath } from 'node:url';
import { hostChannel } from './host-channel.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { IPty } from 'node-pty';
import { loadConfig, resolveExecutable, type Config } from './config.js';
import type { PromptPort } from './prompt.js';
import { TerminalPrompt } from './prompt.js';
import { GamepadMenus, type MenuFeed } from './menu-controller.js';
import { PtyWriter } from './pty-writer.js';
import { chooseDisplay, type Display } from './tmux.js';
import { PanelFallback, runPanelAgent } from './panel-session.js';
import { NativeAudio } from './audio.js';

type Agent = NonNullable<Config['agent']>;
type Input = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
type Output = Writable & { isTTY?: boolean; columns?: number; rows?: number };
export const restoreTerminal = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1l\x1b>\x1b[?1049l\x1b[0m\x1b[?25h';

export async function confirmAgent(io: PromptPort, agent: Agent, cwd: string, display?: Display): Promise<boolean> {
  if (!await resolveExecutable(agent.command)) throw new Error('Configured Agent executable is unavailable. Run padcode config.');
  io.banner('MISSION START / AGENT SESSION');
  io.say(`EXEC ${agent.command}`); io.say(`ARGS ${JSON.stringify(agent.args)}`); io.say(`PROJECT ${cwd}`);
  io.say('Keyboard controls the Agent. Ctrl+C goes to the Agent; Ctrl+] ends this session.');
  io.say('GAMEPAD / saved controller continues automatically after buttons are released.');
  io.say('Unidentified controllers and reconnects start PAUSED; press/release {menu} to enable.');
  if (display?.kind === 'panel') {
    io.say('D-pad arrows / {confirm} Enter / {back} Escape / {l1} Tab / {r1} Shift+Tab / {menu} controls menu.');
    io.say(`DISPLAY / Controls pane (${display.version}). {menu} opens resume, pause, history, interrupt and end session.`);
  } else {
    io.say('D-pad arrows / {confirm} Enter / {back} Escape / {l1} Tab / {r1} Shift+Tab / {menu} pause.');
    if (display) io.say(`DISPLAY / Transparent. ${display.reason}`);
    io.say('Mapping status appears in the terminal title where supported. Keyboard stays available.');
  }
  return await io.choose('Launch this Agent in the current project?', [
    { label: 'Start agent session', value: 'start' }, { label: 'Cancel / return without launching', value: 'cancel' },
  ], 1) === 'start';
}

// Lets the controls-pane bridge see input and output and write text through the same bounded writer.
export interface InputTap { attach(write: (bytes: Buffer) => void): void; input(): void; output(data: Buffer): void }
export async function runAgent(agent: Agent, options: { cwd?: string; input?: Input; output?: Output; stallTimeout?: number; controller?: Config['controller']; gamepad?: ControllerSource; titleStatus?: boolean; tap?: InputTap } = {}): Promise<number> {
  const input = options.input ?? process.stdin, output = options.output ?? process.stdout;
  if (!input.isTTY || !output.isTTY) throw new Error('Agent sessions require an interactive terminal.');
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Agent sessions currently support macOS and Linux only.');
  if (!await resolveExecutable(agent.command)) throw new Error('Configured Agent executable is unavailable. Run padcode config.');
  const built = JSON.parse(readFileSync(new URL('../build/pty/platform.json', import.meta.url), 'utf8')) as { platform: string; arch: string };
  if (built.platform !== process.platform || built.arch !== process.arch) throw new Error(`PTY runtime was built for ${built.platform}/${built.arch}. Use a package built for this computer.`);
  const runtime = createRequire(import.meta.url)('../build/pty') as typeof import('node-pty');
  const size = () => ({ cols: Math.max(1, output.columns || 80), rows: Math.max(1, output.rows || 24) });
  const channel = await hostChannel();
  const gamepad = options.gamepad ?? (options.controller ? new AgentGamepad(options.controller) : undefined);
  const titleStatus = options.titleStatus ?? true;
  const mappingAbort = new AbortController();
  let mappingStarted = Promise.resolve(), unsubscribeMapping = () => {};
  try {
    const pty = runtime.spawn(process.execPath, [fileURLToPath(new URL('./agent-host.js', import.meta.url)), channel.path, agent.command, ...agent.args], { ...size(), cwd: options.cwd ?? process.cwd(), env: { ...process.env }, name: process.env.TERM || 'xterm-256color', encoding: null }) as IPty & { fd: number; on: (name: string, cb: (error: Error) => void) => void; destroy: () => void };
    const wasRaw = Boolean(input.isRaw);
    const stallTimeout = options.stallTimeout ?? 10000;
    return await new Promise<number>((resolve, reject) => {
      let ended = false, stopping = false, finished = false, code = 0, failure: Error | undefined;
      let groupDone = false, pending = 0, agentExited = false, acknowledged = false;
      let quiet: NodeJS.Timeout | undefined, finalDrain: NodeJS.Timeout | undefined;
      const acknowledge = () => {
        clearTimeout(quiet);
        if (!agentExited || acknowledged || stopping || finished || pending) return;
        quiet = setTimeout(() => {
          if (!pending && !stopping && !finished) { acknowledged = true; channel.acknowledge(); }
        }, 50);
      };
      channel.onExit(() => {
        agentExited = true; writer.close(); gamepad?.suspend(); input.pause();
        finalDrain = setTimeout(() => stop(1, new Error('Agent final output did not drain within 10 seconds.')), stallTimeout);
        acknowledge();
      });
      let stall: NodeJS.Timeout | undefined, escalation: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
      const killGroup = (signal: NodeJS.Signals) => {
        if (pty.pid <= 1 || pty.pid === process.pid) return;
        try { process.kill(-pty.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error; }
      };
      const cleanupGroup = () => {
        if (escalation) return;
        killGroup('SIGTERM');
        escalation = setTimeout(() => { killGroup('SIGKILL'); groupDone = true; complete(); }, 750);
      };
      const writer = new PtyWriter(pty.fd, () => input.pause(), () => { if (!stopping && !ended && !agentExited) input.resume(); }, error => stop(1, error), stallTimeout);
      const complete = () => {
        if (finished || !ended || !groupDone || pending) return;
        finished = true; writer.close(); mappingAbort.abort(); unsubscribeMapping(); clearTimeout(stall); clearTimeout(escalation); clearTimeout(deadline); clearTimeout(quiet); clearTimeout(finalDrain);
        input.pause(); input.removeListener('data', receive); input.removeListener('end', eof); input.removeListener('error', failed);
        output.removeListener('resize', resize); output.removeListener('drain', drain);
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
        try { input.setRawMode?.(wasRaw); } catch (error) { failure ??= error as Error; }
        let restored = false;
        const restoreDeadline = setTimeout(() => done(), 250);
        const done = () => {
          if (restored) return; restored = true; clearTimeout(restoreDeadline);
          output.removeListener('error', failed); if (failure) reject(failure); else resolve(code);
        };
        try { if (!output.destroyed && process.env.TERM !== 'dumb') output.write(restoreTerminal + (gamepad && titleStatus ? '\x1b[23;0t' : ''), done); else done(); }
        catch (error) { failure ??= error as Error; done(); }
      };
      const stop = (exitCode: number, error?: Error) => {
        if (finished || stopping) return;
        stopping = true; code = exitCode; failure = error; writer.close(); gamepad?.suspend(); input.pause(); cleanupGroup();
        pty.resume();
        deadline = setTimeout(() => { pty.destroy(); ended = true; pending = 0; complete(); }, 1500);
      };
      const failed = (error: Error) => stop(1, error);
      const receive = (data: Buffer | string) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const escape = buffer.indexOf(0x1d);
        if (escape !== -1) { stop(130); return; }
        options.tap?.input(); writer.push(buffer);
      };
      const eof = () => stop(130), interrupt = () => stop(130), terminate = () => stop(143);
      const resize = () => { if (!ended && !stopping) { try { const s = size(); pty.resize(s.cols, s.rows); } catch (error) { failed(error as Error); } } };
      const drain = () => { clearTimeout(stall); stall = undefined; if (!stopping) pty.resume(); };
      pty.on('error', error => {
        // Linux PTY readers report EIO when the slave closes; onExit supplies status.
        if ((error as NodeJS.ErrnoException).code !== 'EIO') failed(error);
      });
      pty.onData(data => {
        if (stopping || finished) return;
        options.tap?.output(data as unknown as Buffer);
        clearTimeout(quiet); pending++;
        try {
          if (!output.write(data, error => { pending--; if (error) failed(error); acknowledge(); complete(); })) {
            pty.pause(); stall ??= setTimeout(() => stop(1, new Error('Terminal output stalled.')), stallTimeout);
          }
        } catch (error) { pending--; failed(error as Error); }
      });
      pty.onExit(event => {
        ended = true; writer.close(); input.pause();
        if (!stopping) code = event.signal ? 128 + event.signal : event.exitCode;
        cleanupGroup(); complete();
      });
      if (gamepad) {
        let activationShown = false;
        const showStatus = (status: string) => {
          if (!titleStatus || finished || stopping || agentExited || output.destroyed) return;
          const visible = status.startsWith('ACTIVE') && !activationShown ? `\r\nPADCODE GAMEPAD ${status}\r\n` : '';
          if (visible) activationShown = true;
          const text = process.env.TERM === 'dumb' ? `\r\nPADCODE GAMEPAD ${status}\r\n` : `${visible}\x1b]0;PADCODE | GAMEPAD ${status}\x07`;
          try { output.write(text, error => { if (error) failed(error); }); } catch (error) { failed(error as Error); }
        };
        try { if (titleStatus && process.env.TERM !== 'dumb') output.write('\x1b[22;0t', error => { if (error) failed(error); }); } catch (error) { failed(error as Error); }
        unsubscribeMapping = gamepad.subscribe(bytes => {
          if (!stopping && !ended && !agentExited && !finished) { options.tap?.input(); writer.push(bytes, true); }
        }, showStatus, () => writer.discardController());
        mappingStarted = gamepad.start(mappingAbort.signal).catch(() => gamepad.suspend('UNAVAILABLE / Keyboard available'));
      }
      options.tap?.attach(bytes => { if (!stopping && !ended && !agentExited && !finished) writer.push(bytes); });
      input.on('data', receive); input.on('end', eof); input.on('error', failed);
      output.on('resize', resize); output.on('drain', drain); output.on('error', failed);
      process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
      try { input.setRawMode?.(true); input.resume(); } catch (error) { failed(error as Error); }
    });
  } finally { mappingAbort.abort(); await mappingStarted; unsubscribeMapping(); await gamepad?.stop(); await channel.close(); }
}

export async function runConfiguredAgent(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Agent sessions require an interactive terminal.');
  const config = await loadConfig();
  if (!config?.agent) throw new Error('Choose an Agent first with padcode config.');
  const controller = new AbortController(), menus = new GamepadMenus();
  let exitCode = 130;
  const abort = () => controller.abort();
  const terminate = () => { exitCode = 143; controller.abort(); };
  const io = new TerminalPrompt(controller.signal, abort, menus);
  let launch = false, handedOff: MenuFeed | undefined;
  const display = await chooseDisplay();
  process.on('SIGINT', abort); process.on('SIGTERM', terminate);
  try {
    if (config.controller.address || config.controller.transport === 'usb') await menus.activate(config.controller, controller.signal, true);
    launch = await confirmAgent(io, config.agent, process.cwd(), display);
    if (launch) handedOff = menus.handoff();
  } catch (error) {
    if (controller.signal.aborted) return exitCode;
    if ((error as Error).message === 'Setup cancelled.') return 0;
    throw error;
  } finally { await menus.stop(); io.close(); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', terminate); }
  if (!launch) return 0;
  return launchConfigured(config.agent, config.controller, handedOff, display, config.voice);
}
// Player Hub and padcode run share one launch path so the menu feed always transfers into the session.
export async function launchConfigured(agent: Agent, controller: Config['controller'], handedOff: MenuFeed | undefined, display: Display, voice: Config['voice'] = null): Promise<number> {
  const trace = process.env.PADCODE_INPUT_TRACE === '1'
    ? (event: string, generation: number, device?: number) => { process.stderr.write(`PADCODE INPUT event=${event} generation=${generation}${device === undefined ? '' : ` device=${device}`}\n`); }
    : undefined;
  // Claude Code gets its newline and undo keys on R2/R3; other Agents keep only universal editing keys.
  const editing = basename(agent.command) === 'claude' ? 'claude' as const : 'basic' as const;
  const gamepad = handedOff ? new AgentGamepad(controller, {
    factory: () => handedOff, feedStarted: true, automaticHandoff: true, editing, ...(trace ? { trace } : {}),
  }) : new AgentGamepad(controller, { editing, ...(trace ? { trace } : {}) });
  if (display.kind === 'panel') {
    try { return await runPanelAgent(agent, { tmux: display.tmux, gamepad, voice, audio: new NativeAudio() }); }
    catch (error) {
      if (!(error instanceof PanelFallback)) throw error;
      process.stderr.write(`Padcode: controls pane unavailable (${safeText(error.message)}). Continuing in transparent mode.\n`);
    }
  }
  return runAgent(agent, { controller, gamepad });
}
const safeText = (text: string) => text.replace(/[^\x20-\x7e]/g, '?').slice(0, 200);
