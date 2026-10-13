import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { changelogEntry, compareVersions, distTagFor, highestVersion } from '../scripts/release-lib.mjs';
import { startRegistry } from './fixtures/registry.mjs';

test('A3 versions follow SemVer precedence', () => {
  const ordered = ['0.1.0-alpha', '0.1.0-alpha.1', '0.1.0-alpha.beta', '0.1.0-beta.2', '0.1.0-beta.11', '0.1.0-rc.1', '0.1.0-rc.9', '0.1.0-rc.10', '0.1.0', '0.1.1', '0.2.0', '1.0.0'];
  for (let i = 0; i < ordered.length; i++) for (let j = 0; j < ordered.length; j++) {
    assert.equal(compareVersions(ordered[i], ordered[j]), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
  }
  assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0);
  assert.throws(() => compareVersions('1.0', '1.0.0'), /not a semantic version: 1\.0/);
  assert.equal(highestVersion({ latest: '0.1.0-rc.9', next: '0.1.0-rc.10' }), '0.1.0-rc.10');
  assert.equal(highestVersion({ latest: '0.1.0', next: '0.1.0-rc.10' }), '0.1.0');
  assert.equal(highestVersion({ next: '0.2.0-rc.1' }), '0.2.0-rc.1');
  assert.equal(highestVersion({}), undefined); assert.equal(highestVersion(undefined), undefined);
  assert.deepEqual(['0.1.0-rc.10', '0.1.0', '1.2.3-beta'].map(distTagFor), ['next', 'latest', 'next']);
});

test('A4 changelog entries are read from the version heading to the next heading or link list', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\nWork.\n\n## [0.1.0-rc.11] - 2026-10-13\n\n### Added\n\n- First public build.\n\n## [0.1.0-rc.10]\n\nOlder.\n\n[Unreleased]: https://example.invalid\n';
  assert.equal(changelogEntry(text, '0.1.0-rc.11'), '### Added\n\n- First public build.');
  assert.equal(changelogEntry(text, '0.1.0-rc.10'), 'Older.');
  assert.equal(changelogEntry(text, '0.1.0-rc.1'), undefined);
});

// Runs the release check asynchronously so the in-process stub registry can answer npm.
const script = resolve('scripts/release-check.mjs');
const check = (cwd, args, env) => new Promise(done => execFile(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 },
  (error, stdout, stderr) => done({ status: error ? error.code : 0, stdout, stderr })));

async function fixture(root, version, { manifests = {}, changelog = true } = {}) {
  const dir = join(root, version); await mkdir(join(dir, 'artifacts'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'padcode-cli', version, private: true }));
  await writeFile(join(dir, 'CHANGELOG.md'), changelog ? `# Changelog\n\n## [${version}] - 2026-10-13\n\n- Notes for ${version}.\n` : '# Changelog\n');
  const defaults = { 'padcode-darwin': { name: 'padcode-darwin', version }, 'padcode-cli': { name: 'padcode-cli', version, optionalDependencies: { 'padcode-darwin': version } } };
  for (const name of ['padcode-darwin', 'padcode-cli']) {
    if (manifests[name] === null) continue;
    const pkg = join(dir, 'stage', name, 'package'); await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ ...defaults[name], ...manifests[name] }));
    assert.equal(spawnSync('tar', ['-czf', join(dir, 'artifacts', `${name}-${version}.tgz`), '-C', join(dir, 'stage', name), 'package']).status, 0);
  }
  return dir;
}

