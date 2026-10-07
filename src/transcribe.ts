import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { resolveExecutable, type Transcriber } from './config.js';
import type { AudioPort } from './audio.js';

export type TranscriptResult = { ok: true; text: string } | { ok: false; code: string; message: string };
export const transcriptLimit = 64 * 1024, transcribeTimeoutMs = 120000;
const oneLine = (text: string, limit = 200) => text.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim().slice(0, limit);

// Drafts never carry terminal controls: only text, spaces and line breaks survive.
export function cleanTranscript(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
export function speechLocale(language: string): string {
  return ({ zh: 'zh-CN', en: 'en-US', auto: 'auto' } as Record<string, string>)[language] ?? language;
}

export interface TranscriptionJob { done: Promise<TranscriptResult>; cancel(): void }
// Runs one transcription. Command transcribers get a literal argv; nothing is evaluated by a shell.
export function transcribe(transcriber: Transcriber, audioPath: string, audio: AudioPort, timeoutMs = transcribeTimeoutMs): TranscriptionJob {
  if (transcriber.kind === 'system') {
    const abort = new AbortController();
    const done = audio.transcribe(audioPath, speechLocale(transcriber.language), abort.signal)
      .then(result => result.ok ? { ok: true as const, text: cleanTranscript(result.text) } : result);
    return { done, cancel: () => abort.abort() };
  }
  const args = transcriber.args.map(arg => arg.replaceAll('{audio}', audioPath).replaceAll('{language}', transcriber.language));
  let child: ReturnType<typeof spawn>;
  try { child = spawn(transcriber.command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { return { done: Promise.resolve({ ok: false, code: 'spawn', message: `Cannot start the transcriber (${oneLine((error as Error).message, 120)}).` }), cancel: () => {} }; }
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let outBytes = 0, errBytes = 0, failure: TranscriptResult | undefined, kill: NodeJS.Timeout | undefined;
  const stop = (result: TranscriptResult) => {
    failure ??= result;
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); kill ??= setTimeout(() => child.kill('SIGKILL'), 1000); }
  };
  const timer = setTimeout(() => stop({ ok: false, code: 'timeout', message: `The transcriber took longer than ${Math.round(timeoutMs / 1000)} seconds.` }), timeoutMs);
  child.stdout!.on('data', (chunk: Buffer) => {
    outBytes += chunk.length;
    if (outBytes > transcriptLimit) stop({ ok: false, code: 'too-long', message: 'The transcriber printed more than 64 KiB.' }); else stdout.push(chunk);
  });
  child.stderr!.on('data', (chunk: Buffer) => { if (errBytes < 4096) { stderr.push(chunk); errBytes += chunk.length; } });
  const done = new Promise<TranscriptResult>(resolve => {
    child.on('error', error => { failure ??= { ok: false, code: 'spawn', message: `Cannot start the transcriber (${oneLine(error.message, 120)}).` }; });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(kill);
      if (failure) { resolve(failure); return; }
      if (code !== 0) { resolve({ ok: false, code: 'exit', message: `The transcriber exited with status ${code}: ${oneLine(Buffer.concat(stderr).toString('utf8')) || 'no message'}` }); return; }
      try { resolve({ ok: true, text: cleanTranscript(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout))) }); }
      catch { resolve({ ok: false, code: 'encoding', message: 'The transcriber printed text that is not valid UTF-8.' }); }
    });
  });
  return { done, cancel: () => stop({ ok: false, code: 'cancelled', message: 'Transcription cancelled.' }) };
}

// A one-second silent recording used to check a transcriber before saving it.
export async function writeSilentWav(path: string, seconds = 1): Promise<void> {
  const samples = Math.round(16000 * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(data); } finally { await file.close(); }
}

export interface WhisperModel { file: string; label: string; size: number; sha256: string }
// Pinned official files from huggingface.co/ggerganov/whisper.cpp; downloads are verified against these hashes.
export const whisperModels: WhisperModel[] = [
  { file: 'ggml-large-v3-turbo-q5_0.bin', label: 'large-v3-turbo q5_0 (574 MB, recommended)', size: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' },
  { file: 'ggml-large-v3-turbo.bin', label: 'large-v3-turbo (1.6 GB, most accurate)', size: 1624555275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' },
];
export const whisperSource = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
export function modelDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
  return join(root, 'padcode', 'models');
}
export async function findWhisper(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return await resolveExecutable('whisper-cli', [env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin'].join(':'));
}
export async function findModels(env: NodeJS.ProcessEnv = process.env, extra: string[] = []): Promise<string[]> {
  const home = homedir();
  const folders = [modelDirectory(env), join(home, '.local/share/whisper.cpp'), join(home, '.cache/whisper.cpp'), join(home, 'models'), '/opt/homebrew/share/whisper-cpp', '/usr/local/share/whisper-cpp', ...extra];
  const found: string[] = [];
  for (const folder of [...new Set(folders)]) {
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      if (!/^ggml-[\w.-]+\.bin$/.test(name)) continue;
      const info = await lstat(join(folder, name)).catch(() => undefined);
      if (info?.isFile() && info.size > 1024 * 1024) found.push(join(folder, name));
    }
  }
  return found;
}
export function whisperTranscriber(cli: string, model: string, language: string): Transcriber {
  return { kind: 'command', command: cli, args: ['-m', model, '-l', '{language}', '-nt', '-np', '-f', '{audio}'], language };
}

// Downloads a pinned model only after the caller has the user's consent. Partial or mismatched files are removed.
export async function downloadModel(model: WhisperModel, directory: string, options: { signal?: AbortSignal; onProgress?: (bytes: number, total: number) => void; source?: string } = {}): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, model.file), partial = `${target}.part`;
  await rm(partial, { force: true });
  const response = await fetch(`${options.source ?? whisperSource}/${model.file}`, { redirect: 'follow', ...(options.signal ? { signal: options.signal } : {}) });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
  const file = await open(partial, 'wx', 0o600), hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > model.size) throw new Error('The download is larger than expected.');
      hash.update(chunk); await file.write(chunk); options.onProgress?.(bytes, model.size);
    }
    await file.sync();
  } catch (error) { await file.close(); await rm(partial, { force: true }); throw error; }
  await file.close();
  if (bytes !== model.size || hash.digest('hex') !== model.sha256) { await rm(partial, { force: true }); throw new Error('The downloaded model failed its checksum and was deleted.'); }
  await rename(partial, target);
  return target;
}
