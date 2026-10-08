import test from 'node:test';
import { childEnv } from './child-env.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const darwin = process.platform === 'darwin';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const helpers = { 'padcode-controller': 'controller', 'padcode-bluetooth': 'bluetooth', 'padcode-audio': 'audio' };
const listing = tarball => spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).stdout.trim().split('\n').map(name => name.replace(/^package\//, ''));
const manifestOf = tarball => JSON.parse(spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }).stdout);

test('P3 packaging: bad signing identity fails cleanly', { skip: !darwin && 'macOS packages only', timeout: 60000 }, async t => {
  const out = await mkdtemp(join(tmpdir(), 'padcode-pack-bad-')); t.after(() => rm(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, ['scripts/package.mjs', '--out', out], { encoding: 'utf8', timeout: 50000, env: { ...process.env, PADCODE_SIGN_IDENTITY: 'Padcode Missing Test Identity', PADCODE_SIGN_TIMESTAMP: 'off' } });
  assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, /signing padcode-controller with "Padcode Missing Test Identity" failed/);
  assert.deepEqual(await readdir(out), []);
});

test('P3/P4 two prebuilt packages install without build tools and run from the installed copy', { skip: !darwin && 'macOS packages only', timeout: 180000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'padcode-install-')); t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, 'out');
  const packed = spawnSync(process.execPath, ['scripts/package.mjs', '--out', out], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PADCODE_SIGN_IDENTITY: '' } });
  assert.equal(packed.status, 0, `${packed.stderr}\n${packed.stdout}`); assert.match(packed.stdout, /ad-hoc signed/);
  const platformTarball = join(out, `padcode-darwin-${version}.tgz`), mainTarball = join(out, `padcode-${version}.tgz`);

  // Main package: JavaScript only, exact optional platform dependency, no install scripts.
  const mainFiles = listing(mainTarball), main = manifestOf(mainTarball);
  assert.ok(mainFiles.includes('dist/cli.js') && mainFiles.includes('dist/runtime.js') && mainFiles.includes('LICENSE') && mainFiles.includes('THIRD_PARTY_NOTICES.md'));
  assert.deepEqual(mainFiles.filter(name => name.startsWith('build/') || name.startsWith('test/') || name.startsWith('native/') || /\.node$|config\.json$/.test(name)), []);
  assert.deepEqual(main.optionalDependencies, { 'padcode-darwin': version }); assert.equal(main.scripts, undefined); assert.equal(main.devDependencies, undefined);
  assert.deepEqual(main.bin, { padcode: 'dist/cli.js' });

  // Platform package: helpers, both node-pty prebuilds, manifest, notices, os/cpu, no scripts.
  const platformFiles = listing(platformTarball), platform = manifestOf(platformTarball);
  for (const name of [...Object.keys(helpers).map(helper => `bin/${helper}`), 'platform.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'pty/LICENSE', 'pty/LICENSE-node-addon-api.md', 'pty/lib/index.js',
    'pty/prebuilds/darwin-arm64/pty.node', 'pty/prebuilds/darwin-arm64/spawn-helper', 'pty/prebuilds/darwin-x64/pty.node', 'pty/prebuilds/darwin-x64/spawn-helper']) assert.ok(platformFiles.includes(name), name);
  assert.deepEqual(platformFiles.filter(name => /^test\/|config\.json$|\.map$|\.test\.js$|^dist\//.test(name)), []);
  assert.deepEqual([platform.name, platform.version, platform.os, platform.cpu, platform.scripts], ['padcode-darwin', version, ['darwin'], ['arm64', 'x64'], undefined]);

  // Install offline, running install scripts if there were any, on a PATH with only node and the shell basics.
  const tools = join(root, 'tools'); await mkdir(tools);
  await symlink(process.execPath, join(tools, 'node'));
  const npmCli = join(dirname(await realpath(spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).stdout.trim())), 'npm-cli.js');
  const bare = { HOME: root, PATH: `${tools}:/bin`, TMPDIR: join(root, 'tmp') }; await mkdir(bare.TMPDIR);
  for (const tool of ['cmake', 'cc', 'clang', 'xcrun', 'make', 'python3']) assert.equal(spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { env: bare }).status, 1, `${tool} is reachable`);
  const npm = (args) => {
    const r = spawnSync(process.execPath, [npmCli, ...args, '--cache', join(root, 'cache'), '--offline', '--no-audit', '--no-fund'], { encoding: 'utf8', timeout: 30000, env: bare });
    assert.equal(r.status, 0, `${r.error ?? ''}\n${r.stderr}\n${r.stdout}`); return r.stdout;
  };
  npm(['install', '--prefix', join(root, 'prefix'), platformTarball, mainTarball]);
  const modules = join(root, 'prefix/node_modules'), installed = join(modules, 'padcode'), bin = join(modules, '.bin/padcode'), helperDir = join(modules, 'padcode-darwin/bin');
  const help = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 5000, env: bare });
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /config/);
  assert.equal(spawnSync(bin, ['--version'], { encoding: 'utf8', env: bare }).stdout.trim(), version);

  // Helpers: architectures, deployment target, signatures with stable identifiers.
  for (const [name, id] of Object.entries(helpers)) {
    const path = join(helperDir, name);
    assert.deepEqual(spawnSync('lipo', ['-archs', path], { encoding: 'utf8' }).stdout.trim().split(/\s+/).sort(), ['arm64', 'x86_64'], name);
    for (const arch of ['arm64', 'x86_64']) assert.match(spawnSync('vtool', ['-arch', arch, '-show-build', path], { encoding: 'utf8' }).stdout, /minos 13\.0\n/, `${name} ${arch}`);
    assert.equal(spawnSync('codesign', ['--verify', '--strict', path]).status, 0, name);
    assert.match(spawnSync('codesign', ['-dv', path], { encoding: 'utf8' }).stderr, new RegExp(`Identifier=com\\.thinxpro\\.padcode\\.${id}\\n`));
  }
  const helper = spawnSync(join(helperDir, 'padcode-controller'), ['--virtual-test', 'playstation'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(helper.status, 0, helper.stderr); assert.match(helper.stdout, /"source":"virtual"/); assert.match(helper.stdout, /"family":"playstation"/);
  const permission = JSON.parse(spawnSync(join(helperDir, 'padcode-bluetooth'), ['diagnose-permission'], { encoding: 'utf8', timeout: 5000 }).stdout);
  assert.equal(permission.selfResponsible, true); assert.equal(permission.usageDescription, true);
  const audio = JSON.parse(spawnSync(join(helperDir, 'padcode-audio'), ['diagnose'], { encoding: 'utf8', timeout: 5000 }).stdout);
  assert.equal(audio.selfResponsible, true); assert.equal(audio.usageDescription, true);

  // Scenarios from the installed copy: onboarding, Agent PTY and gamepad Agent PTY.
  const scenario = (script, arg, timeout) => {
    const r = spawnSync('python3', [script, arg], { encoding: 'utf8', timeout, env: childEnv({ PADCODE_NODE: process.execPath }) });
    assert.equal(r.status, 0, `${script}: ${r.error ?? ''}\n${r.stdout}\n${r.stderr}`);
  };
  scenario('test/onboarding_pty.py', join(installed, 'dist/cli.js'), 20000);
  scenario('test/agent_pty.py', join(installed, 'dist/cli.js'), 25000);
  scenario('test/gamepad-agent-pty.py', installed, 35000);

  // A changed platform manifest and a missing platform package give short messages, not stack traces.
  const manifestPath = join(modules, 'padcode-darwin/platform.json'), original = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, JSON.stringify({ platform: 'wrong-platform', arch: ['wrong-cpu'], version }));
  const mismatch = spawnSync(bin, ['controllers', '--json'], { encoding: 'utf8', timeout: 5000, env: bare });
  assert.equal(mismatch.status, 1); assert.match(mismatch.stderr, /padcode-darwin package was built for wrong-platform\/wrong-cpu/); assert.ok(!mismatch.stderr.includes(' at '));
  await writeFile(manifestPath, original);
  npm(['install', '--prefix', join(root, 'alone'), '--omit=optional', mainTarball]);
  const alone = spawnSync(join(root, 'alone/node_modules/.bin/padcode'), ['controllers', '--json'], { encoding: 'utf8', timeout: 5000, env: bare });
  assert.equal(alone.status, 1); assert.match(alone.stderr, /macOS helpers \(padcode-darwin\) are not installed/); assert.ok(!alone.stderr.includes(' at '));
  assert.equal(spawnSync(join(root, 'alone/node_modules/.bin/padcode'), ['--help'], { env: bare }).status, 0);
});
