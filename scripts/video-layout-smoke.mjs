import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Run against npm start; each check gets a temporary, isolated Chrome profile.
const appUrl = process.env.APP_URL || 'http://127.0.0.1:4173';
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert.equal((await fetch(`${appUrl}/health`)).status, 200);
const profile = await mkdtemp(join(tmpdir(), 'gs-live-video-'));
const artifacts = new URL('../artifacts/video-layout/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const chrome = spawn(chromePath, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = new Promise(resolve => chrome.once('exit', resolve));
let socket;
const errors = [];
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 10000);
    chrome.once('error', error => { clearTimeout(timeout); reject(error); });
    chrome.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const tab = (method, params) => call(method, params, sessionId);
  const evaluate = async expression => {
    const result = await tab('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Browser condition timed out: ${expression}`);
  };
  const viewport = async (width, height) => {
    await tab('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(350);
  };
  const click = async selector => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) throw new Error('Missing or disabled control');
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await tab('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await tab('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const capture = async name => {
    await evaluate(`document.querySelector('.primary').scrollTop = 0; document.querySelector('#device-scroll').scrollTop = 0; document.querySelector('.device').scrollIntoView({block:'start', behavior:'instant'})`);
    await delay(250);
    const { data } = await tab('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`${name}.png`, artifacts), Buffer.from(data, 'base64'));
  };
  await tab('Runtime.enable');
  await viewport(1440, 1050);
  await tab('Page.navigate', { url: `${appUrl}/mobile.html` });
  await waitFor(`document.querySelector('#gs-reference-video')?.readyState >= 2`);
  const layout = await evaluate(`(() => {
    const video = document.querySelector('#gs-reference-video');
    window.__testedVideo = video;
    const frame = video.closest('.device .video-frame');
    const rect = video.getBoundingClientRect(), parent = frame.getBoundingClientRect();
    return { count: document.querySelectorAll('video').length, inLiveFrame: !!frame,
      outsideCards: document.querySelectorAll('.workbench > .gs-video-panel').length,
      fillsFrame: Math.abs(rect.width-parent.width) < 1 && Math.abs(rect.height-parent.height) < 1,
      referenceLabel: frame.textContent.includes('다른 상품 참고 영상'), imageHidden: frame.querySelector('img').hidden };
  })()`);
  assert.deepEqual(layout, { count: 1, inLiveFrame: true, outsideCards: 0, fillsFrame: true, referenceLabel: true, imageHidden: true });
  await click('[data-size="77"]');
  await evaluate(`window.__messageText = document.querySelector('#messages').textContent`);
  await click('.video-tools summary');
  await click('[data-video-action="play"]');
  await waitFor(`!window.__testedVideo.paused && window.__testedVideo.currentTime > 0.4`);
  await click('[data-video-action="pause"]');
  await waitFor(`window.__testedVideo.paused`);
  await click('[data-video-action="forward"]');
  await waitFor(`window.__testedVideo.currentTime >= 5 && !window.__testedVideo.seeking`);
  const beforeBack = await evaluate('window.__testedVideo.currentTime');
  await click('[data-video-action="back"]');
  await waitFor(`!window.__testedVideo.seeking`);
  assert.ok(Math.abs(await evaluate('window.__testedVideo.currentTime') - (beforeBack - 5)) < 0.3);
  await evaluate(`const slider = document.querySelector('[data-video-action="seek"]'); slider.value = '25'; slider.dispatchEvent(new Event('input', {bubbles: true}))`);
  await waitFor(`!window.__testedVideo.seeking && window.__testedVideo.readyState >= 2`);
  const seekPosition = await evaluate('window.__testedVideo.currentTime');
  await capture('desktop-portrait');
  await click('[data-video-action="play"]');
  await click('#expand-button');
  await waitFor(`document.body.classList.contains('landscape') && !window.__testedVideo.paused && window.__testedVideo.currentTime > ${seekPosition}`);
  assert.equal(await evaluate(`window.__testedVideo === document.querySelector('#gs-reference-video')`), true);
  await click('[data-video-action="pause"]');
  await capture('desktop-landscape');
  const pausedPosition = await evaluate('window.__testedVideo.currentTime');
  await click('[data-action="benefit"]');
  await waitFor(`document.querySelector('#sheet').open`);
  await click('#close-sheet');
  assert.equal(await evaluate('window.__testedVideo.currentTime'), pausedPosition);
  assert.equal(await evaluate(`document.querySelector('[data-size="77"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.querySelector('#messages').textContent === window.__messageText`), true);
  await click('#expand-button');
  await viewport(390, 844);
  await capture('mobile-portrait');
  await viewport(844, 390);
  await click('#expand-button');
  await capture('mobile-landscape');
  assert.equal(await evaluate('window.__testedVideo.currentTime'), pausedPosition);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true);
  await viewport(1440, 1050);
  await evaluate(`window.__testedVideo.src = '/assets/missing-reference-video.mp4'; window.__testedVideo.load()`);
  await waitFor(`!document.querySelector('#gs-video-error').hidden`);
  assert.equal(await evaluate(`window.__testedVideo.hidden && !document.querySelector('.video-frame .video-image').hidden`), true);
  await capture('error-fallback');
  await click('[data-video-action="retry"]');
  await waitFor(`window.__testedVideo.readyState >= 2 && !window.__testedVideo.hidden && document.querySelector('#gs-video-error').hidden`);
  assert.equal(await evaluate(`document.querySelectorAll('#gs-video-error').length`), 1);
  assert.deepEqual(errors, []);
  const report = { checkedAt: new Date().toISOString(), layout, checks: [
    'Single video fills the customer LIVE image frame; no outer video card',
    'Real pointer clicks: play, pause, +/-5 seconds; seek slider',
    'Playback stays active through orientation toggle; same video element',
    'Paused position, selected size and conversation survive orientation and benefit sheet',
    'Desktop/mobile portrait and landscape screenshots',
    'Missing video displays original image in the same frame; retry recovers',
    'No uncaught JavaScript exceptions',
  ] };
  await writeFile(new URL('report.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await exited;
  // Only the fresh profile owned by this check is removed.
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
