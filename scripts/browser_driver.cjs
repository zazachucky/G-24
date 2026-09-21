// Small CDP driver using Node's built-in WebSocket; no npm installation needed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Page {
  constructor(ws) {
    this.ws = ws;
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
    this.requests = [];
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const item = this.pending.get(data.id);
        this.pending.delete(data.id);
        clearTimeout(item.timer);
        data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result);
      } else if (data.method === 'Runtime.exceptionThrown') {
        this.errors.push(data.params.exceptionDetails);
      } else if (data.method === 'Network.responseReceived') {
        this.requests.push({url:data.params.response.url,status:data.params.response.status});
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`));}, 15000);
      this.pending.set(id, {resolve,reject,timer});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true,userGesture:true});
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async wait(expression, message = expression, timeout = 10000) {
    const start = Date.now();
    while (Date.now()-start < timeout) {
      if (await this.evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Browser assertion timed out: ${message}`);
  }
  async click(selector) {
    await this.send('Page.bringToFront');
    await this.wait(`(() => {const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.disabled&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';})()`, 'visible enabled '+selector);
    const location = await this.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await this.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...location});
    await this.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...location});
  }
  async fill(selector, value) {
    await this.send('Page.bringToFront');
    await this.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  async key(key) {
    await this.send('Page.bringToFront');
    await this.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:key==='Tab'?9:13});
    await this.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});
  }
  async screenshot(file) {
    await this.send('Page.bringToFront');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const result = await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(file,Buffer.from(result.data,'base64'));
  }
  async viewport(width, height, mobile=false) {
    await this.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  }
  async navigate(url) {
    await this.send('Page.navigate',{url});
    await this.wait(`document.readyState==='complete'`,'document ready');
  }
  close() {
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
    this.ws.close();
  }
}

async function launch() {
  const executable = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(executable)) throw new Error('Set CHROME_PATH to an installed Chromium/Chrome executable.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'gs-live-browser-'));
  const chrome = spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  const portFile = path.join(profile,'DevToolsActivePort');
  let port;
  for (let i=0;i<80;i++) {
    if (fs.existsSync(portFile)) {port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);break;}
    if (chrome.exitCode !== null) throw new Error('Chrome exited before startup.');
    await delay(100);
  }
  if (!port) {chrome.kill('SIGTERM');throw new Error('Chrome startup timeout');}
  const pages=[];
  return {
    async page(url='about:blank',width=1440,height=1050,mobile=false) {
      const target=await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
      const ws=new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
      const page=new Page(ws);pages.push(page);
      await page.send('Page.enable');await page.send('Runtime.enable');await page.send('Network.enable');
      await page.viewport(width,height,mobile);
      await page.navigate(url);
      return page;
    },
    async close() {
      for(const page of pages)page.close();
      chrome.kill('SIGTERM');
      await delay(200);
      // The isolated browser profile is retained in the OS temporary directory.
    }
  };
}
module.exports={launch,delay};
