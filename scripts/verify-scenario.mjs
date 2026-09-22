import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

// Use a separate port so verification does not interrupt the user's running demo.
const port = process.env.VERIFY_PORT || '4174';
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const readiness = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('server did not start within 2 seconds')), 2000);
  child.stdout.on('data', chunk => {
    output += chunk;
    if (/listening on/.test(output)) { clearTimeout(timeout); resolve(); }
  });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('error', error => { clearTimeout(timeout); reject(error); });
});
try {
  await readiness;
  assert.match(output, /http:\/\/127\.0\.0\.1:\d+/);
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'gs-ai-live-integrated-prototype' });
  for (const path of ['/index.html', '/director.html', '/director.js', '/director-features.css', '/mobile.html', '/mobile.css', '/mobile.js', '/gs-live-data.js', '/gs-live-config.js', '/gs-ai-live-state.js', '/assets/mobile/product.jpg', '/assets/mobile/lookbook.jpg', '/assets/mobile/bottom.jpg', '/assets/reference-video.mp4']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
  }
  const media = await fetch(`${origin}/assets/reference-video.mp4`, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(media.status, 206);
  assert.equal((await media.arrayBuffer()).byteLength, 1024);
  console.log('HTTP verification passed: health, both screens, bridge, and MP4 are served.');
} finally {
  child.kill('SIGTERM');
}
