import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Native helpers and the PTY runtime come from a development build in this checkout, or from the
// prebuilt platform package (padcode-darwin) that npm installs next to the CLI.
export const platformPackage = 'padcode-darwin';
export type RuntimePart = 'helpers' | 'pty';
interface Manifest { platform: string; arch: string | string[]; version?: string }
export interface LocateOptions { root?: string; platform?: string; arch?: string; version?: string; resolvePackage?: () => string | undefined }

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
function ownVersion(root: string): string {
  return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
}
function defaultResolve(): string | undefined {
  try { return dirname(createRequire(import.meta.url).resolve(`${platformPackage}/platform.json`)); } catch { return undefined; }
}
function manifest(path: string): Manifest {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`The native runtime description at ${path} is unreadable. Reinstall Padcode.`); }
  const value = parsed as Partial<Manifest> | null;
  const arch = value?.arch;
  if (!value || typeof value.platform !== 'string' || !(typeof arch === 'string' || (Array.isArray(arch) && arch.every(item => typeof item === 'string')))) throw new Error(`The native runtime description at ${path} is invalid. Reinstall Padcode.`);
  return value as Manifest;
}
function matches(built: Manifest, platform: string, arch: string, what: string): void {
  const arches = typeof built.arch === 'string' ? [built.arch] : built.arch;
  if (built.platform !== platform || !arches.includes(arch)) throw new Error(`This ${what} was built for ${built.platform}/${arches.join('+')}. Use a package built for this computer.`);
}
export function locateRuntime(part: RuntimePart, options: LocateOptions = {}): string {
  const root = options.root ?? packageRoot, platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
  const development = join(root, 'build', part === 'helpers' ? 'native' : 'pty');
  if (existsSync(join(development, 'platform.json'))) {
    matches(manifest(join(development, 'platform.json')), platform, arch, part === 'helpers' ? 'development package' : 'PTY runtime');
    return development;
  }
  const installed = (options.resolvePackage ?? defaultResolve)();
  if (!installed) {
    throw new Error(platform === 'darwin'
      ? `Padcode's macOS helpers (${platformPackage}) are not installed. Reinstall Padcode with npm; optional dependencies must not be omitted.`
      : `Prebuilt Padcode helpers are only packaged for macOS so far. On ${platform}, build from source (see CONTRIBUTING.md).`);
  }
  const built = manifest(join(installed, 'platform.json'));
  matches(built, platform, arch, `${platformPackage} package`);
  const version = options.version ?? ownVersion(root);
  if (built.version !== version) throw new Error(`${platformPackage} ${built.version ?? '(unknown)'} does not match Padcode ${version}. Reinstall Padcode so both packages match.`);
  return join(installed, part === 'helpers' ? 'bin' : 'pty');
}
