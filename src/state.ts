import { axes, type Axis, type Button, type Event } from './protocol.js';
import type { Family } from './glyphs.js';
export interface Device { id: number; name: string; buttons: Set<Button>; axes: Record<Axis, number>; family?: Family }
export interface State { devices: Map<number, Device>; selected: number | null; history: string[]; transitions: number; source: string; ready: boolean; back?: 'hold' | 'release' | 'press' }
export function createState(): State { return { devices: new Map(), selected: null, history: [], transitions: 0, source: 'hardware', ready: false }; }
export function deadzone(value: number, trigger = false): number {
  const normalized = trigger ? Math.max(0, value) / 32767 : value / (value < 0 ? 32768 : 32767);
  const threshold = trigger ? 0.04 : 0.12;
  return Math.abs(normalized) <= threshold ? 0 : Math.sign(normalized) * (Math.abs(normalized) - threshold) / (1 - threshold);
}
function record(state: State, text: string): void { state.history.unshift(text); state.history.length = Math.min(state.history.length, 6); }
export function reduce(state: State, event: Event): void {
  if (event.type === 'ready') { state.ready = true; state.source = event.source; return; }
  if (event.type === 'connected') {
    if (state.devices.has(event.device)) return;
    state.devices.set(event.device, { id: event.device, name: event.name, buttons: new Set(), axes: Object.fromEntries(axes.map(a => [a, 0])) as Record<Axis, number>, ...(event.family ? { family: event.family } : {}) });
    state.selected ??= event.device;
    record(state, `+ PLAYER ${event.device} CONNECTED`); return;
  }
  const device = state.devices.get(event.device);
  if (!device) return;
  if (event.type === 'disconnected') {
    device.buttons.clear(); for (const axis of axes) device.axes[axis] = 0;
    state.devices.delete(event.device);
    if (state.selected === event.device) state.selected = state.devices.keys().next().value ?? null;
    record(state, `- PLAYER ${event.device} DISCONNECTED`); return;
  }
  if (event.type === 'axis') { device.axes[event.axis] = deadzone(event.value, event.axis.endsWith('trigger')); return; }
  if (device.buttons.has(event.button) === event.down) return;
  if (event.down) device.buttons.add(event.button); else device.buttons.delete(event.button);
  state.transitions++;
  record(state, `${event.down ? 'DOWN' : 'UP  '} ${event.button.toUpperCase()} [${event.device}]`);
}
