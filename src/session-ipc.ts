import { EventEmitter } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';

// Private, per-session protocol between the coordinator and its tmux panes.
export type Role = 'agent' | 'panel' | 'menu';
export interface Launch { command: string; args: string[]; cwd: string; env: Record<string, string | null> }
export type ToAgent = { t: 'launch'; launch: Launch } | { t: 'keys'; data: string } | { t: 'cancel' } | { t: 'close' }
  | { t: 'paste-part'; text: string } | { t: 'paste-end' } | { t: 'undo'; count: number };
export type FromAgent = { t: 'exit'; code: number } | { t: 'undo-result'; ok: boolean; reason: string };
export type ToPanel = { t: 'status'; text: string } | { t: 'notice'; text: string };
export type ToMenu = { t: 'menu'; title: string; items: string[]; selected: number; hint: string; body?: string; map?: { claude: boolean; voice: boolean } } | { t: 'close' };
export type FromMenu = { t: 'action'; name: 'up' | 'down' | 'confirm' | 'back' } | { t: 'action'; name: 'pick'; index: number };
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
  if (value.t !== 'hello' || !exact(value, ['t', 'role', 'session']) || value.session !== session || !['agent', 'panel', 'menu'].includes(value.role as string)) throw new Error('Invalid IPC hello.');
  return value.role as Role;
}
export function parseFromAgent(line: string): FromAgent {
  const value = decode(line);
  if (value.t === 'undo-result' && exact(value, ['t', 'ok', 'reason']) && typeof value.ok === 'boolean' && text(value.reason, 64)) return { t: 'undo-result', ok: value.ok, reason: value.reason as string };
  if (value.t === 'exit' && exact(value, ['t', 'code']) && Number.isInteger(value.code) && (value.code as number) >= 0 && (value.code as number) <= 255) return { t: 'exit', code: value.code as number };
  throw new Error('Invalid Agent pane message.');
}
export function parseToAgent(line: string): ToAgent {
  const value = decode(line);
  if ((value.t === 'cancel' || value.t === 'close' || value.t === 'paste-end') && exact(value, ['t'])) return { t: value.t };
  // Voice text arrives in bounded chunks of already-cleaned text: no control characters at all.
  if (value.t === 'paste-part' && exact(value, ['t', 'text']) && text(value.text, 1024) && value.text && !/[\x00-\x1f\x7f-\x9f]/.test(value.text)) return { t: 'paste-part', text: value.text };
  if (value.t === 'undo' && exact(value, ['t', 'count']) && Number.isInteger(value.count) && (value.count as number) >= 1 && (value.count as number) <= 65536) return { t: 'undo', count: value.count as number };
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
  if ((value.t === 'status' || value.t === 'notice') && exact(value, ['t', 'text']) && text(value.text, 256)) return { t: value.t, text: value.text };
  throw new Error('Invalid coordinator message for the status pane.');
}

export function parseToMenu(line: string): ToMenu {
  const value = decode(line);
  if (value.t === 'close' && exact(value, ['t'])) return { t: 'close' };
  const body = value.body, map = value.map;
  const validMap = plain(map) && exact(map, ['claude', 'voice']) && typeof map.claude === 'boolean' && typeof map.voice === 'boolean';
  if (value.t === 'menu' && (exact(value, ['t', 'title', 'items', 'selected', 'hint']) || (exact(value, ['t', 'title', 'items', 'selected', 'hint', 'body']) && text(body, 3000) && !/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(body as string))
      || (exact(value, ['t', 'title', 'items', 'selected', 'hint', 'map']) && validMap))
    && text(value.title, 64) && text(value.hint, 128)
    && Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= 16 && value.items.every(item => text(item, 64))
    && Number.isInteger(value.selected) && (value.selected as number) >= 0 && (value.selected as number) < value.items.length) {
    return { t: 'menu', title: value.title, items: [...value.items] as string[], selected: value.selected as number, hint: value.hint, ...(typeof body === 'string' ? { body } : {}),
      ...(validMap ? { map: { claude: (map as { claude: boolean }).claude, voice: (map as { voice: boolean }).voice } } : {}) };
  }
  throw new Error('Invalid coordinator message for the menu popup.');
}
export function parseFromMenu(line: string): FromMenu {
  const value = decode(line);
  if (value.t === 'action' && exact(value, ['t', 'name']) && ['up', 'down', 'confirm', 'back'].includes(value.name as string)) return { t: 'action', name: value.name as 'up' };
  if (value.t === 'action' && exact(value, ['t', 'name', 'index']) && value.name === 'pick' && Number.isInteger(value.index) && (value.index as number) >= 0 && (value.index as number) < 16) return { t: 'action', name: 'pick', index: value.index as number };
  throw new Error('Invalid menu popup message.');
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
            if (this.agentExited) throw new Error('Agent messages after exit.');
            if (message.t === 'undo-result') this.events.emit('undo', message);
            else { this.agentExited = true; this.events.emit('exit', message.code); }
          } else if (role === 'menu') this.events.emit('action', parseFromMenu(line));
          else throw new Error('The status pane cannot send messages.');
        }
      } catch { reject(); }
    });
  }
  on(event: 'connect' | 'disconnect', listener: (role: Role) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'action', listener: (action: FromMenu) => void): void;
  on(event: 'undo', listener: (result: { ok: boolean; reason: string }) => void): void;
  on(event: string, listener: (value: any) => void): void { this.events.on(event, listener); }
  connected(role: Role): boolean { return this.peers.has(role); }
  send(role: 'agent', message: ToAgent): void;
  send(role: 'panel', message: ToPanel): void;
  send(role: 'menu', message: ToMenu): void;
  send(role: Role, message: ToAgent | ToPanel | ToMenu): void {
    const socket = this.peers.get(role);
    if (socket && !socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }
  async close(): Promise<void> {
    for (const socket of this.peers.values()) socket.destroy();
    this.peers.clear();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

export interface SessionPeer<T, S = FromAgent> { send(message: S): void; close(): void; onMessage(listener: (message: T) => void): void; onClose(listener: () => void): void }
export async function joinSession(path: string, session: string, role: 'agent'): Promise<SessionPeer<ToAgent>>;
export async function joinSession(path: string, session: string, role: 'panel'): Promise<SessionPeer<ToPanel>>;
export async function joinSession(path: string, session: string, role: 'menu'): Promise<SessionPeer<ToMenu, FromMenu>>;
export async function joinSession(path: string, session: string, role: Role): Promise<SessionPeer<ToAgent | ToPanel | ToMenu, FromAgent | FromMenu>> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const events = new EventEmitter(), reader = new LineReader();
  const parse = role === 'agent' ? parseToAgent : role === 'panel' ? parseToPanel : parseToMenu;
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
