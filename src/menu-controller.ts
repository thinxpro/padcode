import { EventEmitter } from 'node:events';
import { ControllerProbe, identityMatch, type InputDevice, type ProbePort } from './probe.js';
import type { Event } from './protocol.js';
import type { Config } from './config.js';

export type MenuAction = 'up' | 'down' | 'confirm' | 'cancel';
export interface MenuInput {
  readonly statusText?: string;
  subscribeAction(listener: (action: MenuAction) => void): () => void;
  subscribeStatus(listener: (status: string) => void): () => void;
}
export interface MenuFeed extends ProbePort {
  snapshot(): InputDevice[];
  subscribe(listener: (event: Event | undefined, error?: Error) => void): () => void;
}
export class GamepadMenus implements MenuInput {
  statusText = 'GAMEPAD OFFLINE / Connect a controller; keyboard remains available.';
  private events = new EventEmitter();
  private feed: MenuFeed | undefined;
  private release: (() => void) | undefined;
  private selected: number | undefined;
  private devices = new Map<number, InputDevice>();
  private target: Config['controller'] | undefined;
  private failed = false;
  private automatic = false;
  private settledAt = 0;
  constructor(private factory: () => MenuFeed = () => new ControllerProbe()) {}
  subscribeAction(listener: (action: MenuAction) => void): () => void {
    this.events.on('action', listener); return () => this.events.removeListener('action', listener);
  }
  subscribeStatus(listener: (status: string) => void): () => void {
    this.events.on('status', listener); return () => this.events.removeListener('status', listener);
  }
  private status(text: string): void { this.statusText = text; this.events.emit('status', text); }
  private compatible(device: InputDevice): boolean {
    return Boolean(this.target && identityMatch(device, this.target.transport, this.target.address) !== 'mismatch');
  }
  async activate(target: Config['controller'], signal: AbortSignal, automatic = false): Promise<void> {
    await this.stop();
    this.target = target; this.failed = false; this.automatic = automatic; this.settledAt = Date.now() + 250;
    const feed = this.factory(); this.feed = feed;
    try {
      await feed.start(signal);
      this.settledAt = Date.now() + 250;
      this.devices = new Map(feed.snapshot().map(device => [device.device, device]));
      this.release = feed.subscribe((event, error) => this.receive(event, error));
      this.selectConfigured();
      if (this.selected === undefined) this.status('GAMEPAD MENUS / D-pad to navigate, or X to claim. O back/cancel. Keyboard available.');
    } catch (error) {
      await this.stop();
      signal.throwIfAborted();
      this.status(`GAMEPAD UNAVAILABLE / ${(error as Error).message} Use the keyboard to continue.`);
    }
  }
  private selectConfigured(): void {
    if (!this.automatic || !this.target?.address || this.selected !== undefined) return;
    const matches = [...this.devices.values()].filter(device => identityMatch(device, this.target!.transport, this.target!.address) === 'match');
    if (matches.length === 1) { this.selected = matches[0]!.device; this.status('GAMEPAD READY / D-pad up/down, X confirm, O back/cancel.'); }
  }
  private receive(event?: Event, error?: Error): void {
    if (error) {
      this.failed = true; this.selected = undefined; this.devices.clear();
      this.status('GAMEPAD INPUT LOST / Use the keyboard to continue or restart setup.'); return;
    }
    if (!event || this.failed) return;
    if (event.type === 'connected') { this.settledAt = Date.now() + 250; this.devices.set(event.device, event); this.selectConfigured(); }
    if (event.type === 'disconnected') {
      this.devices.delete(event.device);
      if (this.selected === event.device) {
        this.selected = undefined;
        this.status('GAMEPAD DISCONNECTED / Keyboard remains available. Reconnect and press X to take control again.');
      }
      return;
    }
    if (event.type !== 'button' || !event.down || (this.automatic && Date.now() < this.settledAt)) return;
    const device = this.devices.get(event.device);
    if (!device || !this.compatible(device)) return;
    if (this.selected === undefined) {
      if (!['south', 'dpad_up', 'dpad_down'].includes(event.button)) return;
      this.selected = device.device;
      this.status('GAMEPAD READY / D-pad up/down, X confirm, O back/cancel.');
      // The claiming press never selects a menu item.
      if (event.button === 'south') return;
    }
    if (this.selected !== event.device) return;
    const action: MenuAction | undefined = ({ dpad_up: 'up', dpad_down: 'down', south: 'confirm', east: 'cancel' } as Record<string, MenuAction>)[event.button];
    if (action) this.events.emit('action', action);
  }
  probe(): ProbePort {
    const feed = this.feed;
    if (!feed || this.failed) return new ControllerProbe();
    return { start: async signal => signal.throwIfAborted(), devices: signal => feed.devices(signal), press: (device, signal) => feed.press(device, signal), stop: async () => {} };
  }
  handoff(): MenuFeed | undefined {
    const feed = this.feed;
    if (!feed || this.failed) return undefined;
    this.release?.(); this.release = undefined;
    this.feed = undefined; this.selected = undefined; this.devices.clear();
    return feed;
  }
  async stop(): Promise<void> {
    this.release?.(); this.release = undefined;
    const feed = this.feed; this.feed = undefined;
    this.selected = undefined; this.devices.clear();
    if (feed) await feed.stop();
  }
}
