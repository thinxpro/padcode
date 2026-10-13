// Release logic shared by packaging and the release check. Pure functions, no I/O.

// Semantic Versioning 2.0.0 precedence: numeric core, then prerelease identifiers; build metadata is ignored.
function parse(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`not a semantic version: ${version}`);
  return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] };
}

export function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  // A version without prerelease identifiers ranks above any prerelease of the same core.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// The highest version any dist-tag points at, or undefined when nothing is tagged.
export function highestVersion(distTags) {
  return Object.values(distTags ?? {}).filter(value => typeof value === 'string').reduce((best, version) => !best || compareVersions(version, best) > 0 ? version : best, undefined);
}

export const distTagFor = version => parse(version).pre.length ? 'next' : 'latest';

// The body of the `## [<version>]` section in a Keep a Changelog file, or undefined when there is none.
export function changelogEntry(text, version) {
  const lines = text.split('\n'), start = lines.findIndex(line => line.startsWith(`## [${version}]`));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && (line.startsWith('## ') || /^\[[^\]]+\]: /.test(line)));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}
