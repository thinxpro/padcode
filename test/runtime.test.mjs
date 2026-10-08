import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateRuntime, platformPackage } from '../dist/runtime.js';

test('P2 runtime: development build first, then the platform package, with friendly failures', async t => {
  const base = await mkdtemp(join(tmpdir(), 'padcode-runtime-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'padcode'), installed = join(base, platformPackage);
  await mkdir(root, { recursive: true }); await mkdir(installed, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  const manifest = value => writeFile(join(installed, 'platform.json'), JSON.stringify(value));
  const options = extra => ({ root, platform: 'darwin', arch: 'arm64', resolvePackage: () => installed, ...extra });
  const friendly = (fn, pattern) => assert.throws(fn, error => pattern.test(error.message) && !/\n\s+at /.test(error.message));

  // Installed platform package: helpers in bin/, PTY in pty/, architecture list and exact version.
  await manifest({ platform: 'darwin', arch: ['arm64', 'x64'], minos: '13.0', version: '9.9.9' });
  assert.equal(locateRuntime('helpers', options()), join(installed, 'bin'));
  assert.equal(locateRuntime('pty', options({ arch: 'x64' })), join(installed, 'pty'));
  friendly(() => locateRuntime('helpers', options({ arch: 'ia32' })), /built for darwin\/arm64\+x64\. Use a package built for this computer/);
  friendly(() => locateRuntime('helpers', options({ platform: 'linux' })), /built for darwin/);
  friendly(() => locateRuntime('helpers', options({ version: '1.0.0' })), /padcode-darwin 9\.9\.9 does not match Padcode 1\.0\.0\. Reinstall/);
  await manifest({ platform: 'darwin', arch: ['arm64'] });
  friendly(() => locateRuntime('helpers', options()), /padcode-darwin \(unknown\) does not match Padcode 9\.9\.9/);
  await manifest({ platform: 'darwin', arch: 7 });
  friendly(() => locateRuntime('helpers', options()), /is invalid\. Reinstall Padcode/);
  await writeFile(join(installed, 'platform.json'), '{');
  friendly(() => locateRuntime('helpers', options()), /is unreadable\. Reinstall Padcode/);

  // Missing package.
  friendly(() => locateRuntime('helpers', options({ resolvePackage: () => undefined })), /macOS helpers \(padcode-darwin\) are not installed/);
  friendly(() => locateRuntime('pty', options({ platform: 'linux', resolvePackage: () => undefined })), /only packaged for macOS so far\. On linux, build from source/);

  // A development build wins over an installed package; a single-string arch still works.
  await mkdir(join(root, 'build/native'), { recursive: true }); await mkdir(join(root, 'build/pty'), { recursive: true });
  await writeFile(join(root, 'build/native/platform.json'), JSON.stringify({ platform: 'darwin', arch: ['arm64', 'x64'] }));
  await writeFile(join(root, 'build/pty/platform.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64' }));
  assert.equal(locateRuntime('helpers', options({ resolvePackage: () => { throw new Error('not consulted'); } })), join(root, 'build/native'));
  assert.equal(locateRuntime('pty', options()), join(root, 'build/pty'));
  friendly(() => locateRuntime('pty', options({ arch: 'x64' })), /PTY runtime was built for darwin\/arm64/);
  friendly(() => locateRuntime('helpers', options({ platform: 'linux' })), /development package was built for darwin\/arm64\+x64/);
});
