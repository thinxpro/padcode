import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { EventDecoder, type Event } from './protocol.js';
import { helperPath } from './process.js';
import { normalizeAddress } from './bluetooth.js';

export type InputDevice = Extract<Event, { type: 'connected' }>;
export interface ProbePort {
  start(signal: AbortSignal): Promise<void>;
  devices(signal: AbortSignal): Promise<InputDevice[]>;
  press(device: number, signal: AbortSignal): Promise<string>;
  stop(): Promise<void>;
}
export function identityMatch(device: InputDevice, transport: 'bluetooth' | 'usb', address?: string): 'match' | 'manual' | 'mismatch' {
  if (transport === 'bluetooth' && device.connection === 'wired') return 'mismatch';
  if (transport === 'usb' && device.connection === 'wireless') return 'mismatch';
  if (address && device.serial) return normalizeAddress(address) === normalizeAddress(device.serial) ? 'match' : 'mismatch';
  return 'manual';
}
export class ControllerProbe implements ProbePort {
  private child: ChildProcessWithoutNullStreams | undefined;
  private events = new EventEmitter();
  private connected = new Map<number, InputDevice>();
  private held = new Map<number, Set<string>>();
  private failure: Error | undefined;
  private ready = false;
  private closing = false;
  private closed: Promise<void> = Promise.resolve();
  constructor(private command?: string, private args: string[] = []) {}
  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const child = spawn(this.command ?? helperPath('padcode-controller'), this.args, { stdio: 'pipe' });
    this.child = child;
    child.stdin.end();
    const decoder = new EventDecoder();
    const fail = (error: Error) => { this.failure = error; this.events.emit('change'); };
    child.stderr.resume();
    child.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const event of decoder.push(chunk)) {
          if (event.type === 'ready') this.ready = true;
          if (event.type === 'connected') {
            this.connected.set(event.device, event);
            if (!this.held.has(event.device)) this.held.set(event.device, new Set());
          }
          if (event.type === 'disconnected') { this.connected.delete(event.device); this.held.delete(event.device); }
          if (event.type === 'button') {
            const held = this.held.get(event.device);
            if (!held || held.has(event.button) === event.down) continue;
            if (event.down) held.add(event.button); else held.delete(event.button);
          }
          this.events.emit('change', event);
        }
      } catch (error) { fail(error as Error); child.kill('SIGTERM'); }
    });
    this.closed = new Promise(resolve => child.on('close', () => {
      if (!this.closing) fail(new Error('Controller input helper exited during setup.'));
      resolve();
    }));
    await this.wait(() => this.ready ? true : undefined, signal, 5000, 'Input engine did not become ready.');
  }
  snapshot(): InputDevice[] { return [...this.connected.values()]; }
  subscribe(listener: (event: Event | undefined, error?: Error) => void): () => void {
    const changed = (event?: Event) => listener(event, this.failure);
    this.events.on('change', changed);
    return () => this.events.removeListener('change', changed);
  }
  private async wait<T>(check: (event?: Event) => T | undefined, signal: AbortSignal, timeout: number, message: string): Promise<T> {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    const initial = check();
    if (initial !== undefined) return initial;
    return await new Promise<T>((resolve, reject) => {
      const finish = (error?: Error, result?: T) => {
        clearTimeout(timer); this.events.removeListener('change', changed); signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result!);
      };
      const changed = (event?: Event) => {
        if (this.failure) { finish(this.failure); return; }
        try {
          const result = check(event);
          if (result !== undefined) finish(undefined, result);
        } catch (error) { finish(error as Error); }
      };
      const abort = () => finish(new Error('Operation cancelled.'));
      const timer = setTimeout(() => finish(new Error(message)), timeout);
      this.events.on('change', changed); signal.addEventListener('abort', abort, { once: true });
    });
  }
  async devices(signal: AbortSignal): Promise<InputDevice[]> {
    // Allow initial enumeration after ready; a real missing device is a bounded timeout.
    await this.wait(() => this.connected.size ? true : undefined, signal, 10000, 'No controller input device appeared. Pairing alone is not an input check.');
    return [...this.connected.values()];
  }
  async press(device: number, signal: AbortSignal): Promise<string> {
    if (!this.connected.has(device)) throw new Error('Selected controller disconnected.');
    return await this.wait(event => {
      if (!this.connected.has(device)) throw new Error('Selected controller disconnected.');
      return event?.type === 'button' && event.device === device && event.down ? event.button : undefined;
    }, signal, 20000, 'No fresh button press from the selected controller within 20 seconds.');
  }
  async stop(): Promise<void> {
    this.closing = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 500);
    try { await this.closed; } finally { clearTimeout(timer); }
  }
}
