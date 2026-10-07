import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('local npm tarball installs outside the checkout with CLI, setup and native helpers', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'padcode-install-')); t.after(() => rm(root, { recursive: true, force: true }));
  const npm = (args) => {
    const r = spawnSync('npm', [...args, '--cache', join(root, 'cache'), '--offline', '--no-audit', '--no-fund'], { encoding: 'utf8', timeout: 25000 });
    assert.equal(r.status, 0, `${r.error ?? ''}\n${r.stderr}\n${r.stdout}`); return r.stdout;
  };
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', root]))[0];
  const names = packed.files.map(file => file.path);
  assert.ok(names.includes('dist/cli.js')); assert.ok(names.includes('build/native/padcode-controller'));
  if (process.platform === 'darwin') assert.ok(names.includes('build/native/padcode-bluetooth'));
  assert.ok(names.every(name => !name.startsWith('test/') && !name.includes('config.json')));
  npm(['install', '--prefix', join(root, 'prefix'), '--omit=dev', '--ignore-scripts', join(root, packed.filename)]);
  const installed = join(root, 'prefix/node_modules/padcode');
  const bin = join(root, 'prefix/node_modules/.bin/padcode');
  const help = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /config/);
  const helper = spawnSync(join(installed, 'build/native/padcode-controller'), ['--virtual-test'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(helper.status, 0, helper.stderr); assert.match(helper.stdout, /"source":"virtual"/);
  const pty = spawnSync('python3', ['test/onboarding_pty.py', join(installed, 'dist/cli.js')], { encoding: 'utf8', timeout: 20000, env: { ...process.env, PADCODE_NODE: process.execPath } });
  assert.equal(pty.status, 0, `${pty.stdout}\n${pty.stderr}`);
  if (process.platform === 'darwin') {
    const permission = spawnSync(join(installed, 'build/native/padcode-bluetooth'), ['diagnose-permission'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(permission.status, 0, permission.stderr);
    const diagnostic = JSON.parse(permission.stdout);
    assert.equal(diagnostic.selfResponsible, true); assert.equal(diagnostic.usageDescription, true);
  }
  const platform = JSON.parse(await readFile(join(installed, 'build/native/platform.json'), 'utf8'));
  assert.deepEqual(platform, { platform: process.platform, arch: process.arch });
  await writeFile(join(installed, 'build/native/platform.json'), JSON.stringify({ platform: 'wrong-platform', arch: 'wrong-cpu' }));
  const mismatch = spawnSync(bin, ['controllers', '--json'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(mismatch.status, 1); assert.match(mismatch.stderr, /built for wrong-platform/); assert.ok(!mismatch.stderr.includes(' at '));
  const helpStillWorks = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 5000 }); assert.equal(helpStillWorks.status, 0);
});
