// Mechanical split of the existing supplied Director HTML; retain a full backup.
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const htmlPath = new URL('public/director.html', root);
const source = await readFile(htmlPath, 'utf8');
const match = source.match(/<script>\s*('use strict';[\s\S]*?)<\/script>\s*<script src="gs-ai-live-state.js"><\/script>\s*<script src="gs-ai-live-integration.js" data-page="director"><\/script>/);
if (!match) throw new Error('Original inline script not found; not rerunning migration');
const backup = new URL('reference/director-before-features.html', root);
try { await access(backup); } catch { await copyFile(htmlPath, backup); }
await writeFile(new URL('public/director.js', root), match[1]);
await writeFile(htmlPath, source.replace(match[0], '<script src="gs-ai-live-state.js"></script>\n<script src="director.js"></script>'));
console.log('Preserved prior Director and extracted its script.');
