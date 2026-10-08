import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { bundlePty, ptySource, ptyVersion } from './pty-bundle.mjs';

// Development bundle for this computer only; scripts/package.mjs bundles every macOS prebuild.
if (!['darwin', 'linux'].includes(process.platform)) throw new Error('PTY builds support macOS and Linux only.');
await ptyVersion();
let native = join(ptySource, 'prebuilds', `${process.platform}-${process.arch}`);
try { await access(join(native, 'pty.node')); }
catch {
  const built = spawnSync('npm', ['rebuild', 'node-pty', '--offline'], { stdio: 'inherit' });
  if (built.status !== 0) throw new Error('Development-time node-pty build failed.');
  native = join(ptySource, 'build/Release');
}
const version = await bundlePty('build/pty', { [`${process.platform}-${process.arch}`]: native }, { platform: process.platform, arch: process.arch });
console.log(`Bundled node-pty ${version} for ${process.platform}/${process.arch}`);
