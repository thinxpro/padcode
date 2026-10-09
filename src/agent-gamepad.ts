import { EventEmitter } from 'node:events';
import { ControllerProbe, identityMatch, type InputDevice } from './probe.js';
import type { MenuFeed } from './menu-controller.js';
import type { Config } from './config.js';
import type { Button, Event } from './protocol.js';
import { editKeys, profileKeys, StickInput, type AgentProfile, type EditAction } from './stick-input.js';
import { formatGlyphs, type Glyphs } from './glyphs.js';

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
  // Selects the Agent-specific R2/R3 keys; 'basic' (the default) leaves them unbound.
  editing?: AgentProfile;
}
export type ControlEvent = 'menu' | 'lost';
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
  private capturing: ((button: Button) => void) | undefined;
  private menu = false;
  private resumeActive = false;
  private rearming = false;
  private lastStatus = '';
  private armTimer: NodeJS.Timeout | undefined;
  private factory: () => MenuFeed;
  private now: () => number;
  private stick = new StickInput(action => this.edit(action));
  constructor(private target: Config['controller'], private settings: AgentGamepadOptions = {}) {
    this.factory = settings.factory ?? (() => new ControllerProbe());
    this.now = settings.now ?? Date.now;
  }
  get profile(): AgentProfile { return this.settings.editing ?? 'basic'; }
  private trace(event: string, device?: number): void { this.settings.trace?.(event, this.generation, device); }
  // Names for the controller in use: its reported family, else the saved one, else a standard gamepad.
  glyphs(): Glyphs {
    const device = this.selected === undefined ? undefined : this.devices.get(this.selected);
    return { family: device?.family ?? this.target.family ?? 'standard', swap: this.target.confirm === 'east' };
  }
  private say(text: string): string { return formatGlyphs(text, this.glyphs()); }
  private status(text: string): void { this.lastStatus = this.say(text); this.events.emit('status', this.lastStatus); }
  // Sticks drive the Agent's cursor; inside Padcode contexts they act as the D-pad and history paging.
  private edit(action: EditAction): void {
    if (this.capturing) {
      const synthetic = ({ up: 'dpad_up', down: 'dpad_down', left: 'dpad_left', right: 'dpad_right', home: 'left_shoulder', end: 'right_shoulder' } as Partial<Record<EditAction, Button>>)[action];
      if (synthetic) this.capturing(synthetic);
      return;
    }
    if (!this.active || this.failed) return;
    const bytes = action === 'r2' || action === 'r3' ? profileKeys[this.profile][action] : editKeys[action];
    if (bytes) this.events.emit('keys', Buffer.from(bytes));
  }
  subscribe(keys: (bytes: Buffer) => void, status: (text: string) => void, cancel: () => void): () => void {
    this.events.on('keys', keys); this.events.on('status', status); this.events.on('cancel', cancel);
    return () => { this.events.removeListener('keys', keys); this.events.removeListener('status', status); this.events.removeListener('cancel', cancel); };
  }
  onControl(listener: (event: ControlEvent) => void): () => void {
    this.events.on('control', listener); return () => this.events.removeListener('control', listener);
  }
  onTrigger(listener: (value: number) => void): () => void {
    this.events.on('trigger', listener); return () => this.events.removeListener('trigger', listener);
  }
  // True only while presses route to the Agent: not paused, arming or inside a Padcode context.
  get routing(): boolean { return this.active && !this.capturing && !this.failed; }
  // With an isolated controls surface, Options opens the session menu instead of toggling pause.
  enableMenu(): void { this.menu = true; }
  private activeStatus(): string { return this.menu ? 'ACTIVE / {menu} menu' : 'ACTIVE / {menu} to pause'; }
  suspend(status = 'PAUSED / {menu} to enable'): void {
    this.stick.stop();
    this.active = false; this.rearming = false; this.optionPresses.clear(); clearTimeout(this.armTimer); this.armTimer = undefined;
    this.events.emit('cancel'); this.status(status); this.trace('paused');
  }
  // Padcode contexts (menu, history) own controller presses until they close, then re-arm after release.
  capture(handler: (button: Button) => void, status: string): void {
    if (this.failed) return;
    if (!this.capturing) {
      this.stick.stop();
      this.resumeActive = this.active || this.rearming || (this.automaticAvailable && this.selected !== undefined);
      this.active = false; this.rearming = false;
      clearTimeout(this.armTimer); this.armTimer = undefined; this.optionPresses.clear();
      this.events.emit('cancel');
    }
    this.capturing = handler; this.events.emit('status', this.say(status)); this.trace('captured');
  }
  releaseCapture(resume = true): void {
    if (!this.capturing) return;
    this.capturing = undefined; this.stick.stop();
    const device = this.selected;
    if (!resume) { this.resumeActive = false; this.suspend(); return; }
    if (this.failed || !this.resumeActive || device === undefined) { this.resumeActive = false; this.events.emit('status', this.lastStatus); return; }
    this.resumeActive = false; this.rearming = true;
    this.settling.set(device, this.now() + 250);
    this.status('ARMING / Release buttons'); this.trace('rearm-barrier', device);
    this.scheduleArm(device);
  }
  hold(status = 'HISTORY / Wheel or q returns; gamepad held'): void { if (!this.capturing) this.capture(() => {}, status); }
  resume(): void { this.releaseCapture(); }
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
    if (this.selected === device.device) { this.selected = undefined; this.suspend('RECONNECTED / {menu} to enable'); }
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
      if (this.failed || this.capturing || this.selected !== device || !(this.automaticAvailable || this.rearming)) return;
      const held = this.held.get(device);
      if (!held || held.size) return;
      const remaining = (this.settling.get(device) ?? 0) - this.now();
      if (remaining > 0) { this.scheduleArm(device); return; }
      this.automaticAvailable = false; this.rearming = false; this.active = true;
      this.status(this.activeStatus()); this.trace('active', device);
    }, wait);
  }
  private receive(event?: Event, error?: Error): void {
    if (error) { this.failed = true; this.suspend('INPUT LOST / Keyboard available'); if (this.capturing) this.events.emit('control', 'lost'); return; }
    if (!event || this.failed) return;
    if (event.type === 'connected') { this.connected(event); this.prepareAutomaticHandoff(); return; }
    if (event.type === 'disconnected') {
      this.devices.delete(event.device); this.held.delete(event.device); this.optionPresses.delete(event.device); this.settling.delete(event.device);
      if (this.selected === event.device) { this.selected = undefined; this.automaticAvailable = false; this.rearming = false; this.resumeActive = false; this.suspend('DISCONNECTED / Reconnect then {menu}'); if (this.capturing) this.events.emit('control', 'lost'); }
      return;
    }
    if (event.type === 'axis') {
      // L2 drives push-to-talk; only the selected controller's trigger is reported, as a 0..1 value.
      if (event.device !== this.selected || this.failed) return;
      if (event.axis === 'left_trigger') this.events.emit('trigger', Math.max(0, event.value) / 32767);
      else this.stick.axis(event.axis, event.value);
      return;
    }
    if (event.type !== 'button') return;
    // Nintendo-style confirm: swap east and south once, here, so every later rule stays positional.
    if (this.target.confirm === 'east' && (event.button === 'south' || event.button === 'east')) event = { ...event, button: event.button === 'south' ? 'east' : 'south' };
    const device = this.devices.get(event.device), held = this.held.get(event.device);
    if (!device || !held || identityMatch(device, this.target.transport, this.target.address) === 'mismatch') return;
    if (event.down === held.has(event.button)) return;
    if (event.down) held.add(event.button); else held.delete(event.button);
    if (this.selected !== undefined && this.selected !== event.device) return;
    if (this.capturing) {
      if (event.down && this.selected === event.device) this.capturing(event.button);
      this.trace('captured-event', event.device); return;
    }
    if ((this.automaticAvailable || this.rearming) && this.selected === event.device) {
      this.settling.set(event.device, this.now() + 250); this.scheduleArm(event.device);
      this.trace('barrier-event-consumed', event.device); return;
    }
    if (this.now() < (this.settling.get(event.device) ?? Infinity)) return;
    if (event.button === 'start') {
      if (event.down) this.optionPresses.add(event.device);
      else if (this.optionPresses.delete(event.device)) {
        this.selected = event.device;
        if (this.active && this.menu) { this.events.emit('control', 'menu'); this.trace('menu', event.device); }
        else if (this.active) this.suspend();
        else { this.active = true; this.status(this.activeStatus()); this.trace('active', event.device); }
      }
      return;
    }
    if (this.active && this.stick.button(event.button, event.down)) return;
    const key = terminalKeys[event.button];
    if (this.active && event.down && key) this.events.emit('keys', Buffer.from(key));
  }
  async stop(): Promise<void> {
    this.stick.stop();
    this.generation++; this.failed = true; this.active = false; clearTimeout(this.armTimer); this.armTimer = undefined; this.events.emit('cancel');
    this.release?.(); this.release = undefined;
    const feed = this.feed; this.feed = undefined;
    if (feed) await feed.stop();
    this.devices.clear(); this.held.clear(); this.optionPresses.clear(); this.settling.clear(); this.selected = undefined; this.automaticAvailable = false;
    this.capturing = undefined; this.resumeActive = false; this.rearming = false;
    this.trace('stopped');
  }
}
