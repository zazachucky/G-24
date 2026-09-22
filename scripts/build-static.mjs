import { cp, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = join(root, 'dist');
const allowed = new Set(['.html', '.js', '.css', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.mp4']);

// This is only the fixed generated directory, never a user-supplied deletion path.
try {
  if (!(await lstat(output)).isDirectory()) throw new Error('dist must be a real generated directory');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(output, { recursive: true, force: true });
await mkdir(output);
let files = 0;
async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error('Private or symbolic-link asset rejected');
    const input = join(source, entry.name), target = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(input, target);
    else {
      if (!entry.isFile() || !allowed.has(extname(entry.name))) throw new Error('Unexpected public asset type rejected');
      await cp(input, target, { errorOnExist: true, force: false });
      files++;
    }
  }
}
await copyTree(join(root, 'public'), output);
await copyTree(join(root, 'assets'), join(output, 'assets'));
await writeFile(join(output, 'health'), JSON.stringify({ ok: true, service: 'gs-ai-live-integrated-prototype' }));
console.log(`Built ${files} public files plus health into dist; no backend or session logs included.`);
