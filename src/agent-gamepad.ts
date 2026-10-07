import { EventEmitter } from 'node:events';
import { ControllerProbe, identityMatch, type InputDevice } from './probe.js';
import type { MenuFeed } from './menu-controller.js';
import type { Config } from './config.js';
import type { Button, Event } from './protocol.js';

export const terminalKeys: Partial<Record<Button, string>> = {
  dpad_up: '\x1b[A', dpad_down: '\x1b[B', dpad_right: '\x1b[C', dpad_left: '\x1b[D',
  south: '\r', east: '\x1b', left_shoulder: '\t', right_shoulder: '\x1b[Z',
};
export class AgentGamepad {
  private events = new EventEmitter();
  private feed: MenuFeed | undefined;
  private release: (() => void) | undefined;
  private devices = new Map<number, InputDevice>();
  private held = new Map<number, Set<Button>>();
  private options = new Set<number>();
  private settling = new Map<number, number>();
  private selected: number | undefined;
  private active = false;
  private failed = false;
  constructor(private target: Config['controller'], private factory: () => MenuFeed = () => new ControllerProbe(), private now: () => number = Date.now) {}
  subscribe(keys: (bytes: Buffer) => void, status: (text: string) => void, cancel: () => void): () => void {
    this.events.on('keys', keys); this.events.on('status', status); this.events.on('cancel', cancel);
    return () => { this.events.removeListener('keys', keys); this.events.removeListener('status', status); this.events.removeListener('cancel', cancel); };
  }
  suspend(status = 'PAUSED / Options to enable'): void {
    this.active = false; this.options.clear(); this.events.emit('cancel'); this.events.emit('status', status);
  }
  async start(signal: AbortSignal): Promise<void> {
    const feed = this.factory(); this.feed = feed;
    this.suspend();
    try {
      await feed.start(signal); signal.throwIfAborted();
      for (const device of feed.snapshot()) this.connected(device);
      this.release = feed.subscribe((event, error) => this.receive(event, error));
    } catch {
      this.failed = true; this.suspend('UNAVAILABLE / Keyboard available');
    }
  }
  private connected(device: InputDevice): void {
    if (this.selected === device.device) { this.selected = undefined; this.suspend('RECONNECTED / Options to enable'); }
    this.devices.set(device.device, device);
    this.held.set(device.device, new Set()); this.options.delete(device.device);
    this.settling.set(device.device, this.now() + 250);
  }
  private receive(event?: Event, error?: Error): void {
    if (error) { this.failed = true; this.suspend('INPUT LOST / Keyboard available'); return; }
    if (!event || this.failed) return;
    if (event.type === 'connected') { this.connected(event); return; }
    if (event.type === 'disconnected') {
      this.devices.delete(event.device); this.held.delete(event.device); this.options.delete(event.device); this.settling.delete(event.device);
      if (this.selected === event.device) { this.selected = undefined; this.suspend('DISCONNECTED / Reconnect then Options'); }
      return;
    }
    if (event.type !== 'button') return;
    const device = this.devices.get(event.device), held = this.held.get(event.device);
    if (!device || !held || identityMatch(device, this.target.transport, this.target.address) === 'mismatch') return;
    if (event.down === held.has(event.button)) return;
    if (event.down) held.add(event.button); else held.delete(event.button);
    if (this.now() < (this.settling.get(event.device) ?? Infinity)) return;
    if (this.selected !== undefined && this.selected !== event.device) return;
    if (event.button === 'start') {
      if (event.down) this.options.add(event.device);
      else if (this.options.delete(event.device)) {
        this.selected = event.device;
        if (this.active) this.suspend();
        else { this.active = true; this.events.emit('status', 'ACTIVE / Options to pause'); }
      }
      return;
    }
    const key = terminalKeys[event.button];
    if (this.active && event.down && key) this.events.emit('keys', Buffer.from(key));
  }
  async stop(): Promise<void> {
    this.failed = true; this.active = false; this.events.emit('cancel');
    this.release?.(); this.release = undefined;
    const feed = this.feed; this.feed = undefined;
    if (feed) await feed.stop();
    this.devices.clear(); this.held.clear(); this.options.clear(); this.settling.clear(); this.selected = undefined;
  }
}
