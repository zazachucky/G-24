import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = () => execFileSync(process.execPath, ['scripts/build-static.mjs'], { cwd: root });
async function files(directory) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) list.push(...await files(path)); else list.push(path);
  }
  return list;
}

test('static deployment contains the same public source/assets and excludes private material', async () => {
  build();
  for (const directory of ['public', 'assets']) {
    for (const path of await files(join(root, directory))) {
      const destination = directory === 'public' ? relative(join(root, directory), path) : relative(root, path);
      assert.deepEqual(await readFile(join(root, 'dist', destination)), await readFile(path), destination);
    }
  }
  const outputFiles = (await files(join(root, 'dist'))).map(path => relative(join(root, 'dist'), path));
  assert.ok(outputFiles.includes('mobile.html') && outputFiles.includes('director.html'));
  assert.equal(outputFiles.filter(path => path.endsWith('.mp4')).length, 1);
  assert.ok(!outputFiles.some(path => /(^|\/)(?:\.git|\.codex|api|docs|scripts|reference|artifacts|submission-logs)(\/|$)|\.(?:jsonl|zip|log)$/.test(path)));
  assert.deepEqual(JSON.parse(await readFile(join(root, 'dist', 'health'), 'utf8')), { ok: true, service: 'gs-ai-live-integrated-prototype' });
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'npm run build');
  assert.ok(!config.functions);
  assert.ok(config.redirects.some(route => route.source === '/app/customer.html' && route.destination === '/mobile.html'));
  assert.ok(config.redirects.some(route => route.source === '/app/director.html' && route.destination === '/director.html'));
});

test('rebuild removes stale generated files instead of deploying leftovers', async () => {
  await writeFile(join(root, 'dist', 'stale-generated-test.txt'), 'generated test fixture');
  build();
  await assert.rejects(access(join(root, 'dist', 'stale-generated-test.txt')), { code: 'ENOENT' });
});
