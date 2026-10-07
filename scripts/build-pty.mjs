import { cp, mkdir, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (!['darwin', 'linux'].includes(process.platform)) throw new Error('PTY builds support macOS and Linux only.');
const source = 'node_modules/node-pty', target = 'build/pty';
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
if (pkg.version !== '1.1.0') throw new Error('Review PTY compatibility before changing node-pty.');
let native = join(source, 'prebuilds', `${process.platform}-${process.arch}`);
try { await access(join(native, 'pty.node')); }
catch {
  const built = spawnSync('npm', ['rebuild', 'node-pty', '--offline'], { stdio: 'inherit' });
  if (built.status !== 0) throw new Error('Development-time node-pty build failed.');
  native = join(source, 'build/Release');
}
await rm(target, { recursive: true, force: true });
await mkdir(join(target, 'prebuilds', `${process.platform}-${process.arch}`), { recursive: true });
await cp(join(source, 'lib'), join(target, 'lib'), { recursive: true, filter: path => !/\.test\.js(?:\.map)?$|\.map$/.test(path) });
await cp(join(source, 'LICENSE'), join(target, 'LICENSE'));
await cp('node_modules/node-addon-api/LICENSE.md', join(target, 'LICENSE-node-addon-api.md'));
const destNative = join(target, 'prebuilds', `${process.platform}-${process.arch}`);
await cp(join(native, 'pty.node'), join(destNative, 'pty.node'));
if (process.platform === 'darwin') {
  await cp(join(native, 'spawn-helper'), join(destNative, 'spawn-helper'));
  await chmod(join(destNative, 'spawn-helper'), 0o755);
}
await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'node-pty', version: pkg.version, main: 'lib/index.js', license: 'MIT' }) + '\n');
await writeFile(join(target, 'platform.json'), JSON.stringify({ platform: process.platform, arch: process.arch }) + '\n');
console.log(`Bundled node-pty ${pkg.version} for ${process.platform}/${process.arch}`);
