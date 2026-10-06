import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { resolveExecutable } from './config.js';

export type Display = { kind: 'panel'; tmux: string; version: string } | { kind: 'transparent'; reason: string };
export const tmuxInstallHint = 'Install tmux 3.2+ (brew install tmux, or apt install tmux) for the controls pane.';

export function supportedTmux(version: string): boolean {
  if (/^tmux openbsd-\d/.test(version)) return true;
  const match = /^tmux (?:next-)?(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 2);
}
export interface DisplayProbe { find?: (name: string) => Promise<string | null>; version?: (binary: string) => Promise<string> }
export async function chooseDisplay(env: NodeJS.ProcessEnv = process.env, probe: DisplayProbe = {}): Promise<Display> {
  if (env.PADCODE_PANEL === 'off') return { kind: 'transparent', reason: 'PADCODE_PANEL=off selects transparent mode.' };
  if (env.TERM === 'dumb') return { kind: 'transparent', reason: 'TERM=dumb cannot draw the controls pane.' };
  const binary = await (probe.find ?? (name => resolveExecutable(name, env.PATH ?? '')))('tmux');
  if (!binary) return { kind: 'transparent', reason: `tmux was not found. ${tmuxInstallHint}` };
  let version: string;
  try { version = (await (probe.version ?? (path => run(path, ['-V'])))(binary)).trim(); }
  catch { return { kind: 'transparent', reason: `tmux did not report its version. ${tmuxInstallHint}` }; }
  if (!supportedTmux(version)) return { kind: 'transparent', reason: `${version.replace(/[^\x20-\x7e]/g, '?').slice(0, 40) || 'tmux'} is not supported. ${tmuxInstallHint}` };
  return { kind: 'panel', tmux: binary, version };
}

// Private servers never inherit the user's tmux target.
export function clientEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env }; delete copy.TMUX; delete copy.TMUX_PANE; return copy;
}
function run(binary: string, args: string[], env: NodeJS.ProcessEnv = clientEnv()): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { env, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`tmux ${args[0] ?? ''} failed: ${String(stderr || error.message).replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 200)}`));
      else resolve(stdout);
    });
  });
}
export class PrivateTmux {
  constructor(readonly binary: string, readonly socket: string, readonly config: string) {}
  run(args: string[], env?: NodeJS.ProcessEnv): Promise<string> { return run(this.binary, ['-S', this.socket, '-f', this.config, ...args], env); }
  args(args: string[]): string[] { return ['-S', this.socket, '-f', this.config, ...args]; }
}

// A read-only control client reports pane mode changes without drawing or resizing.
export class ControlClient {
  private child: ChildProcessWithoutNullStreams;
  private events = new EventEmitter();
  private pending: { resolve: (lines: string[]) => void; reject: (error: Error) => void }[] = [];
  private block: { mine: boolean; lines: string[] } | undefined;
  private buffer = '';
  private exited: Promise<void>;
  constructor(tmux: PrivateTmux, session: string) {
    this.child = spawn(tmux.binary, tmux.args(['-C', 'attach-session', '-t', session, '-f', 'no-output,ignore-size,read-only']), { env: clientEnv(), stdio: 'pipe' });
    this.child.stderr.resume();
    this.child.on('error', () => this.fail());
    this.exited = new Promise(resolve => this.child.on('close', () => { this.fail(); resolve(); }));
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n'); this.buffer = lines.pop()!;
      if (this.buffer.length > 65536) { this.child.kill('SIGTERM'); return; }
      for (const line of lines) this.line(line);
    });
  }
  private line(line: string): void {
    const fields = line.split(' ');
    if (fields[0] === '%begin') { this.block = { mine: fields[3] === '1', lines: [] }; return; }
    if ((fields[0] === '%end' || fields[0] === '%error') && this.block) {
      const block = this.block; this.block = undefined;
      if (!block.mine) return;
      const waiter = this.pending.shift();
      if (fields[0] === '%end') waiter?.resolve(block.lines); else waiter?.reject(new Error('tmux control command failed.'));
      return;
    }
    if (this.block) { this.block.lines.push(line); return; }
    if (fields[0] === '%pane-mode-changed' && fields[1]) this.events.emit('mode', fields[1]);
  }
  private fail(): void { for (const waiter of this.pending.splice(0)) waiter.reject(new Error('tmux control client closed.')); }
  onMode(listener: (pane: string) => void): void { this.events.on('mode', listener); }
  command(line: string): Promise<string[]> {
    if (this.child.exitCode !== null || this.child.stdin.destroyed) return Promise.reject(new Error('tmux control client closed.'));
    return new Promise((resolve, reject) => { this.pending.push({ resolve, reject }); this.child.stdin.write(`${line}\n`); });
  }
  async close(): Promise<void> {
    if (this.child.exitCode === null) {
      this.child.stdin.end();
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
      await this.exited; clearTimeout(timer);
    }
  }
}