test('A4 release check accepts valid releases and rejects each kind of broken one', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'padcode-release-')); t.after(() => rm(root, { recursive: true, force: true }));
  const registry = await startRegistry({
    'padcode-cli': { 'dist-tags': { next: '0.1.0-rc.12' }, versions: { '0.1.0-rc.12': '/dev/null' } },
    'padcode-darwin': { 'dist-tags': { next: '0.1.0-rc.13' }, versions: { '0.1.0-rc.12': '/dev/null', '0.1.0-rc.13': '/dev/null' } },
  });
  t.after(() => registry.close());
  const env = { npm_config_registry: registry.url, npm_config_cache: join(root, 'cache') };

  // A valid prerelease: dist-tag next, both packages to publish, outputs and notes written.
  const rc = await fixture(root, '0.1.0-rc.11'), output = join(root, 'github-output');
  const ok = await check(rc, ['--tag', 'v0.1.0-rc.11', '--dir', 'artifacts', '--notes', join(root, 'notes.md')], { ...env, GITHUB_OUTPUT: output });
  assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /Release 0\.1\.0-rc\.11 is ready: npm dist-tag next; padcode-darwin@0\.1\.0-rc\.11 will be published/);
  assert.equal(await readFile(output, 'utf8'), 'dist-tag=next\npublish-darwin=true\n');
  assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), '- Notes for 0.1.0-rc.11.\n');

  // A valid stable version goes to latest.
  const stable = await fixture(root, '0.1.0');
  const latest = await check(stable, ['--tag', 'v0.1.0', '--dir', 'artifacts'], env);
  assert.equal(latest.status, 0, latest.stderr); assert.match(latest.stdout, /npm dist-tag latest/);

  // Recovery: padcode-darwin is already published for this version, padcode is not.
  const half = await fixture(root, '0.1.0-rc.13'), halfOutput = join(root, 'half-output');
  const resumed = await check(half, ['--tag', 'v0.1.0-rc.13', '--dir', 'artifacts'], { ...env, GITHUB_OUTPUT: halfOutput });
  assert.equal(resumed.status, 0, resumed.stderr); assert.match(resumed.stdout, /padcode-darwin@0\.1\.0-rc\.13 is already published and will be skipped/);
  assert.equal(await readFile(halfOutput, 'utf8'), 'dist-tag=next\npublish-darwin=false\n');

  const fails = async (dir, tag, expected) => {
    const r = await check(dir, ['--tag', tag, '--dir', 'artifacts'], env);
    assert.equal(r.status, 1, `${tag}: ${r.stdout}`); assert.match(r.stderr, expected); assert.equal(r.stdout, '');
  };
  await fails(rc, 'v0.1.0-rc.10', /tag v0\.1\.0-rc\.10 does not match package\.json version 0\.1\.0-rc\.11/);
  await fails(await fixture(join(root, 'missing'), '0.1.0-rc.11', { manifests: { 'padcode-cli': null } }), 'v0.1.0-rc.11', /padcode-cli: .*padcode-cli-0\.1\.0-rc\.11\.tgz is missing/);
  await fails(await fixture(join(root, 'skew'), '0.1.0-rc.11', { manifests: { 'padcode-darwin': { version: '0.1.0-rc.10' } } }), 'v0.1.0-rc.11', /padcode-darwin: manifest version 0\.1\.0-rc\.10, expected 0\.1\.0-rc\.11/);
  await fails(await fixture(join(root, 'private'), '0.1.0-rc.11', { manifests: { 'padcode-cli': { private: true } } }), 'v0.1.0-rc.11', /padcode-cli: manifest is private; package with --release/);
  await fails(await fixture(join(root, 'pin'), '0.1.0-rc.11', { manifests: { 'padcode-cli': { optionalDependencies: { 'padcode-darwin': '^0.1.0-rc.11' } } } }), 'v0.1.0-rc.11', /optional dependency padcode-darwin is \^0\.1\.0-rc\.11, expected exactly 0\.1\.0-rc\.11/);
  await fails(await fixture(join(root, 'log'), '0.1.0-rc.11', { changelog: false }), 'v0.1.0-rc.11', /CHANGELOG\.md has no "## \[0\.1\.0-rc\.11\]" entry/);
  await fails(await fixture(root, '0.1.0-rc.12'), 'v0.1.0-rc.12', /padcode-cli@0\.1\.0-rc\.12 is already published/);

  // An unreachable registry is a problem, not "not published".
  const offline = await check(rc, ['--tag', 'v0.1.0-rc.11', '--dir', 'artifacts'], { ...env, npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0' });
  assert.equal(offline.status, 1); assert.match(offline.stderr, /could not ask the registry about padcode-cli@0\.1\.0-rc\.11/);

  const usage = await check(rc, ['--dir', 'artifacts'], env);
  assert.equal(usage.status, 1); assert.match(usage.stderr, /usage: release-check\.mjs --tag TAG --dir DIR/);
});

test('A5 release workflow publishes from tags with trusted publishing behind the npm environment', async () => {
  const text = await readFile('.github/workflows/release.yml', 'utf8');
  const job = name => { const start = text.indexOf(`\n  ${name}:\n`); assert.ok(start > 0, name); const next = text.slice(start + 1).search(/\n  [a-z-]+:\n/); return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next); };
  const build = job('build'), publish = job('publish');
  assert.match(text, /\non:\n  push:\n    tags: \['v\*'\]\npermissions:\n  contents: read\n/);
  assert.doesNotMatch(text, /\n  (pull_request|workflow_dispatch|schedule):/); assert.doesNotMatch(text, /branches:/);
  assert.match(build, /runs-on: macos-latest/);
  const order = (block, ...steps) => { let at = -1; for (const step of steps) { const found = block.indexOf(step); assert.ok(found > at, `${step} out of order`); at = found; } };
  order(build, 'npm ci --ignore-scripts', 'npm run check', 'npm run package -- --release', 'scripts/release-check.mjs --tag "$GITHUB_REF_NAME"', 'shasum -a 256');
  assert.doesNotMatch(build, /id-token/); assert.match(publish, /environment: npm\n/); assert.match(publish, /id-token: write/);
  assert.equal(text.match(/id-token: write/g).length, 1);
  order(publish, 'npm install -g npm@^11.5.1', 'npm publish "./artifacts/padcode-darwin-', 'npm publish "./artifacts/padcode-cli-${', 'gh release create');
  // Without ./ npm reads `artifacts/<file>.tgz` as a GitHub `user/repo` shorthand and tries git over SSH.
  for (const line of publish.match(/npm publish .*/g)) assert.match(line, /npm publish "\.\//, line);
  assert.match(publish, /if: needs\.build\.outputs\.publish-darwin == 'true'/);
  assert.match(publish, /gh release create [^\n]*\\\n\s+"artifacts\/padcode-darwin-\$\{GITHUB_REF_NAME#v\}\.tgz" "artifacts\/padcode-cli-\$\{GITHUB_REF_NAME#v\}\.tgz" artifacts\/SHA256SUMS/);
  assert.equal(publish.match(/npm publish .* --tag "\$DIST_TAG"/g).length, 2);
  assert.equal(publish.match(/DIST_TAG: \$\{\{ needs\.build\.outputs\.dist-tag \}\}/g).length, 3);
  assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  assert.match(text, /concurrency:\n  group: release\n  cancel-in-progress: false\n/);
});
