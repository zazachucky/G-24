import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function launchBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'gs-live-mobile-check-'));
  const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  let socket;
  const errors = [];
  async function close() {
    socket?.close(); chrome.kill('SIGTERM'); await exited;
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }); // Only this check's mkdtemp directory.
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 10000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      chrome.stderr.on('data', chunk => {
        const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    const pending = new Map(); let nextId = 0;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    async function page(url, width = 390, height = 844) {
      const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
      const tab = (method, params) => call(method, params, sessionId);
      const evaluate = async expression => {
        const result = await tab('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitFor = async (expression, timeoutMs = 10000) => {
        for (let attempt = 0; attempt < timeoutMs / 100; attempt++) { if (await evaluate(expression)) return; await delay(100); }
        throw new Error(`Browser condition timed out: ${expression}`);
      };
      const viewport = async (w, h) => {
        await tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await delay(100);
      };
      const click = async selector => {
        let point;
        for(let attempt=0;attempt<30;attempt++) {
        point = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el || el.disabled) return { waiting:'Missing/disabled control' };
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          const x = r.x+r.width/2, y = r.y+r.height/2;
          if (!r.width || !r.height || !el.contains(document.elementFromPoint(x,y))) return { waiting:'Control is covered' };
          return { x, y };
        })()`);
        if(!point.waiting)break;
        await delay(50);
        }
        if(point.waiting)throw new Error(`${point.waiting}: ${selector}`);
        await tab('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await tab('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      };
      const capture = async file => {
        await delay(260); // Allow native view transitions to settle before visual evidence.
        await mkdir(new URL('./', file), { recursive: true });
        const { data } = await tab('Page.captureScreenshot', { format: 'png' });
        await writeFile(file, Buffer.from(data, 'base64'));
      };
      await tab('Runtime.enable'); await tab('Page.enable'); await viewport(width, height);
      await tab('Page.navigate', { url });
      await waitFor('document.readyState === "complete"');
      return { tab, evaluate, waitFor, viewport, click, capture, type: text => tab('Input.insertText', { text }) };
    }
    return { page, call, errors, close };
  } catch (error) { await close(); throw error; }
}
