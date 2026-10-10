import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isFamily, type Family } from './glyphs.js';
import { maxCustom, validCustom } from './quick-commands.js';

export interface Config {
  version: 2;
  controller: { transport: 'bluetooth' | 'usb'; name?: string; address?: string; inputVerified: boolean; family?: Family; confirm?: 'south' | 'east' };
  agent: { command: string; args: string[]; commands?: string[] } | null;
  profile: 'terminal-basic';
  voice: VoiceSettings | null;
}
export type Transcriber = { kind: 'system'; language: string } | { kind: 'command'; command: string; args: string[]; language: string };
export interface VoiceSettings { microphone: { id: string; name: string }; transcriber: Transcriber | null; insert: 'auto' | 'review'
}
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(root, 'padcode', 'config.json');
}
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !/[\x00-\x1f\x7f]/u.test(value);
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object') throw new Error('Configuration must be a JSON object.');
  const c = value as Partial<Omit<Config, 'version'>> & { version?: number };
  // Version 1 predates voice; it migrates to version 2 with voice off.
  if (c.version !== 1 && c.version !== 2) throw new Error('Unsupported configuration version.');
  const voice = c.version === 1 || c.voice === undefined ? null : c.voice;
  if (voice !== null && (!voice || typeof voice !== 'object' || !voice.microphone || !text(voice.microphone.id, 512) || !voice.microphone.id || !text(voice.microphone.name, 512))) throw new Error('Invalid voice configuration.');
  const transcriber = voice?.transcriber ?? null;
  if (transcriber !== null && !validTranscriber(transcriber)) throw new Error('Invalid transcription command.');
  // Missing means the default: finished drafts go straight into the Agent's input.
  const insert = voice?.insert ?? 'auto';
  if (insert !== 'auto' && insert !== 'review') throw new Error('Invalid voice insertion mode.');
  if (!c.controller || !['bluetooth', 'usb'].includes(c.controller.transport) || typeof c.controller.inputVerified !== 'boolean') throw new Error('Invalid controller configuration.');
  if (c.controller.name !== undefined && !text(c.controller.name, 512)) throw new Error('Invalid controller name.');
  if (c.controller.address !== undefined && !/^([\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(c.controller.address)) throw new Error('Invalid Bluetooth address.');
  if (c.controller.family !== undefined && !isFamily(c.controller.family)) throw new Error('Invalid controller family.');
  if (c.controller.confirm !== undefined && c.controller.confirm !== 'south' && c.controller.confirm !== 'east') throw new Error('Invalid confirm button.');
  if (c.agent !== null && (!c.agent || !text(c.agent.command, 4096) || !isAbsolute(c.agent.command) || !Array.isArray(c.agent.args) || c.agent.args.length > 64 || !c.agent.args.every(a => text(a, 4096)))) throw new Error('Invalid Agent command or arguments.');
  // Custom quick commands are optional; absent stays absent so older files round-trip unchanged.
  if (c.agent && c.agent.commands !== undefined && (!Array.isArray(c.agent.commands) || c.agent.commands.length > maxCustom || !c.agent.commands.every(validCustom))) throw new Error('Invalid quick commands.');
  if (c.profile !== 'terminal-basic') throw new Error('Unsupported key profile.');
  // Strip unknown fields rather than persisting credentials or unrelated project settings.
  return { version: 2, controller: {
    transport: c.controller.transport, inputVerified: c.controller.inputVerified,
    ...(c.controller.name === undefined ? {} : { name: c.controller.name }),
    ...(c.controller.address === undefined ? {} : { address: c.controller.address }),
    ...(c.controller.family === undefined ? {} : { family: c.controller.family }),
    ...(c.controller.confirm === undefined ? {} : { confirm: c.controller.confirm }),
  }, agent: c.agent === null ? null : { command: c.agent.command, args: [...c.agent.args], ...(c.agent.commands === undefined ? {} : { commands: [...c.agent.commands] }) }, profile: c.profile,
  voice: voice === null ? null : { microphone: { id: voice.microphone.id, name: voice.microphone.name },
    transcriber: transcriber === null ? null : transcriber.kind === 'system' ? { kind: 'system', language: transcriber.language }
      : { kind: 'command', command: transcriber.command, args: [...transcriber.args], language: transcriber.language }, insert } };
}
// Transcription runs a literal argv: {audio} must appear, {language} may; nothing is shell-evaluated.
export const validLanguage = (value: unknown): value is string => typeof value === 'string' && /^(auto|[a-z]{2,3})$/.test(value);
export function validTranscriber(value: unknown): value is Transcriber {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  if (t.kind === 'system') return validLanguage(t.language);
  const args = t.args;
  return t.kind === 'command' && text(t.command, 4096) && isAbsolute(t.command) && Array.isArray(args) && args.length <= 64
    && args.every(a => text(a, 4096)) && args.some(a => (a as string).includes('{audio}')) && validLanguage(t.language);
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
