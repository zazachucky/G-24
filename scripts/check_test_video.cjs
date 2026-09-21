const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'assets/video/test-live');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-video-browser-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });
  let ws;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let attempt = 0; !fs.existsSync(portFile); attempt++) {
      if (attempt > 60) throw new Error('Chrome debugging endpoint did not start');
      await delay(250);
    }
    const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(msg.error) : resolve(msg.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(path.join(root, 'preview/video-test.html')).href });
    for (let attempt = 0; ; attempt++) {
      const state = await evaluate(`(() => { const v=document.getElementById('video');return v?{ready:v.readyState,error:v.error&&v.error.message}:null })()`);
      if (state?.error) throw new Error(state.error);
      if (state?.ready >= 2) break;
      if (attempt > 60) throw new Error('MP4 did not become playable');
      await delay(250);
    }
    const results = await evaluate(`(async () => {
      const v=document.getElementById('video');v.muted=true;
      const passed=[];const ok=(name,value)=>{if(!value)throw new Error(name);passed.push(name)};
      ok('1920x1080 metadata',v.videoWidth===1920&&v.videoHeight===1080);
      ok('120 second duration',Math.abs(v.duration-120)<.1);
      ok('12 chapter buttons',document.querySelectorAll('.chapter').length===12);
      await v.play();await new Promise(r=>setTimeout(r,800));v.pause();
      ok('playback advances',v.currentTime>.3);
      ok('video frames decode',v.getVideoPlaybackQuality().totalVideoFrames>0);
      const seek=async t=>{const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('seek timed out')),4000);v.addEventListener('seeked',()=>{clearTimeout(timer);resolve()},{once:true})});v.currentTime=t;await done;};
      for(const t of [10.5,40.5,60.5,90.5,100.5,119.5]){await seek(t);ok('seek '+t+'s',Math.abs(v.currentTime-t)<.1)}
      await seek(45.5);
      ok('size chapter updates',document.getElementById('now').textContent.includes('66'));
      const input=document.getElementById('search');input.value='무료배송';input.dispatchEvent(new Event('input'));
      ok('script keyword search',document.querySelectorAll('.chapter').length===1&&document.querySelector('.chapter').textContent.includes('배송'));
      input.value='';input.dispatchEvent(new Event('input'));
      document.getElementById('bookmark').click();ok('bookmark records position',document.getElementById('bookmarks').textContent.includes('00:45'));
      document.getElementById('clear-bookmarks').click();ok('bookmark clears',document.getElementById('bookmarks').textContent.includes('없습니다'));
      ok('desktop no overflow',document.documentElement.scrollWidth<=innerWidth);
      return {passed,duration_s:v.duration,width:v.videoWidth,height:v.videoHeight,decoded_frames:v.getVideoPlaybackQuality().totalVideoFrames,audio_decoded_bytes:v.webkitAudioDecodedByteCount??null};
    })()`);
    const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, 'player-desktop.png'), Buffer.from(desktop.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1200, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    const mobile = await evaluate(`({viewport:innerWidth,width:document.documentElement.scrollWidth,no_overflow:document.documentElement.scrollWidth<=innerWidth})`);
    if (!mobile.no_overflow) throw new Error('Mobile horizontal overflow');
    const mobileScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, 'player-mobile.png'), Buffer.from(mobileScreenshot.data, 'base64'));
    const report = { status: 'PASS', scope: 'MP4 browser playback and reference player; no Video AI model evaluated', ...results, mobile };
    fs.writeFileSync(path.join(out, 'browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    if (ws) ws.close();
    chrome.kill('SIGTERM');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
