import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// Golden files under test/snapshots/: SGR sequences stored as \e so diffs stay readable. UPDATE_SNAPSHOTS=1 rewrites them.
export function snapshot(path, lines) {
  const text = lines.join('\n').replaceAll('\x1b', '\\e') + '\n', file = new URL(`./snapshots/${path}`, import.meta.url);
  if (process.env.UPDATE_SNAPSHOTS === '1') { mkdirSync(new URL('.', file), { recursive: true }); writeFileSync(file, text); return; }
  assert.ok(existsSync(file), `missing snapshot ${path}; run UPDATE_SNAPSHOTS=1 npm test`);
  assert.equal(text, readFileSync(file, 'utf8'), path);
}
