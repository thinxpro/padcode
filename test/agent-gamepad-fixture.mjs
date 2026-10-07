import { AgentGamepad } from '../dist/agent-gamepad.js';
// Shared virtual feed for AgentGamepad unit tests.
export const target = { transport: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff', inputVerified: true };
export const pad = { type: 'connected', device: 1, name: 'Fixture PS4', connection: 'wireless', serial: target.address };
export function fixture(startError, settings = {}) {
  let listener, clock = 0, stopped = 0;
  const feed = { start: async () => { if (startError) throw startError; }, stop: async () => { stopped++; }, snapshot: () => [pad], subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  const gamepad = new AgentGamepad(target, { factory: () => feed, now: () => clock, ...settings }), bytes = [], statuses = []; let cancellations = 0;
  gamepad.subscribe(data => bytes.push(data.toString()), text => statuses.push(text), () => cancellations++);
  const emit = event => listener?.(event);
  const edge = (button, down, device = 1) => emit({ type: 'button', device, button, down });
  const press = (button, device = 1) => { edge(button, true, device); edge(button, false, device); };
  return { gamepad, feed, bytes, statuses, edge, press, emit, advance: () => { clock += 300; }, fail: () => listener?.(undefined, new Error('lost')), stopped: () => stopped, cancellations: () => cancellations };
}
