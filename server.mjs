import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicRoot = resolve(projectRoot, 'public');
const assetsRoot = resolve(projectRoot, 'assets');
const port = Number(process.env.PORT || 4173);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function safePath(root, pathname) {
  const candidate = resolve(root, `.${pathname}`);
  return candidate.startsWith(`${root}/`) ? candidate : null;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true, service: 'gs-ai-live-integrated-prototype' }));
      return;
    }
    const root = url.pathname.startsWith('/assets/') ? assetsRoot : publicRoot;
    const requested = url.pathname === '/' ? '/index.html' : url.pathname.startsWith('/assets/') ? url.pathname.slice('/assets'.length) : url.pathname;
    const filePath = safePath(root, requested);
    if (!filePath) {
      response.writeHead(400); response.end('Bad Request'); return;
    }
    const metadata = await stat(filePath);
    const contentType = mime[extname(filePath)] || 'application/octet-stream';
    const range = request.headers.range;
    if (range && range.startsWith('bytes=')) {
      const [rawStart, rawEnd] = range.slice('bytes='.length).split('-', 2);
      const start = rawStart ? Number(rawStart) : Math.max(0, metadata.size - Number(rawEnd || 0));
      const end = rawEnd ? Math.min(metadata.size - 1, Number(rawEnd)) : metadata.size - 1;
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end < metadata.size) {
        const body = await readFile(filePath);
        const chunk = body.subarray(start, end + 1);
        response.writeHead(206, {
          'content-type': contentType,
          'content-length': chunk.length,
          'content-range': `bytes ${start}-${end}/${metadata.size}`,
          'cache-control': 'no-store',
          'accept-ranges': 'bytes',
        });
        response.end(chunk);
        return;
      }
      response.writeHead(416, { 'content-range': `bytes */${metadata.size}` });
      response.end();
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
    });
    response.end(body);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(status === 404 ? 'Not Found' : 'Internal Server Error');
  }
});

server.on('error', error => {
  console.error(`GS AI LIVE prototype server error: ${error.code || error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`GS AI LIVE prototype listening on http://127.0.0.1:${port}`);
});
