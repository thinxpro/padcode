// Checks a packaged release before publishing. Usage: node scripts/release-check.mjs --tag TAG --dir DIR [--notes FILE]
// Prints one line per problem and exits 1, or prints the npm dist-tag and whether padcode-darwin still needs
// publishing (also written to $GITHUB_OUTPUT as `dist-tag` and `publish-darwin`). Never publishes.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { changelogEntry, distTagFor } from './release-lib.mjs';

const option = name => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const tag = option('--tag'), dir = option('--dir'), notes = option('--notes');
if (!tag || !dir) { console.error('release-check: usage: release-check.mjs --tag TAG --dir DIR [--notes FILE]'); process.exit(1); }

// The CLI package is named in package.json (`padcode-cli`); the platform package is always padcode-darwin.
const { name: cli, version } = JSON.parse(await readFile('package.json', 'utf8'));
const problems = [];
if (tag !== `v${version}`) problems.push(`tag ${tag} does not match package.json version ${version} (expected v${version})`);

const manifestOf = tarball => {
  const r = spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout) : undefined;
};
for (const name of ['padcode-darwin', cli]) {
  const tarball = join(dir, `${name}-${version}.tgz`);
  if (!existsSync(tarball)) { problems.push(`${name}: ${tarball} is missing`); continue; }
  const manifest = manifestOf(tarball);
  if (!manifest) { problems.push(`${name}: ${tarball} has no package.json`); continue; }
  if (manifest.name !== name) problems.push(`${name}: tarball contains ${manifest.name}`);
  if (manifest.version !== version) problems.push(`${name}: manifest version ${manifest.version}, expected ${version}`);
  if (manifest.private) problems.push(`${name}: manifest is private; package with --release`);
  if (name === cli && manifest.optionalDependencies?.['padcode-darwin'] !== version) problems.push(`${cli}: optional dependency padcode-darwin is ${manifest.optionalDependencies?.['padcode-darwin'] ?? 'missing'}, expected exactly ${version}`);
}

const entry = changelogEntry(await readFile('CHANGELOG.md', 'utf8').catch(() => ''), version);
if (!entry) problems.push(`CHANGELOG.md has no "## [${version}]" entry`);

// npm answers E404 both when the package and when that version does not exist; anything else is a registry error.
const isPublished = name => {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8', timeout: 60000 });
  if (r.status === 0) return true;
  if (/E404|404 Not Found/.test(r.stderr)) return false;
  problems.push(`could not ask the registry about ${name}@${version}: ${(r.error?.message ?? r.stderr.split('\n').find(line => /error/i.test(line)) ?? 'npm view failed').trim()}`);
  return undefined;
};
if (isPublished(cli)) problems.push(`${cli}@${version} is already published`);
const darwinPublished = isPublished('padcode-darwin');

if (problems.length) { console.error(`release-check: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`); process.exit(1); }

const distTag = distTagFor(version), publishDarwin = !darwinPublished;
if (notes) await writeFile(notes, `${entry}\n`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `dist-tag=${distTag}\npublish-darwin=${publishDarwin}\n`);
console.log(`Release ${version} is ready: npm dist-tag ${distTag}; padcode-darwin@${version} ${publishDarwin ? 'will be published' : 'is already published and will be skipped'}.`);
