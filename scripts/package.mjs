// Stages and packs the two npm packages: `padcode` (JavaScript) and `padcode-darwin` (prebuilt helpers
// and PTY runtime). Never publishes. Usage: node scripts/package.mjs [--out DIR]
// PADCODE_SIGN_IDENTITY: codesign identity (default ad-hoc). PADCODE_SIGN_TIMESTAMP=off skips the secure timestamp.
import { cp, mkdir, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { bundlePty, ptySource } from './pty-bundle.mjs';

const fail = message => { console.error(`package: ${message}`); process.exit(1); };
if (process.platform !== 'darwin') fail('packages are built on macOS only.');
const outIndex = process.argv.indexOf('--out');
const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] ?? fail('--out needs a directory.') : 'artifacts');
const root = JSON.parse(await readFile('package.json', 'utf8'));
const version = root.version, minos = '13.0', archs = ['arm64', 'x86_64'];
const helpers = [
  { name: 'padcode-controller', id: 'com.thinxpro.padcode.controller' },
  { name: 'padcode-bluetooth', id: 'com.thinxpro.padcode.bluetooth', entitlements: 'native/bluetooth.entitlements' },
  { name: 'padcode-audio', id: 'com.thinxpro.padcode.audio', entitlements: 'native/audio.entitlements' },
];
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...(cwd ? { cwd } : {}) });
  if (result.error) fail(`${command}: ${result.error.message}`);
  return result;
};

try { await access('dist/cli.js'); } catch { fail('run `npm run build` first.'); }
const built = JSON.parse(await readFile('build/native/platform.json', 'utf8').catch(() => fail('run `npm run build:native` first.')));
if (!Array.isArray(built.arch) || !['arm64', 'x64'].every(arch => built.arch.includes(arch))) fail('build/native is not a universal build; rerun `npm run build:native`.');

const stage = resolve('build/release'), darwin = join(stage, 'padcode-darwin'), main = join(stage, 'padcode');
await rm(stage, { recursive: true, force: true });
await mkdir(join(darwin, 'bin'), { recursive: true });
await mkdir(main, { recursive: true });

// Platform package: helpers, both node-pty macOS prebuilds and a manifest the CLI checks at runtime.
for (const helper of helpers) {
  await cp(join('build/native', helper.name), join(darwin, 'bin', helper.name));
  await chmod(join(darwin, 'bin', helper.name), 0o755);
}
await bundlePty(join(darwin, 'pty'), { 'darwin-arm64': join(ptySource, 'prebuilds/darwin-arm64'), 'darwin-x64': join(ptySource, 'prebuilds/darwin-x64') });
await writeFile(join(darwin, 'platform.json'), JSON.stringify({ platform: 'darwin', arch: ['arm64', 'x64'], minos, version }) + '\n');
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(file, join(darwin, file));
await writeFile(join(darwin, 'README.md'), `# padcode-darwin\n\nPrebuilt macOS helpers (gamepad, Bluetooth, microphone and speech) and the PTY runtime for [Padcode](https://github.com/thinxpro/padcode) ${version}. Universal (Apple silicon and Intel), macOS ${minos} or later. Installed automatically with \`padcode\`; not meant to be used directly.\n`);
const common = { version, license: root.license, ...(root.private ? { private: true } : {}), repository: { type: 'git', url: 'git+https://github.com/thinxpro/padcode.git' } };
await writeFile(join(darwin, 'package.json'), JSON.stringify({
  name: 'padcode-darwin', ...common, description: `Prebuilt macOS helpers for Padcode ${version}`,
  os: ['darwin'], cpu: ['arm64', 'x64'], files: ['bin/', 'pty/', 'platform.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'],
}, null, 2) + '\n');

// Main package: JavaScript only, with the platform package as an exact optional dependency.
for (const file of ['dist', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md']) await cp(file, join(main, file), { recursive: true });
await writeFile(join(main, 'package.json'), JSON.stringify({
  name: root.name, ...common, description: root.description, type: root.type, bin: root.bin,
  files: ['dist/', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'], engines: root.engines,
  optionalDependencies: { 'padcode-darwin': version },
}, null, 2) + '\n');

// Signing: ad-hoc by default; a real identity adds hardened runtime, entitlements and a timestamp.
const identity = process.env.PADCODE_SIGN_IDENTITY?.trim() || '-';
for (const helper of helpers) {
  const path = join(darwin, 'bin', helper.name);
  const args = ['--force', '--sign', identity, '--identifier', helper.id];
  if (identity === '-') args.push('--timestamp=none');
  else {
    args.push('--options', 'runtime', process.env.PADCODE_SIGN_TIMESTAMP === 'off' ? '--timestamp=none' : '--timestamp');
    if (helper.entitlements) args.push('--entitlements', helper.entitlements);
  }
  const signed = run('codesign', [...args, path]);
  if (signed.status !== 0) { await rm(stage, { recursive: true, force: true }); fail(`signing ${helper.name} with "${identity}" failed: ${signed.stderr.trim()}`); }
}

// Verification: both architectures, deployment target, strict signature and identifier.
const problems = [];
const version13 = text => { const [major, minor = 0] = text.split('.').map(Number); return major * 100 + minor; };
for (const helper of helpers) {
  const path = join(darwin, 'bin', helper.name);
  const present = run('lipo', ['-archs', path]).stdout.trim().split(/\s+/);
  for (const arch of archs) {
    if (!present.includes(arch)) { problems.push(`${helper.name}: missing ${arch}`); continue; }
    const found = /minos (\S+)/.exec(run('vtool', ['-arch', arch, '-show-build', path]).stdout)?.[1];
    if (!found || version13(found) > version13(minos)) problems.push(`${helper.name} ${arch}: minimum macOS ${found ?? 'unknown'}, expected ${minos} or lower`);
  }
  const verify = run('codesign', ['--verify', '--strict', path]);
  if (verify.status !== 0) problems.push(`${helper.name}: ${verify.stderr.trim()}`);
  const details = run('codesign', ['-dv', path]).stderr;
  if (!details.includes(`Identifier=${helper.id}\n`)) problems.push(`${helper.name}: identifier is not ${helper.id}`);
}
for (const dir of [darwin, main]) {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  if (pkg.scripts) problems.push(`${pkg.name}: install scripts are not allowed`);
}
if (problems.length) { await rm(stage, { recursive: true, force: true }); fail(`verification failed:\n  ${problems.join('\n  ')}`); }

await mkdir(out, { recursive: true });
const tarballs = [];
for (const dir of [darwin, main]) {
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], dir);
  if (packed.status !== 0) fail(`npm pack failed in ${dir}: ${packed.stderr.trim()}`);
  tarballs.push(join(out, JSON.parse(packed.stdout)[0].filename));
}
console.log(`Packed (${identity === '-' ? 'ad-hoc signed' : `signed by ${identity}`}):\n  ${tarballs.join('\n  ')}`);
console.log(`Install: npm install -g ${tarballs.map(path => JSON.stringify(path)).join(' ')}`);
