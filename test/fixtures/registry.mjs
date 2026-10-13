// A minimal read-only npm registry for tests: packuments with dist-tags and tarballs served from local files.
// Usage: const registry = await startRegistry({ 'padcode-darwin': { 'dist-tags': {...}, versions: { '1.0.0': '/path/x.tgz' } } });
// Point npm at it with `npm_config_registry: registry.url`; call registry.close() when done.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

export async function startRegistry(packages) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://registry').pathname.slice(1));
    const tarball = /^(.+)\/-\/(.+)$/.exec(path);
    if (tarball && packages[tarball[1]]) {
      const file = Object.entries(packages[tarball[1]].versions ?? {}).find(([version]) => `${tarball[1]}-${version}.tgz` === tarball[2])?.[1];
      if (file) { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(await readFile(file)); return; }
    }
    const entry = packages[path];
    if (!entry || request.method !== 'GET') { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":"Not found"}'); return; }
    const base = `http://127.0.0.1:${server.address().port}`;
    const versions = Object.fromEntries(Object.keys(entry.versions ?? {}).map(version => [version, { name: path, version, dist: { tarball: `${base}/${path}/-/${path}-${version}.tgz` } }]));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name: path, 'dist-tags': entry['dist-tags'] ?? {}, versions }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => server.close(resolve)) };
}
