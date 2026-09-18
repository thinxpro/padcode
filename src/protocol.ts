export const buttons = ['south', 'east', 'west', 'north', 'back', 'guide', 'start', 'left_stick', 'right_stick', 'left_shoulder', 'right_shoulder', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'misc1', 'right_paddle1', 'left_paddle1', 'right_paddle2', 'left_paddle2', 'touchpad', 'misc2', 'misc3', 'misc4', 'misc5', 'misc6'] as const;
export const axes = ['leftx', 'lefty', 'rightx', 'righty', 'left_trigger', 'right_trigger'] as const;
export type Button = typeof buttons[number];
export type Axis = typeof axes[number];
type Base = { v: 1; seq: number; time: number };
export type Event = Base & (
  { type: 'ready'; source: 'hardware' | 'virtual'; sdl: string } |
  { type: 'connected'; device: number; name: string; connection?: 'wired' | 'wireless' | 'unknown'; serial?: string } |
  { type: 'disconnected'; device: number } |
  { type: 'button'; device: number; button: Button; down: boolean } |
  { type: 'axis'; device: number; axis: Axis; value: number }
);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function invalid(): never { throw new Error('Invalid controller event schema.'); }
export function parseEvent(line: string): Event {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line) as Record<string, unknown>; } catch { throw new Error('Invalid controller JSON.'); }
  if (!e || typeof e !== 'object' || Array.isArray(e)) return invalid();
  if (e.v !== 1) throw new Error('Unsupported controller protocol version.');
  if (!integer(e.seq) || !integer(e.time)) return invalid();
  if (e.type === 'ready') {
    if (!['hardware', 'virtual'].includes(String(e.source)) || typeof e.sdl !== 'string' || e.sdl.length > 40) return invalid();
  } else {
    if (!integer(e.device) || e.device === 0) return invalid();
    switch (e.type) {
      case 'connected':
        if (typeof e.name !== 'string' || e.name.length > 512) return invalid();
        if (e.connection !== undefined && !['wired', 'wireless', 'unknown'].includes(String(e.connection))) return invalid();
        if (e.serial !== undefined && (typeof e.serial !== 'string' || e.serial.length > 512)) return invalid();
        break;
      case 'disconnected': break;
      case 'button': if (!buttons.includes(e.button as Button) || typeof e.down !== 'boolean') return invalid(); break;
      case 'axis': if (!axes.includes(e.axis as Axis) || !Number.isInteger(e.value) || Number(e.value) < -32768 || Number(e.value) > 32767) return invalid(); break;
      default: return invalid();
    }
  }
  return e as Event;
}

/** Fatal UTF-8 decoding and bounded framing prevent broken helpers from growing memory. */
export class EventDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private pending = '';
  private seq = -1;
  private time = -1;
  private ready = false;
  push(chunk: Uint8Array): Event[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const events: Event[] = [];
    for (;;) {
      const end = this.pending.indexOf('\n');
      if (end < 0) break;
      if (end > 4096) throw new Error('Controller record exceeds 4096 characters.');
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      const event = parseEvent(line);
      if (event.seq <= this.seq || event.time < this.time) throw new Error('Controller event order violation.');
      if ((!this.ready && event.type !== 'ready') || (this.ready && event.type === 'ready')) throw new Error('Controller handshake violation.');
      this.ready = true; this.seq = event.seq; this.time = event.time;
      events.push(event);
    }
    if (this.pending.length > 4096) throw new Error('Controller record exceeds 4096 characters.');
    return events;
  }
  end(): void {
    this.pending += this.decoder.decode();
    if (this.pending) throw new Error('Incomplete controller record.');
    if (!this.ready) throw new Error('Controller helper exited without a handshake.');
  }
}
