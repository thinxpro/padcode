import { basename } from 'node:path';
import type { Axis, Button } from './protocol.js';

// Sticks and editing buttons for text input. Directions use hysteresis and a dominant-axis lock;
// held controls repeat, faster with more tilt. Nothing here can produce Enter.
export type EditAction = 'left' | 'right' | 'up' | 'down' | 'word-left' | 'word-right' | 'home' | 'end'
  | 'backspace' | 'delete-word' | 'delete' | ProfileAction;
// R2 and R3 send Agent-specific keys; every other action is the same for all Agents.
export type ProfileAction = 'r2' | 'r3';
export const editKeys: Record<Exclude<EditAction, ProfileAction>, string> = {
  left: '\x1b[D', right: '\x1b[C', up: '\x1b[A', down: '\x1b[B',
  'word-left': '\x1b[1;5D', 'word-right': '\x1b[1;5C', home: '\x1b[H', end: '\x1b[F',
  backspace: '\x7f', 'delete-word': '\x17', delete: '\x1b[3~',
};
export type AgentProfile = 'basic' | 'claude' | 'codex';
export const agentProfiles: readonly AgentProfile[] = ['basic', 'claude', 'codex'];
// Ctrl+J acts as Enter in many programs, so R2/R3 stay unbound unless the Agent's default keymap is known.
export const profileKeys: Record<AgentProfile, Partial<Record<ProfileAction, string>>> = {
  basic: {},
  // Claude Code 2.1.292: chat:newline (Ctrl+J) and chat:undo (Ctrl+_).
  claude: { r2: '\n', r3: '\x1f' },
  // Codex 0.161.0: editor.insert_newline (Ctrl+J); app.open_transcript and pager.close_transcript (Ctrl+T) toggle the transcript.
  codex: { r2: '\n', r3: '\x14' },
};
// The profile follows the executable name; wrappers and other Agents get only the universal keys.
export function agentProfile(command: string): AgentProfile {
  const name = basename(command);
  return name === 'claude' || name === 'codex' ? name : 'basic';
}
export const activateAt = 0.5, releaseBelow = 0.3;
interface Repeat { delay: number; slow: number; fast: number }
const cursorRepeat: Repeat = { delay: 350, slow: 160, fast: 45 };
const wordRepeat: Repeat = { delay: 350, slow: 250, fast: 110 };
const lineEndRepeat: Repeat = { delay: 400, slow: 400, fast: 400 };
const buttonRepeat: Repeat = { delay: 400, slow: 70, fast: 70 };
type Direction = 'left' | 'right' | 'up' | 'down';
interface Stick { x: number; y: number; direction: Direction | undefined; blocked: boolean }
export interface Timers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle as NodeJS.Timeout) };

export class StickInput {
  private sticks: Record<'left' | 'right', Stick> = { left: { x: 0, y: 0, direction: undefined, blocked: false }, right: { x: 0, y: 0, direction: undefined, blocked: false } };
  private repeats = new Map<string, unknown>();
  private trigger = false;
  private triggerLevel = 0;
  private triggerBlocked = false;
  constructor(private fire: (action: EditAction) => void, private timers: Timers = realTimers) {}
  axis(axis: Axis, value: number): void {
    const normalized = Math.max(-1, Math.min(1, value / 32767));
    if (axis === 'right_trigger') {
      const level = Math.max(0, normalized);
      this.triggerLevel = level;
      if (this.triggerBlocked) { if (level < 0.35) this.triggerBlocked = false; return; }
      if (!this.trigger && level >= 0.65) { this.trigger = true; this.fire('r2'); }
      else if (this.trigger && level < 0.35) this.trigger = false;
      return;
    }
    const side = axis === 'leftx' || axis === 'lefty' ? 'left' : axis === 'rightx' || axis === 'righty' ? 'right' : undefined;
    if (!side) return;
    const stick = this.sticks[side];
    if (axis.endsWith('x')) stick.x = normalized; else stick.y = normalized;
    this.update(side);
  }
  private update(side: 'left' | 'right'): void {
    const stick = this.sticks[side];
    const ax = Math.abs(stick.x), ay = Math.abs(stick.y);
    if (stick.blocked) { if (Math.max(ax, ay) < releaseBelow) stick.blocked = false; return; }
    if (stick.direction) {
      const along = stick.direction === 'left' || stick.direction === 'right' ? ax : ay;
      if (along < releaseBelow) { stick.direction = undefined; this.cancel(side); }
      return;
    }
    if (Math.max(ax, ay) < activateAt) return;
    stick.direction = ax >= ay ? (stick.x < 0 ? 'left' : 'right') : (stick.y < 0 ? 'up' : 'down');
    const action = this.stickAction(side, stick.direction);
    const repeat = side === 'left' ? cursorRepeat : stick.direction === 'up' || stick.direction === 'down' ? lineEndRepeat : wordRepeat;
    this.start(side, action, repeat, () => {
      const current = this.sticks[side];
      return current.direction === 'left' || current.direction === 'right' ? Math.abs(current.x) : Math.abs(current.y);
    });
  }
  private stickAction(side: 'left' | 'right', direction: Direction): EditAction {
    if (side === 'left') return direction;
    return direction === 'left' ? 'word-left' : direction === 'right' ? 'word-right' : direction === 'up' ? 'home' : 'end';
  }
  // Square and Triangle repeat while held; L3 and R3 act once per press. Returns true when handled.
  button(button: Button, down: boolean): boolean {
    const held: Partial<Record<Button, EditAction>> = { west: 'backspace', north: 'delete-word' };
    const once: Partial<Record<Button, EditAction>> = { left_stick: 'delete', right_stick: 'r3' };
    const repeated = held[button];
    if (repeated) { if (down) this.start(button, repeated, buttonRepeat, () => 1); else this.cancel(button); return true; }
    const single = once[button];
    if (single) { if (down) this.fire(single); return true; }
    return false;
  }
  private start(key: string, action: EditAction, repeat: Repeat, tilt: () => number): void {
    this.cancel(key);
    this.fire(action);
    const tick = (wait: number) => this.repeats.set(key, this.timers.set(() => {
      if (!this.repeats.has(key)) return;
      this.fire(action);
      const share = Math.max(0, Math.min(1, (tilt() - activateAt) / (1 - activateAt)));
      tick(Math.round(repeat.slow - (repeat.slow - repeat.fast) * share));
    }, wait));
    tick(repeat.delay);
  }
  private cancel(key: string): void {
    const handle = this.repeats.get(key);
    if (handle !== undefined) { this.timers.clear(handle); this.repeats.delete(key); }
  }
  // Context changes, pauses and disconnects stop everything; a stick held through them must centre first.
  stop(): void {
    for (const key of [...this.repeats.keys()]) this.cancel(key);
    for (const stick of Object.values(this.sticks)) { stick.blocked = stick.direction !== undefined || Math.max(Math.abs(stick.x), Math.abs(stick.y)) >= releaseBelow; stick.direction = undefined; }
    this.triggerBlocked = this.trigger || this.triggerLevel >= 0.35; this.trigger = false;
  }
}
