import { cp, mkdir, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { join } from 'node:path';

// Copies node-pty's JavaScript, licenses and the native files for each target (for example
// darwin-arm64) from `natives`, a map of target to directory holding pty.node (and spawn-helper on macOS).
export const ptySource = 'node_modules/node-pty';
export async function ptyVersion() {
  const pkg = JSON.parse(await readFile(join(ptySource, 'package.json'), 'utf8'));
  if (pkg.version !== '1.1.0') throw new Error('Review PTY compatibility before changing node-pty.');
  return pkg.version;
}
export async function bundlePty(target, natives, manifest) {
  const version = await ptyVersion();
  await rm(target, { recursive: true, force: true });
  await cp(join(ptySource, 'lib'), join(target, 'lib'), { recursive: true, filter: path => !/\.test\.js(?:\.map)?$|\.map$/.test(path) });
  await cp(join(ptySource, 'LICENSE'), join(target, 'LICENSE'));
  await cp('node_modules/node-addon-api/LICENSE.md', join(target, 'LICENSE-node-addon-api.md'));
  for (const [name, native] of Object.entries(natives)) {
    const dest = join(target, 'prebuilds', name);
    await mkdir(dest, { recursive: true });
    await access(join(native, 'pty.node'));
    await cp(join(native, 'pty.node'), join(dest, 'pty.node'));
    if (name.startsWith('darwin-')) { await cp(join(native, 'spawn-helper'), join(dest, 'spawn-helper')); await chmod(join(dest, 'spawn-helper'), 0o755); }
  }
  await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'node-pty', version, main: 'lib/index.js', license: 'MIT' }) + '\n');
  if (manifest) await writeFile(join(target, 'platform.json'), JSON.stringify(manifest) + '\n');
  return version;
}
