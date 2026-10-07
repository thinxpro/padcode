import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const args = ['-S', 'native', '-B', 'build/native', '-DCMAKE_BUILD_TYPE=Release'];
// Keep SDK and compiler in the selected Xcode installation aligned. No global xcode-select change.
if (process.platform === 'darwin' && !process.env.SDKROOT && !process.env.CMAKE_OSX_SYSROOT) {
  const selected = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' });
  if (selected.status === 0) {
    const sdk = resolve(selected.stdout.trim(), 'Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk');
    if (existsSync(sdk)) args.push(`-DCMAKE_OSX_SYSROOT=${sdk}`);
  }
} else if (process.env.CMAKE_OSX_SYSROOT) args.push(`-DCMAKE_OSX_SYSROOT=${process.env.CMAKE_OSX_SYSROOT}`);
for (const command of [args, ['--build', 'build/native', '--parallel', '4']]) {
  const result = spawnSync('cmake', command, { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync('build/native/platform.json', JSON.stringify({ platform: process.platform, arch: process.arch }) + '\n');
