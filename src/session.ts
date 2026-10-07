import { spawn } from 'node:child_process';
import { helperPath } from './process.js';
import { EventDecoder, type Event } from './protocol.js';
import { createState, reduce } from './state.js';
import { colorEnabled, render } from './ui.js';
import type { MenuInput } from './menu-controller.js';

export interface SessionOptions { demo: boolean; json: boolean; helper?: string; helperArgs?: string[]; back?: MenuInput; holdMs?: number }
export async function session(options: SessionOptions): Promise<number> {
  const input = process.stdin, output = process.stdout;
  if (!options.json && (!input.isTTY || !output.isTTY)) {
    process.stderr.write('Controller dashboard requires a terminal. Use controllers --json for pipes.\n'); return 2;
  }
  const state = createState();
  if (options.demo) { state.source = 'demo'; state.ready = true; }
  const decoder = new EventDecoder();
  const helper = options.demo ? '' : options.helper ?? helperPath('padcode-controller');
  const child = options.demo ? null : spawn(helper, options.helperArgs ?? [], { stdio: ['ignore', 'pipe', 'pipe'] });
  const interactive = !options.json;
  const terminalControl = interactive && process.env.TERM !== 'dumb';
  const wasRaw = input.isRaw ?? false;
  let finished = false, restored = false, dirty = true, blocked = false, stderr = '';
  let frame: NodeJS.Timeout | undefined, demoTimer: NodeJS.Timeout | undefined, holdTimer: NodeJS.Timeout | undefined;
  let releaseBack = () => {};
  let handshakeTimer: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined;
  let ending: (() => void) | undefined;
  let lastPlain = '';
  return await new Promise<number>(resolve => {
    const restore = () => {
      if (restored) return;
      restored = true;
      clearInterval(frame); clearInterval(demoTimer); clearTimeout(handshakeTimer); clearTimeout(holdTimer); releaseBack();
      input.removeListener('data', onKey);
      output.removeListener('resize', onResize);
      if (interactive) { input.setRawMode(wasRaw); input.pause(); }
      if (terminalControl && !output.destroyed) output.write('\x1b[?25h\x1b[?1049l');
    };
    const complete = (code: number) => {
      clearTimeout(killTimer);
      process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
      process.removeListener('exit', onExit);
      output.removeListener('drain', onDrain);
      // Keep the error listener until process exit: writes already queued may still report EPIPE.
      resolve(code);
    };
    const finish = (code: number, message?: string) => {
      if (finished) return;
      finished = true;
      restore();
      if (message) process.stderr.write(`Padcode: ${message}\n`);
      if (child && child.exitCode === null && child.signalCode === null) {
        ending = () => complete(code);
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 750);
      } else complete(code);
    };
    const onInt = () => finish(130);
    const onTerm = () => finish(143);
    const onExit = () => { restore(); child?.kill('SIGTERM'); };
    const onResize = () => { dirty = true; };
    const onDrain = () => { blocked = false; child?.stdout?.resume(); dirty = true; };
    const onKey = (chunk: Buffer) => {
      if (chunk.includes(3)) onInt();
      else if (chunk.includes(113) || chunk.includes(81) || chunk.equals(Buffer.from([27]))) finish(0);
    };
    const draw = () => {
      if (!interactive || !dirty || blocked || finished) return;
      const picture = render(state, output.columns || 80, output.rows || 30, colorEnabled(process.env, true));
      dirty = false;
      if (!terminalControl && picture === lastPlain) return;
      lastPlain = picture;
      blocked = !output.write(terminalControl ? `\x1b[H${picture.replace(/\n/g, '\r\n')}\x1b[J` : `${picture}\n`);
    };
    // A held O leaves the live lab, but only after release so the press cannot reach the next menu.
    const holdBack = (event: Event) => {
      if (event.type === 'disconnected' && state.back === 'release') { finish(0); return; }
      if (event.type !== 'button' || event.button !== 'east') return;
      clearTimeout(holdTimer);
      if (event.down) holdTimer = setTimeout(() => { state.back = 'release'; dirty = true; }, options.holdMs ?? 1000);
      else if (state.back === 'release') finish(0);
    };
    const accept = (event: Event) => {
      if (event.type === 'ready') clearTimeout(handshakeTimer);
      reduce(state, event); dirty = true;
      if (interactive && !options.demo) holdBack(event);
      if (options.json && !output.destroyed) {
        if (!output.write(`${JSON.stringify(event)}\n`)) { blocked = true; child?.stdout?.pause(); }
      }
    };
    output.on('error', error => finish((error as NodeJS.ErrnoException).code === 'EPIPE' ? 0 : 1));
    output.on('drain', onDrain);
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm); process.on('exit', onExit);
    if (interactive) {
      const back = options.demo ? options.back ? 'press' : undefined : 'hold';
      if (back) state.back = back;
      if (options.back) releaseBack = options.back.subscribeAction(action => { if (action === 'cancel') finish(0); });
      if (terminalControl) output.write('\x1b[?1049h\x1b[?25l');
      input.setRawMode(true); input.resume(); input.on('data', onKey); output.on('resize', onResize);
      frame = setInterval(draw, 50); draw();
    }
    if (options.demo) {
      reduce(state, { v: 1, seq: 0, time: 0, type: 'connected', device: 1, name: 'DUALSHOCK 4 / PREVIEW' });
      state.source = 'demo'; state.ready = true; dirty = true;
      let tick = 0;
      demoTimer = setInterval(() => {
        tick++;
        reduce(state, { v: 1, seq: tick, time: tick, type: 'axis', device: 1, axis: 'leftx', value: Math.round(Math.sin(tick / 3) * 32767) });
        if (tick % 3 === 0) reduce(state, { v: 1, seq: tick, time: tick, type: 'button', device: 1, button: 'south', down: tick % 6 === 0 });
        dirty = true;
      }, 150);
    } else if (child) {
      handshakeTimer = setTimeout(() => finish(1, 'Controller helper did not become ready within 5 seconds.'), 5000);
      child.stdout?.on('data', (data: Buffer) => {
        if (finished) return;
        try { for (const event of decoder.push(data)) accept(event); } catch (error) { finish(1, (error as Error).message); }
      });
      child.stderr?.on('data', (data: Buffer) => { stderr = (stderr + data.toString('utf8')).slice(-2048); });
      child.on('error', error => {
        // Spawn failure does not have an exit code and cannot be killed.
        if (!finished) { finished = true; restore(); process.stderr.write(`Padcode: Cannot start controller helper (${error.message}). Run npm run build:native.\n`); complete(1); }
      });
      child.on('close', (code, signal) => {
        if (finished) { ending?.(); return; }
        try { decoder.end(); } catch (error) { finish(1, (error as Error).message); return; }
        finish(code === 0 ? 0 : 1, code === 0 ? undefined : `Controller helper exited (${signal ?? code}). ${stderr.replace(/[\x00-\x1f\x7f]/g, ' ').trim()}`);
      });
    }
  });
}
