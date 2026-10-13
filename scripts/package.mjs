// Stages and packs the two npm packages: `padcode` (JavaScript) and `padcode-darwin` (prebuilt helpers
// and PTY runtime). Never publishes. Usage: node scripts/package.mjs [--out DIR] [--reuse SPEC | --fresh]
// PADCODE_SIGN_IDENTITY: codesign identity (default ad-hoc). PADCODE_SIGN_TIMESTAMP=off skips the secure timestamp.
// Helpers are reused byte for byte from a previous padcode-darwin (default: padcode-darwin@latest from npm, or a
// tarball path) when the native sources and the signer are unchanged, so macOS keeps users' permission grants.
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile, chmod, rm, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bundlePty, ptySource } from './pty-bundle.mjs';

const fail = message => { console.error(`package: ${message}`); process.exit(1); };
if (process.platform !== 'darwin') fail('packages are built on macOS only.');
const outIndex = process.argv.indexOf('--out');
const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] ?? fail('--out needs a directory.') : 'artifacts');
const reuseIndex = process.argv.indexOf('--reuse');
const reuseSpec = process.argv.includes('--fresh') ? undefined : reuseIndex > 0 ? process.argv[reuseIndex + 1] ?? fail('--reuse needs a package spec or tarball.') : 'padcode-darwin@latest';
const root = JSON.parse(await readFile('package.json', 'utf8'));
const version = root.version, minos = '13.0', archs = ['arm64', 'x86_64'];
const helpers = [
  { name: 'padcode-controller', id: 'com.thinxpro.padcode.controller' },
  { name: 'padcode-bluetooth', id: 'com.thinxpro.padcode.bluetooth', entitlements: 'native/bluetooth.entitlements' },
  { name: 'padcode-audio', id: 'com.thinxpro.padcode.audio', entitlements: 'native/audio.entitlements' },
];
const run = (command, args, cwd, timeout) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...(cwd ? { cwd } : {}), ...(timeout ? { timeout } : {}) });
  if (result.error) fail(`${command}: ${result.error.message}`);
  return result;
};

try { await access('dist/cli.js'); } catch { fail('run `npm run build` first.'); }
const built = JSON.parse(await readFile('build/native/platform.json', 'utf8').catch(() => fail('run `npm run build:native` first.')));
if (!Array.isArray(built.arch) || !['arm64', 'x64'].every(arch => built.arch.includes(arch))) fail('build/native is not a universal build; rerun `npm run build:native`.');

// Everything that decides the helper binaries: native sources, CMake settings (SDL pin, targets) and the build script.
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(path)); else found.push(path);
  }
  return found;
}
const hash = createHash('sha256');
for (const path of [...await files('native'), 'scripts/build-native.mjs'].sort()) hash.update(`${relative('.', path)}\0`).update(await readFile(path)).update('\0');
const source = hash.digest('hex');
const identity = process.env.PADCODE_SIGN_IDENTITY?.trim() || '-';
// Ad-hoc grants follow the exact binary; certificate grants follow the team (the certificate's OU), so the
// signer must match too. The name's parenthesised code is not always the team ID (Apple Development).
function teamOf(name) {
  const pem = spawnSync('security', ['find-certificate', '-c', name, '-p'], { encoding: 'utf8' });
  if (pem.status !== 0 || !pem.stdout.includes('BEGIN CERTIFICATE')) return undefined;
  const subject = spawnSync('openssl', ['x509', '-noout', '-subject'], { input: pem.stdout.split(/(?<=-----END CERTIFICATE-----\n?)/)[0], encoding: 'utf8' });
  return /OU\s*=\s*([A-Z0-9]{10})\b/.exec(subject.stdout)?.[1];
}
const signer = identity === '-' ? 'adhoc' : teamOf(identity);

const version13 = text => { const [major, minor = 0] = text.split('.').map(Number); return major * 100 + minor; };
function inspect(helper, path) {
  const problems = [];
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
  const team = /TeamIdentifier=(\S+)/.exec(details)?.[1];
  const actual = details.includes('Signature=adhoc') ? 'adhoc' : team;
  return { problems, signer: actual };
}

