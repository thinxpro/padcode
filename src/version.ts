import { readFileSync } from 'node:fs';
let cached: string | undefined;
// The package version, read once.
export function version(): string {
  cached ??= (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  return cached;
}
