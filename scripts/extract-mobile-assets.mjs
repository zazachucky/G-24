// One-time mechanical extraction. Keep the supplied imagery and data byte-for-byte.
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const original = await readFile(new URL('reference/GS_AI_LIVE_Mobile.html', root), 'utf8');
const declarations = original.slice(original.indexOf('const ASSETS='), original.indexOf('const state='))
  + original.slice(original.indexOf('const reviews='), original.indexOf('let toastTimer;'));
const fixture = vm.runInNewContext(`${declarations}; ({ ASSETS, PRODUCT_URL, CANDIDATES, reviews, looks })`);
await mkdir(new URL('assets/mobile/', root), { recursive: true });
async function extract(name, uri) {
  const match = uri.match(/^data:image\/(jpeg|png);base64,(.+)$/s);
  if (!match) throw new Error(`Unsupported original image: ${name}`);
  const relative = `assets/mobile/${name}.${match[1] === 'jpeg' ? 'jpg' : 'png'}`;
  await writeFile(new URL(relative, root), Buffer.from(match[2], 'base64'));
  return `/${relative}`;
}
for (const [name, uri] of Object.entries(fixture.ASSETS)) fixture.ASSETS[name] = await extract(name, uri);
for (const [name, item] of Object.entries(fixture.CANDIDATES)) item.image = await extract(name, item.image);
await writeFile(new URL('public/gs-live-data.js', root), `// Extracted from the supplied Mobile HTML. No runtime image generation.\nwindow.GSLiveData = ${JSON.stringify(fixture, null, 2)};\n`);
const backup = new URL('reference/mobile-before-redesign.html', root);
try { await access(backup); } catch { await copyFile(new URL('public/mobile.html', root), backup); }
console.log('Extracted 7 original images and product/review/look fixtures; prior mobile preserved.');
