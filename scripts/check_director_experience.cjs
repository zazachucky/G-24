// Isolated real HTTP/Chrome verification. No changes to the user's 8765 session.
// The test server's monotonic receive clock is controlled through its own temp file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {launch, delay} = require('./browser_driver.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/evidence');
const port = Number(process.env.GS_EXPERIENCE_PORT || 8788);
const base = `http://127.0.0.1:${port}`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-director-experience-'));
const clockFile = path.join(temporary, 'clock.txt');
let clockValue = 10000, clockBase = 10000, browser, server;
const report = {status: 'RUNNING', started_at: new Date().toISOString(),
  scope: 'Actual Chrome UI and isolated HTTP server; injected monotonic receive clock for exact telemetry windows',
  base, checks: [], screenshots: []};
const check = (name, value, evidence) => {
  if (!value) throw new Error(name + (evidence ? ' ' + JSON.stringify(evidence) : ''));
  report.checks.push({name, status: 'PASS', ...(evidence ? {evidence} : {})}); console.log('PASS', name);
};
function setElapsed(seconds) {
  const next = clockBase + seconds;
  if (next < clockValue) throw new Error('Test receive clock must be monotonic');
  clockValue = next;
  fs.writeFileSync(clockFile + '.next', String(clockValue)); fs.renameSync(clockFile + '.next', clockFile);
}
async function state() {const response = await fetch(base + '/api/state'); if (!response.ok) throw new Error('State HTTP ' + response.status); return response.json();}
async function closeSheet(page) {
  if (await page.evaluate('document.querySelector("#dialog").open')) {
    await page.click('#dialog-close'); await page.wait('!document.querySelector("#dialog").open');
  }
}
async function ask(page, text) {
  await closeSheet(page);
  const before = (await state()).integration.totals.asks;
  await page.fill('#ask-input', text); await page.click('#ask-submit');
  await page.wait(`window.gsApp.getState().state.integration.totals.asks>${before}`, 'ASK recorded');
  await closeSheet(page);
}
async function detail(page) {await closeSheet(page); await page.click('.product-detail-btn'); await page.wait('document.querySelector("#dialog").open'); await closeSheet(page);}
async function purchase(page) {
  await closeSheet(page); await page.click('#purchase-button'); await page.wait('!!document.querySelector("#demo-order")');
  await page.click('#demo-order'); await page.wait('window.gsApp.getState().ui.active_result==="complete"'); await closeSheet(page);
}
async function screenshot(page, name) {
  const filename = 'director-experience-' + name + '.png';
  await page.screenshot(path.join(output, filename)); report.screenshots.push(filename);
}
async function startServer() {
  setElapsed(0);
  const program = `from pathlib import Path\nimport sys\nfrom app.server import create_server\nfrom app.state import AppState\nclock_path = Path(sys.argv[1])\nserver = create_server(port=int(sys.argv[2]), state=AppState(clock=lambda: float(clock_path.read_text())))\nprint('DIRECTOR_EXPERIENCE_READY', flush=True)\nserver.serve_forever(poll_interval=.1)\n`;
  server = spawn('/usr/bin/python3', ['-u', '-c', program, clockFile, String(port)], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => {
    let errors = '';
    const timer = setTimeout(() => reject(new Error('Isolated server startup timeout: ' + errors)), 5000);
    server.stderr.on('data', data => {errors += data.toString();});
    server.once('error', error => {clearTimeout(timer); reject(error);});
    server.once('exit', code => {clearTimeout(timer); reject(new Error(`Isolated server exited ${code}: ${errors}`));});
    server.stdout.on('data', data => {if (data.toString().includes('DIRECTOR_EXPERIENCE_READY')) {clearTimeout(timer); resolve();}});
  });
}
(async () => {
  fs.mkdirSync(output, {recursive: true}); await startServer(); browser = await launch();
  const a = await browser.page(base + '/app/customer.html?customer=customer-A', 1440, 1100);
  await a.wait('!!window.gsApp?.getState().state');
  const director = await browser.page(base + '/app/director.html', 1440, 1100);
  await director.wait('document.querySelector("#monitor-viewers").textContent==="1명"');
  check('Actual customer heartbeat supplies viewer KPI', true);
  await ask(a, '개인확인문구-X91 두께감과 실제 색상이 궁금해요');
  await director.wait('document.querySelectorAll("#monitor-top-questions [data-topic]").length===2');
  check('Actual compound ASK supplies two normalized TOP5 topics', await director.evaluate('!!document.querySelector("[data-topic=thickness]")&&!!document.querySelector("[data-topic=color]")'));
  await director.wait('document.querySelector("#monitor-trend-desc").textContent.includes("상품 정보 1건")');
  check('Two product intents count once in the same trend category', true);
  check('Private ASK prose is absent from public state and Director', !JSON.stringify(await state()).includes('개인확인문구-X91') && !await director.evaluate('document.body.textContent.includes("개인확인문구-X91")'));
  await a.evaluate('document.querySelector("details.public-comments").open=true');
  await a.fill('#public-comment-input', '공개 댓글 확인 <script>alert(1)</script>'); await a.click('#public-comment-submit');
  await director.wait('document.querySelector("#monitor-comments").textContent==="1건"');
  check('Explicit public comment supplies total and safely escaped list', await director.evaluate('document.querySelector("#monitor-public-comments").textContent.includes("<script>")&&!document.querySelector("#monitor-public-comments script")'));
  await purchase(a); await director.wait('document.querySelector("#monitor-conversion").textContent==="100%"');
  check('Purchase completion rate uses actual unique visitor and completer', true);
  await director.click('[data-monitor-category="product"]'); await director.wait('!document.querySelector("#monitor-trend-plot [data-series=product]")');
  await director.click('[data-monitor-category="product"]'); await director.wait('!!document.querySelector("#monitor-trend-plot [data-series=product]")');
  check('Trend category legend hides and restores its series', true);
  await director.evaluate('document.querySelector(".experience-console").scrollIntoView({block:"start",behavior:"instant"})'); await screenshot(director, 'desktop');
  await director.viewport(390, 844, true); await director.evaluate('document.querySelector(".experience-console").scrollIntoView({block:"start",behavior:"instant"})'); await screenshot(director, 'mobile');
  check('Mobile Director has no page-width overflow', await director.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await director.viewport(1440, 1100);

  // Independent UI operations before/after approval; fixtures are not actual outcomes.
  await director.click('#demo-start'); const run = (await state()).run_id; clockBase = clockValue;
  await a.wait(`document.body.dataset.runId===${JSON.stringify(run)}`);
  const b = await browser.page(base + '/app/customer.html?customer=customer-B', 1440, 1100);
  await b.wait('!!window.gsApp?.getState().state');
  await director.wait('document.querySelector("#monitor-viewers").textContent==="2명"');
  await ask(a, '내 사이즈 추천해줘'); await detail(a); await purchase(a);
  await director.click('#demo-spike');
  await director.click('#host-review'); await director.click('#host-reviewed'); await director.click('#host-confirm');
  await director.wait('!document.querySelector("#host-dialog").open');
  await director.click('#app-approve'); await director.wait('document.querySelector("#app-dialog").open'); await director.click('#approval-confirm');
  await director.wait('!document.querySelector("#app-dialog").open');
  await a.send('Page.bringToFront'); await a.evaluate('document.querySelector("#size-button").scrollIntoView({block:"center",behavior:"instant"})');
  await a.wait('document.querySelector("#size-button").dataset.highlight==="true"');
  await director.wait('document.querySelector("#outcome-app").dataset.exposed==="1"');
  check('APP approval and host delivery show distinct target and actual exposure counts', await director.evaluate('document.querySelector("#outcome-app").dataset.targets==="33"&&document.querySelector("#outcome-host-status").textContent.includes("완료")'));
  await ask(a, '내 사이즈 추천해줘'); await detail(a); await purchase(a);
  await director.click('.nav [data-view="analytics"]');
  await director.wait('document.querySelector("[data-outcome-metric=size_questions]").dataset.after==="1"');
  check('Actual size-question outcome separates approval before and after', await director.evaluate('document.querySelector("[data-outcome-metric=size_questions]").dataset.before==="1"'));
  check('Actual product-detail outcome separates approval before and after', await director.evaluate('(()=>{const e=document.querySelector("[data-outcome-metric=detail_views]");return e.dataset.before==="1"&&e.dataset.after==="1"})()'));
  await director.wait('document.querySelector("[data-outcome-metric=completion_rate]").dataset.after==="100"');
  check('Phase conversion shows unique participant numerator and denominator', await director.evaluate('(()=>{const e=document.querySelector("[data-outcome-metric=completion_rate]");return e.dataset.before==="50"&&e.textContent.includes("1 / 2명")&&e.textContent.includes("1 / 1명")})()'));
  check('New outcomes retain the four existing actual-use rows', await director.evaluate('document.querySelectorAll("#measured-body tr").length===4'));
  const outcomeBeforeSimulation = (await state()).integration.monitor.outcomes;
  await director.click('#result-show'); await director.wait('!document.querySelector("#analytics-content").hidden');
  const simulation = await state();
  check('Fixed Simulation remains 26→11 / 14→43 / 82→95 independently', JSON.stringify(simulation.campaign.result.metrics.map(row=>[row.before,row.after,row.change_percent]))===JSON.stringify([[26,11,-58],[14,43,207],[82,95,16]]));
  check('Publishing Simulation does not change actual outcome aggregates', JSON.stringify(outcomeBeforeSimulation)===JSON.stringify(simulation.integration.monitor.outcomes));
  await director.evaluate('document.querySelector(".actual-outcomes").scrollIntoView({block:"start",behavior:"instant"})'); await screenshot(director, 'analytics');
  await director.click('#expire-action'); await director.wait('document.querySelector("#outcome-app-status").textContent==="적용 기간 종료"');
  check('Virtual TTL expiry leaves actual telemetry clock independent', (await state()).integration.monitor.as_of===0);

  // Real browser ASK submissions at exact receive-time boundaries in a frozen demo.
  await director.click('#demo-start'); clockBase=clockValue; const timeRun=(await state()).run_id;
  await a.wait(`document.body.dataset.runId===${JSON.stringify(timeRun)}`);
  await ask(a, '배송은 언제 와?'); setElapsed(300); await ask(a, '배송은 언제 와?');
  setElapsed(301); await ask(a, '배송은 언제 와?'); setElapsed(600); await ask(a, '배송은 언제 와?');
  await director.wait('document.querySelector("#monitor-insight").textContent.includes("직전 5분 1건")');
  const at600=(await state()).integration.monitor;
  check('Five-minute windows exclude lower and include upper boundary', at600.insight.previous_count===1&&at600.insight.current_count===2&&at600.insight.change_percent===100);
  check('Receive-time progress does not advance frozen Need clock', (await state()).now===68);
  setElapsed(1810); await director.wait('document.querySelector("[data-topic=delivery]")?.dataset.count==="3"');
  const at1810=(await state()).integration.monitor;
  check('Thirty-minute TOP5 and chart expire the same old question', at1810.top_questions[0].count===3&&at1810.trend.buckets.reduce((sum,bucket)=>sum+bucket.counts.delivery,0)===3);
  setElapsed(2400); await director.wait('document.querySelectorAll("#monitor-top-questions [data-topic]").length===0');
  check('Exact thirty-minute lower boundary ages out the final question', true);
  check('Director and customer browser runtime have no exceptions', [...a.errors,...b.errors,...director.errors].length===0);
  report.status='PASS'; report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server&&server.exitCode===null){server.kill('SIGTERM');await delay(150);}
  fs.rmSync(temporary,{recursive:true,force:true});
  fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,'director-experience-verification.json'),JSON.stringify(report,null,2)+'\n');
});
