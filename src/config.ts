import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Config {
  version: 1;
  controller: { transport: 'bluetooth' | 'usb'; name?: string; address?: string; inputVerified: boolean };
  agent: { command: string; args: string[] } | null;
  profile: 'terminal-basic';
}
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(root, 'padcode', 'config.json');
}
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !/[\x00-\x1f\x7f]/u.test(value);
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object') throw new Error('Configuration must be a JSON object.');
  const c = value as Partial<Config>;
  if (c.version !== 1) throw new Error('Unsupported configuration version.');
  if (!c.controller || !['bluetooth', 'usb'].includes(c.controller.transport) || typeof c.controller.inputVerified !== 'boolean') throw new Error('Invalid controller configuration.');
  if (c.controller.name !== undefined && !text(c.controller.name, 512)) throw new Error('Invalid controller name.');
  if (c.controller.address !== undefined && !/^([\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(c.controller.address)) throw new Error('Invalid Bluetooth address.');
  if (c.agent !== null && (!c.agent || !text(c.agent.command, 4096) || !isAbsolute(c.agent.command) || !Array.isArray(c.agent.args) || c.agent.args.length > 64 || !c.agent.args.every(a => text(a, 4096)))) throw new Error('Invalid Agent command or arguments.');
  if (c.profile !== 'terminal-basic') throw new Error('Unsupported key profile.');
  // Strip unknown fields rather than persisting credentials or unrelated project settings.
  return { version: 1, controller: {
    transport: c.controller.transport, inputVerified: c.controller.inputVerified,
    ...(c.controller.name === undefined ? {} : { name: c.controller.name }),
    ...(c.controller.address === undefined ? {} : { address: c.controller.address }),
  }, agent: c.agent === null ? null : { command: c.agent.command, args: [...c.agent.args] }, profile: c.profile };
}
export async function loadConfig(path = configPath()): Promise<Config | null> {
  try {
    const info = await stat(path);
    if (info.size > 65536) throw new Error('Configuration is too large.');
    return validateConfig(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read config: ${(error as Error).message}`);
  }
}
export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  const content = `${JSON.stringify(validateConfig(config), null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function resolveExecutable(command: string, path = process.env.PATH ?? '', cwd = process.cwd()): Promise<string | null> {
  if (!text(command, 4096) || !command.trim()) return null;
  const candidates = command.includes('/') ? [resolve(cwd, command)] : path.split(delimiter).filter(Boolean).map(dir => resolve(dir, command));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch { /* Try the next PATH entry. */ }
  }
  return null;
}
export async function discoverAgents(path = process.env.PATH ?? ''): Promise<{ label: string; command: string }[]> {
  const found = [];
  for (const name of ['codex', 'claude', 'gemini', 'opencode']) {
    const command = await resolveExecutable(name, path);
    if (command) found.push({ label: name, command });
  }
  return found;
}
