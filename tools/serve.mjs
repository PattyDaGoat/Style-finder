// Serves dist/ so you can open the app over http instead of file://.
//
//     npm run serve
//
// This used to be `cd dist && python3 -m http.server 8000`, which assumes a
// command called `python3`. macOS and Linux have one; Windows does not — there
// the launcher is `python`, so `npm run serve` failed with "python3 is not
// recognized". Node is already required to build this project, so serving with
// Node removes the dependency on Python entirely.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/style-finder.html';
    // normalize first, then confirm the result is still inside dist/ — without
    // this, a request for /../../etc/passwd would escape the served directory
    const full = join(DIST, normalize(rel));
    // `startsWith(DIST)` alone would also accept a sibling directory called
    // dist-something; the separator check pins it to dist/ itself.
    if (full !== DIST && !full.startsWith(DIST + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(full);
    if (info.isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
    }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`serving dist/ on http://localhost:${PORT}`);
  console.log('press Ctrl+C to stop');
});
