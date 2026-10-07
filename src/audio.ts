import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { helperPath, runCommand } from './process.js';

// Microphone access through the macOS padcode-audio helper. Audio never leaves the recording file.
export type MicPermission = 'authorized' | 'denied' | 'restricted' | 'not-determined';
export interface Microphone { id: string; name: string; default: boolean; transport: 'bluetooth' | 'usb' | 'built-in' | 'other' | 'unknown' }
export type RecordingResult = { kind: 'stopped'; seconds: number } | { kind: 'cancelled' } | { kind: 'error'; code: string; message: string };
export interface Recording {
  onLevel(listener: (peak: number) => void): void;
  onStarted(listener: () => void): void;
  // The first real audio sample; Bluetooth headsets need about a second to get there.
  onLive(listener: () => void): void;
  stop(): void;
  cancel(): void;
  readonly done: Promise<RecordingResult>;
}
export interface AudioPort {
  readonly supported: boolean;
  list(): Promise<Microphone[]>;
  permission(): Promise<MicPermission>;
  request(): Promise<MicPermission>;
  record(options: { path: string; device?: string; maxSeconds: number }): Recording;
  play(path: string): { stop(): void; done: Promise<void> };
  speechPermission(): Promise<MicPermission>;
  speechRequest(): Promise<MicPermission>;
  transcribe(path: string, locale: string, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string }>;
}
const clean = (text: unknown, limit: number) => typeof text === 'string' ? text.replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit) : '';
const permissions: MicPermission[] = ['authorized', 'denied', 'restricted', 'not-determined'];
function parse(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  const value = JSON.parse(line) as Record<string, unknown>;
  if (value.ok !== true) throw new Error(clean(value.message, 300) || 'Microphone helper failed.');
  return value;
}
export interface NativeAudioOptions { command?: string; args?: string[]; player?: string; supported?: boolean }
export class NativeAudio implements AudioPort {
  private command: string; private extraArgs: string[]; private player: string; private available: boolean;
  constructor(options: NativeAudioOptions = {}) {
    this.command = options.command ?? (process.platform === 'darwin' ? helperPath('padcode-audio') : '');
    this.extraArgs = options.args ?? []; this.player = options.player ?? '/usr/bin/afplay';
    this.available = options.supported ?? (process.platform === 'darwin' && Boolean(this.command) && existsSync(this.command));
  }
  get supported(): boolean { return this.available; }
  private async call(args: string[], timeout = 10000): Promise<Record<string, unknown>> {
    const result = await runCommand(this.command, [...this.extraArgs, ...args], { timeout, maxBytes: 65536 });
    return parse(result.stdout);
  }
  async list(): Promise<Microphone[]> {
    const devices = (await this.call(['list'])).devices;
    if (!Array.isArray(devices)) throw new Error('Microphone helper returned no device list.');
    const transports = ['bluetooth', 'usb', 'built-in', 'other'] as const;
    return devices.slice(0, 32).map(device => ({ id: clean(device.id, 512), name: clean(device.name, 128) || 'Unnamed input', default: device.default === true,
      transport: transports.find(kind => kind === device.transport) ?? 'unknown' as const })).filter(device => device.id);
  }
  private status(value: Record<string, unknown>): MicPermission {
    if (!permissions.includes(value.status as MicPermission)) throw new Error('Microphone helper returned an unknown permission state.');
    return value.status as MicPermission;
  }
  async permission(): Promise<MicPermission> { return this.status(await this.call(['permission'])); }
  // The system prompt waits for the user, so the request allows up to five minutes.
  async request(): Promise<MicPermission> { return this.status(await this.call(['request'], 300000)); }
  async speechPermission(): Promise<MicPermission> { return this.status(await this.call(['speech-permission'])); }
  async speechRequest(): Promise<MicPermission> { return this.status(await this.call(['speech-request'], 300000)); }
  // On-device macOS speech; helper failures come back as structured results instead of exceptions.
  async transcribe(path: string, locale: string, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string }> {
    try {
      const result = await runCommand(this.command, [...this.extraArgs, 'transcribe', '--file', path, '--language', locale], { timeout: 130000, maxBytes: 128 * 1024, signal });
      const line = result.stdout.trim().split('\n').at(-1) ?? '';
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.ok === true && typeof value.text === 'string') return { ok: true, text: value.text };
      return { ok: false, code: clean(value.code, 40) || 'transcription', message: clean(value.message, 300) || 'Speech recognition failed.' };
    } catch (error) {
      if (signal.aborted) return { ok: false, code: 'cancelled', message: 'Transcription cancelled.' };
      return { ok: false, code: 'helper', message: clean((error as Error).message, 200) || 'The speech helper failed.' };
    }
  }
  record(options: { path: string; device?: string; maxSeconds: number }): Recording {
    const args = [...this.extraArgs, 'record', '--out', options.path, '--max-seconds', String(options.maxSeconds), ...(options.device ? ['--device', options.device] : [])];
    const child = spawn(this.command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const events = new EventEmitter();
    let buffer = '', result: RecordingResult | undefined;
    const done = new Promise<RecordingResult>(resolve => {
      const finish = (value: RecordingResult) => { result ??= value; };
      child.stdin.on('error', () => {});
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.length > 65536) { child.kill('SIGTERM'); return; }
        const lines = buffer.split('\n'); buffer = lines.pop()!;
        for (const line of lines) {
          let value: Record<string, unknown>;
          try { value = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (value.event === 'started') events.emit('started');
          else if (value.event === 'live') events.emit('live');
          else if (value.event === 'level' && typeof value.peak === 'number') events.emit('level', Math.max(0, Math.min(1, value.peak)));
          else if (value.event === 'stopped' && typeof value.seconds === 'number') finish({ kind: 'stopped', seconds: value.seconds });
          else if (value.event === 'cancelled') finish({ kind: 'cancelled' });
          else if (value.event === 'error') finish({ kind: 'error', code: clean(value.code, 32) || 'io', message: clean(value.message, 300) || 'Recording failed.' });
        }
      });
      child.on('error', error => { finish({ kind: 'error', code: 'spawn', message: `Cannot start the microphone helper (${clean(error.message, 120)}).` }); resolve(result!); });
      child.on('close', code => { finish(code === 0 ? { kind: 'cancelled' } : { kind: 'error', code: 'crash', message: 'The microphone helper stopped unexpectedly.' }); resolve(result!); });
    });
    const send = (line: string) => { if (child.exitCode === null && !child.stdin.destroyed) child.stdin.write(`${line}\n`); };
    return {
      onLevel: listener => { events.on('level', listener); },
      onStarted: listener => { events.on('started', listener); },
      onLive: listener => { events.on('live', listener); },
      stop: () => send('stop'),
      cancel: () => { send('cancel'); setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM'); }, 1000).unref(); },
      done,
    };
  }
  play(path: string): { stop(): void; done: Promise<void> } {
    const child = spawn(this.player, [path], { stdio: 'ignore' });
    const done = new Promise<void>(resolve => { child.on('error', () => resolve()); child.on('close', () => resolve()); });
    return { stop: () => { if (child.exitCode === null) child.kill('SIGTERM'); }, done };
  }
}
