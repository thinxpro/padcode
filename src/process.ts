import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

export function helperPath(name: 'padcode-controller' | 'padcode-bluetooth' | 'padcode-audio'): string {
  const manifest = new URL('../build/native/platform.json', import.meta.url);
  if (existsSync(manifest)) {
    const built = JSON.parse(readFileSync(manifest, 'utf8')) as { platform: string; arch: string };
    if (built.platform !== process.platform || built.arch !== process.arch) throw new Error(`This development package was built for ${built.platform}/${built.arch}. Use a package built for this computer.`);
  }
  return fileURLToPath(new URL(`../build/native/${name}`, import.meta.url));
}
export interface RunOptions { signal?: AbortSignal; timeout?: number; maxBytes?: number }
export async function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let bytes = 0, failure: Error | undefined, killTimer: NodeJS.Timeout | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const abort = () => stop(new Error('Operation cancelled.'));
    const timeout = setTimeout(() => stop(new Error('Operation timed out.')), options.timeout ?? 25000);
    options.signal?.addEventListener('abort', abort, { once: true });
    const receive = (data: Buffer, output: 'stdout' | 'stderr') => {
      if (failure) return;
      bytes += data.byteLength;
      if (bytes > (options.maxBytes ?? 131072)) { stop(new Error('Helper output limit exceeded.')); return; }
      chunks[output].push(data);
    };
    child.stdout.on('data', data => receive(data, 'stdout'));
    child.stderr.on('data', data => receive(data, 'stderr'));
    child.on('error', error => { failure = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timeout); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (signal) reject(new Error(`Helper stopped (${signal}).`));
      else {
        try {
          const decode = (buffers: Buffer[]) => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers));
          resolve({ code: code ?? 1, stdout: decode(chunks.stdout), stderr: decode(chunks.stderr) });
        } catch (error) { reject(error); }
      }
    });
  });
}