// Finds a previous platform package whose helpers can be reused unchanged, or explains why not.
async function previous(spec) {
  if (!signer) return { reason: 'the team of the signing identity could not be read from the keychain' };
  const temp = await mkdtemp(join(tmpdir(), 'padcode-reuse-'));
  try {
    const target = existsSync(spec) ? resolve(spec) : spec;
    const packed = run('npm', ['pack', target, '--json', '--ignore-scripts', '--pack-destination', temp], temp, 60000);
    if (packed.status !== 0) return { reason: `${spec} is not available (${(packed.stderr.split('\n').find(line => /error/i.test(line)) ?? 'npm pack failed').trim()})` };
    const tarball = join(temp, JSON.parse(packed.stdout)[0].filename);
    if (run('tar', ['-xzf', tarball, '-C', temp]).status !== 0) return { reason: `${spec} could not be unpacked` };
    const manifest = JSON.parse(await readFile(join(temp, 'package/platform.json'), 'utf8').catch(() => '{}'));
    const label = `${spec} (${manifest.version ?? 'unknown version'})`;
    if (manifest.native?.source !== source) return { reason: `native sources changed since ${label}` };
    if (manifest.native?.signer !== signer) return { reason: `${label} was signed by ${manifest.native?.signer ?? 'unknown'}, now ${signer}` };
    const helperFiles = {};
    for (const helper of helpers) {
      const path = join(temp, 'package/bin', helper.name);
      if (!existsSync(path)) return { reason: `${label} has no ${helper.name}` };
      const checked = inspect(helper, path);
      if (checked.problems.length) return { reason: `${label} failed verification: ${checked.problems[0]}` };
      if (checked.signer !== signer) return { reason: `${label} ${helper.name} is signed by ${checked.signer}, now ${signer}` };
      helperFiles[helper.name] = await readFile(path);
    }
    return { files: helperFiles, since: manifest.native.since ?? manifest.version, label };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
const reuse = reuseSpec ? await previous(reuseSpec) : { reason: '--fresh' };

const stage = resolve('build/release'), darwin = join(stage, 'padcode-darwin'), main = join(stage, 'padcode');
await rm(stage, { recursive: true, force: true });
await mkdir(join(darwin, 'bin'), { recursive: true });
await mkdir(main, { recursive: true });

// Platform package: helpers, both node-pty macOS prebuilds and a manifest the CLI checks at runtime.
for (const helper of helpers) {
  const path = join(darwin, 'bin', helper.name);
  if (reuse.files) await writeFile(path, reuse.files[helper.name]); else await cp(join('build/native', helper.name), path);
  await chmod(path, 0o755);
}
await bundlePty(join(darwin, 'pty'), { 'darwin-arm64': join(ptySource, 'prebuilds/darwin-arm64'), 'darwin-x64': join(ptySource, 'prebuilds/darwin-x64') });
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(file, join(darwin, file));
await writeFile(join(darwin, 'README.md'), `# padcode-darwin\n\nPrebuilt macOS helpers (gamepad, Bluetooth, microphone and speech) and the PTY runtime for [Padcode](https://github.com/thinxpro/padcode) ${version}. Universal (Apple silicon and Intel), macOS ${minos} or later. Installed automatically with \`padcode\`; not meant to be used directly.\n`);
const common = { version, license: root.license, ...(root.private ? { private: true } : {}), author: root.author, homepage: root.homepage, bugs: root.bugs, repository: root.repository };
await writeFile(join(darwin, 'package.json'), JSON.stringify({
  name: 'padcode-darwin', ...common, description: `Prebuilt macOS helpers for Padcode ${version}`,
  os: ['darwin'], cpu: ['arm64', 'x64'], files: ['bin/', 'pty/', 'platform.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'],
}, null, 2) + '\n');

// Main package: JavaScript only, with the platform package as an exact optional dependency.
for (const file of ['dist', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md']) await cp(file, join(main, file), { recursive: true });
await writeFile(join(main, 'package.json'), JSON.stringify({
  name: root.name, ...common, description: root.description, keywords: root.keywords, type: root.type, bin: root.bin,
  files: ['dist/', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'], engines: root.engines,
  optionalDependencies: { 'padcode-darwin': version },
}, null, 2) + '\n');

// Signing: ad-hoc by default; a real identity adds hardened runtime, entitlements and a timestamp.
// Reused helpers keep their original signature untouched.
for (const helper of reuse.files ? [] : helpers) {
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

// Verification: both architectures, deployment target, strict signature and identifier, fresh or reused.
const problems = [], signers = new Set();
for (const helper of helpers) {
  const checked = inspect(helper, join(darwin, 'bin', helper.name));
  problems.push(...checked.problems); signers.add(checked.signer);
}
if (signers.size !== 1 || (signer && !signers.has(signer))) problems.push(`helpers are signed by ${[...signers].join(', ')}, expected ${signer ?? 'one signer'}`);
for (const dir of [darwin, main]) {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  if (pkg.scripts) problems.push(`${pkg.name}: install scripts are not allowed`);
}
if (problems.length) { await rm(stage, { recursive: true, force: true }); fail(`verification failed:\n  ${problems.join('\n  ')}`); }
// The manifest records what later packages compare before reusing these helpers.
await writeFile(join(darwin, 'platform.json'), JSON.stringify({ platform: 'darwin', arch: ['arm64', 'x64'], minos, version, native: { source, signer: [...signers][0], since: reuse.files ? reuse.since : version } }) + '\n');

await mkdir(out, { recursive: true });
const tarballs = [];
for (const dir of [darwin, main]) {
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], dir);
  if (packed.status !== 0) fail(`npm pack failed in ${dir}: ${packed.stderr.trim()}`);
  tarballs.push(join(out, JSON.parse(packed.stdout)[0].filename));
}
console.log(reuse.files ? `Helpers: reused unchanged from ${reuse.label}, first built for ${reuse.since}.` : `Helpers: built fresh (${reuse.reason}).`);
console.log(`Packed (${reuse.files ? `reused ${signer === 'adhoc' ? 'ad-hoc' : signer} signature` : identity === '-' ? 'ad-hoc signed' : `signed by ${identity}`}):\n  ${tarballs.join('\n  ')}`);
console.log(`Install: npm install -g ${tarballs.map(path => JSON.stringify(path)).join(' ')}`);
