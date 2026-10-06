import { EventEmitter } from 'node:events';
import { ControllerProbe, identityMatch, type InputDevice } from './probe.js';
import type { MenuFeed } from './menu-controller.js';
import type { Config } from './config.js';
import type { Button, Event } from './protocol.js';

export const terminalKeys: Partial<Record<Button, string>> = {
  dpad_up: '\x1b[A', dpad_down: '\x1b[B', dpad_right: '\x1b[C', dpad_left: '\x1b[D',
  south: '\r', east: '\x1b', left_shoulder: '\t', right_shoulder: '\x1b[Z',
};
export interface AgentGamepadOptions {
  factory?: () => MenuFeed;
  now?: () => number;
  feedStarted?: boolean;
  automaticHandoff?: boolean;
  trace?: (event: string, generation: number, device?: number) => void;
}
export interface ControllerSource {
  subscribe(keys: (bytes: Buffer) => void, status: (text: string) => void, cancel: () => void): () => void;
  start(signal: AbortSignal): Promise<void>;
  suspend(status?: string): void;
  stop(): Promise<void>;
}
export class AgentGamepad implements ControllerSource {
  private events = new EventEmitter();
  private feed: MenuFeed | undefined;
  private release: (() => void) | undefined;
  private devices = new Map<number, InputDevice>();
  private held = new Map<number, Set<Button>>();
  private optionPresses = new Set<number>();
  private settling = new Map<number, number>();
  private selected: number | undefined;
  private active = false;
  private failed = false;
  private generation = 0;
  private automaticAvailable = false;
  private holding = false;
  private resumeActive = false;
  private rearming = false;
  private lastStatus = '';
  private armTimer: NodeJS.Timeout | undefined;
  private factory: () => MenuFeed;
  private now: () => number;
  constructor(private target: Config['controller'], private settings: AgentGamepadOptions = {}) {
    this.factory = settings.factory ?? (() => new ControllerProbe());
    this.now = settings.now ?? Date.now;
  }
  private trace(event: string, device?: number): void { this.settings.trace?.(event, this.generation, device); }
  private status(text: string): void { this.lastStatus = text; this.events.emit('status', text); }
  subscribe(keys: (bytes: Buffer) => void, status: (text: string) => void, cancel: () => void): () => void {
    this.events.on('keys', keys); this.events.on('status', status); this.events.on('cancel', cancel);
    return () => { this.events.removeListener('keys', keys); this.events.removeListener('status', status); this.events.removeListener('cancel', cancel); };
  }
  suspend(status = 'PAUSED / Options to enable'): void {
    this.active = false; this.optionPresses.clear(); clearTimeout(this.armTimer); this.armTimer = undefined;
    this.events.emit('cancel'); this.status(status); this.trace('paused');
  }
  // History views own the screen: consume controller input until they close, then re-arm after release.
  hold(status = 'HISTORY / Wheel or q returns; gamepad held'): void {
    if (this.holding || this.failed) return;
    this.holding = true; this.resumeActive = this.active || this.rearming || (this.automaticAvailable && this.selected !== undefined);
    this.active = false; this.rearming = false;
    clearTimeout(this.armTimer); this.armTimer = undefined; this.optionPresses.clear();
    this.events.emit('cancel'); this.events.emit('status', status); this.trace('held');
  }
  resume(): void {
    if (!this.holding) return;
    this.holding = false;
    const device = this.selected;
    if (this.failed || !this.resumeActive || device === undefined) { this.resumeActive = false; this.events.emit('status', this.lastStatus); return; }
    this.resumeActive = false; this.rearming = true;
    this.settling.set(device, this.now() + 250);
    this.status('ARMING / Release buttons'); this.trace('rearm-barrier', device);
    this.scheduleArm(device);
  }
  async start(signal: AbortSignal): Promise<void> {
    this.generation++;
    const feed = this.factory(); this.feed = feed;
    this.automaticAvailable = Boolean(this.settings.automaticHandoff);
    this.suspend();
    try {
      if (!this.settings.feedStarted) await feed.start(signal);
      signal.throwIfAborted();
      for (const device of feed.snapshot()) this.connected(device);
      const generation = this.generation;
      this.release = feed.subscribe((event, error) => {
        if (generation !== this.generation) { this.trace('stale-event-discarded'); return; }
        this.receive(event, error);
      });
      this.prepareAutomaticHandoff();
      this.trace(this.settings.feedStarted ? 'feed-adopted' : 'feed-started');
    } catch {
      this.failed = true; this.suspend('UNAVAILABLE / Keyboard available');
    }
  }
  private connected(device: InputDevice): void {
    if (this.selected === device.device) { this.selected = undefined; this.suspend('RECONNECTED / Options to enable'); }
    this.devices.set(device.device, device);
    this.held.set(device.device, new Set()); this.optionPresses.delete(device.device);
    this.settling.set(device.device, this.now() + 250);
  }
  private prepareAutomaticHandoff(): void {
    if (!this.automaticAvailable || this.selected !== undefined || !this.target.address) return;
    const matches = [...this.devices.values()].filter(device => identityMatch(device, this.target.transport, this.target.address) === 'match');
    if (matches.length !== 1) return;
    this.selected = matches[0]!.device;
    this.status('ARMING / Release buttons'); this.trace('neutral-barrier', this.selected);
    this.scheduleArm(this.selected);
  }
  private scheduleArm(device: number): void {
    clearTimeout(this.armTimer);
    const wait = Math.max(0, (this.settling.get(device) ?? this.now() + 250) - this.now());
    this.armTimer = setTimeout(() => {
      this.armTimer = undefined;
      if (this.failed || this.holding || this.selected !== device || !(this.automaticAvailable || this.rearming)) return;
      const held = this.held.get(device);
      if (!held || held.size) return;
      const remaining = (this.settling.get(device) ?? 0) - this.now();
      if (remaining > 0) { this.scheduleArm(device); return; }
      this.automaticAvailable = false; this.rearming = false; this.active = true;
      this.status('ACTIVE / Options to pause'); this.trace('active', device);
    }, wait);
  }
  private receive(event?: Event, error?: Error): void {
    if (error) { this.failed = true; this.suspend('INPUT LOST / Keyboard available'); return; }
    if (!event || this.failed) return;
    if (event.type === 'connected') { this.connected(event); this.prepareAutomaticHandoff(); return; }
    if (event.type === 'disconnected') {
      this.devices.delete(event.device); this.held.delete(event.device); this.optionPresses.delete(event.device); this.settling.delete(event.device);
      if (this.selected === event.device) { this.selected = undefined; this.automaticAvailable = false; this.rearming = false; this.resumeActive = false; this.suspend('DISCONNECTED / Reconnect then Options'); }
      return;
    }
    if (event.type !== 'button') return;
    const device = this.devices.get(event.device), held = this.held.get(event.device);
    if (!device || !held || identityMatch(device, this.target.transport, this.target.address) === 'mismatch') return;
    if (event.down === held.has(event.button)) return;
    if (event.down) held.add(event.button); else held.delete(event.button);
    if (this.selected !== undefined && this.selected !== event.device) return;
    if (this.holding) { this.trace('held-event-consumed', event.device); return; }
    if ((this.automaticAvailable || this.rearming) && this.selected === event.device) {
      this.settling.set(event.device, this.now() + 250); this.scheduleArm(event.device);
      this.trace('barrier-event-consumed', event.device); return;
    }
    if (this.now() < (this.settling.get(event.device) ?? Infinity)) return;
    if (event.button === 'start') {
      if (event.down) this.optionPresses.add(event.device);
      else if (this.optionPresses.delete(event.device)) {
        this.selected = event.device;
        if (this.active) this.suspend();
        else { this.active = true; this.status('ACTIVE / Options to pause'); this.trace('active', event.device); }
      }
      return;
    }
    const key = terminalKeys[event.button];
    if (this.active && event.down && key) this.events.emit('keys', Buffer.from(key));
  }
  async stop(): Promise<void> {
    this.generation++; this.failed = true; this.active = false; clearTimeout(this.armTimer); this.armTimer = undefined; this.events.emit('cancel');
    this.release?.(); this.release = undefined;
    const feed = this.feed; this.feed = undefined;
    if (feed) await feed.stop();
    this.devices.clear(); this.held.clear(); this.optionPresses.clear(); this.settling.clear(); this.selected = undefined; this.automaticAvailable = false;
    this.holding = false; this.resumeActive = false; this.rearming = false;
    this.trace('stopped');
  }
}
