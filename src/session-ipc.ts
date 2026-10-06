import { EventEmitter } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';

// Private, per-session protocol between the coordinator and its tmux panes.
export type Role = 'agent' | 'panel';
export interface Launch { command: string; args: string[]; cwd: string; env: Record<string, string | null> }
export type ToAgent = { t: 'launch'; launch: Launch } | { t: 'keys'; data: string } | { t: 'cancel' } | { t: 'close' };
export type FromAgent = { t: 'exit'; code: number };
export type ToPanel = { t: 'status'; text: string };
export const maxLine = 4096;
const maxKeys = 64;

const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;

export class LineReader {
  private buffer = '';
  push(chunk: Buffer | string): string[] {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop()!;
    if (this.buffer.length > maxLine || lines.some(line => line.length > maxLine)) throw new Error('IPC line exceeds 4 KiB.');
    return lines;
  }
}
function decode(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!plain(value) || typeof value.t !== 'string') throw new Error('IPC message must be an object with a type.');
  return value;
}
export function parseHello(line: string, session: string): Role {
  const value = decode(line);
  if (value.t !== 'hello' || !exact(value, ['t', 'role', 'session']) || value.session !== session || (value.role !== 'agent' && value.role !== 'panel')) throw new Error('Invalid IPC hello.');
  return value.role;
}
export function parseFromAgent(line: string): FromAgent {
  const value = decode(line);
  if (value.t === 'exit' && exact(value, ['t', 'code']) && Number.isInteger(value.code) && (value.code as number) >= 0 && (value.code as number) <= 255) return { t: 'exit', code: value.code as number };
  throw new Error('Invalid Agent pane message.');
}
export function parseToAgent(line: string): ToAgent {
  const value = decode(line);
  if ((value.t === 'cancel' || value.t === 'close') && exact(value, ['t'])) return { t: value.t };
  if (value.t === 'keys' && exact(value, ['t', 'data']) && text(value.data, 128)) {
    const data = Buffer.from(value.data, 'base64');
    if (data.length && data.length <= maxKeys && data.toString('base64') === value.data) return { t: 'keys', data: value.data };
  }
  if (value.t === 'launch' && exact(value, ['t', 'launch']) && plain(value.launch) && exact(value.launch, ['command', 'args', 'cwd', 'env'])) {
    const { command, args, cwd, env } = value.launch;
    if (text(command, 4096) && Array.isArray(args) && args.length <= 64 && args.every(arg => text(arg, 4096)) && text(cwd, 4096) && plain(env)
      && Object.entries(env).every(([key, entry]) => ['TMUX', 'TMUX_PANE'].includes(key) && (entry === null || text(entry, 4096)))) {
      return { t: 'launch', launch: { command, args: [...args] as string[], cwd, env: { ...env } as Record<string, string | null> } };
    }
  }
  throw new Error('Invalid coordinator message for the Agent pane.');
}
export function parseToPanel(line: string): ToPanel {
  const value = decode(line);
  if (value.t === 'status' && exact(value, ['t', 'text']) && text(value.text, 256)) return { t: 'status', text: value.text };
  throw new Error('Invalid coordinator message for the status pane.');
}

export class SessionServer {
  readonly token = randomBytes(16).toString('hex');
  private events = new EventEmitter();
  private peers = new Map<Role, Socket>();
  private agentSeen = false;
  private agentExited = false;
  private constructor(private server: ReturnType<typeof createServer>) {}
  static async listen(path: string): Promise<SessionServer> {
    const server = createServer();
    const session = new SessionServer(server);
    server.on('connection', socket => session.accept(socket));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.removeListener('error', reject); resolve(); }); });
    return session;
  }
  private accept(socket: Socket): void {
    const reader = new LineReader();
    let role: Role | undefined;
    const reject = () => { socket.destroy(); };
    const timer = setTimeout(reject, 5000);
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      if (role && this.peers.get(role) === socket) { this.peers.delete(role); this.events.emit('disconnect', role); }
    });
    socket.on('data', chunk => {
      try {
        for (const line of reader.push(chunk)) {
          if (!role) {
            const claimed = parseHello(line, this.token);
            if (this.peers.has(claimed) || (claimed === 'agent' && this.agentSeen)) throw new Error('Duplicate IPC role.');
            role = claimed; clearTimeout(timer); this.peers.set(role, socket);
            if (role === 'agent') this.agentSeen = true;
            this.events.emit('connect', role);
          } else if (role === 'agent') {
            const message = parseFromAgent(line);
            if (this.agentExited) throw new Error('Duplicate Agent exit.');
            this.agentExited = true; this.events.emit('exit', message.code);
          } else throw new Error('The status pane cannot send messages.');
        }
      } catch { reject(); }
    });
  }
  on(event: 'connect' | 'disconnect', listener: (role: Role) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: string, listener: (value: any) => void): void { this.events.on(event, listener); }
  connected(role: Role): boolean { return this.peers.has(role); }
  send(role: 'agent', message: ToAgent): void;
  send(role: 'panel', message: ToPanel): void;
  send(role: Role, message: ToAgent | ToPanel): void {
    const socket = this.peers.get(role);
    if (socket && !socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }
  async close(): Promise<void> {
    for (const socket of this.peers.values()) socket.destroy();
    this.peers.clear();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

export interface SessionPeer<T> { send(message: FromAgent): void; close(): void; onMessage(listener: (message: T) => void): void; onClose(listener: () => void): void }
export async function joinSession(path: string, session: string, role: 'agent'): Promise<SessionPeer<ToAgent>>;
export async function joinSession(path: string, session: string, role: 'panel'): Promise<SessionPeer<ToPanel>>;
export async function joinSession(path: string, session: string, role: Role): Promise<SessionPeer<ToAgent | ToPanel>> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const events = new EventEmitter(), reader = new LineReader();
  const parse = role === 'agent' ? parseToAgent : parseToPanel;
  socket.on('error', () => {});
  socket.on('close', () => events.emit('close'));
  socket.on('data', chunk => {
    try { for (const line of reader.push(chunk)) events.emit('message', parse(line)); } catch { socket.destroy(); }
  });
  socket.write(`${JSON.stringify({ t: 'hello', role, session })}\n`);
  return {
    send: message => { if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`); },
    close: () => socket.end(),
    onMessage: listener => { events.on('message', listener); },
    onClose: listener => { events.on('close', listener); },
  };
}
