// Regression: the monitor's "연결된 고객 화면" must show actual customer activity.
// Run on an isolated server; this script resets the selected server's demo state.
const fs = require('node:fs');
const path = require('node:path');
const {launch, delay} = require('./browser_driver.cjs');
const base = process.env.GS_DEMO_URL || 'http://127.0.0.1:8773';
const evidence = path.resolve(__dirname, '../docs/evidence');
const report = {status:'RUNNING', base, started_at:new Date().toISOString(), checks:[], screenshots:[]};
let browser;
const row = id => `#customer-body [data-customer="customer-${id}"]`;
const check = (name, ok, details) => {
  if (!ok) throw new Error(name + (details ? ': '+JSON.stringify(details) : ''));
  report.checks.push({name, status:'PASS', ...(details ? {details} : {})});
  console.log('PASS', name);
};
async function state() {return (await fetch(base+'/api/state')).json();}
async function api(action, extra={}) {
  const current = await state();
  const response = await fetch(base+'/api/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,run_id:current.run_id,...extra})});
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function rowWait(page, id, expression, label) {
  await page.wait(`(() => {const e=document.querySelector(${JSON.stringify(row(id))});return !!e&&(${expression});})()`, label);
}
async function rowData(page, id) {
  return page.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(row(id))});return {...e.dataset,text:e.innerText};})()`);
}
async function closeSheet(page) {
  if (await page.evaluate('document.querySelector("#dialog").open')) {
    await page.click('#dialog-close');
    await page.wait('!document.querySelector("#dialog").open');
  }
}
async function shot(page, name) {
  await page.screenshot(path.join(evidence,name+'.png'));
  report.screenshots.push(name+'.png');
}
(async()=>{
  await api('reset');
  browser = await launch();
  const director = await browser.page(base+'/app/director.html',1440,1100);
  await director.wait('!!document.querySelector("#director-state")?.dataset.state');
  await rowWait(director,'A','e.dataset.online==="false"','initial offline A');
  const initial = await Promise.all(['A','B','C'].map(id=>rowData(director,id)));
  check('Monitor initially distinguishes all three offline customers',initial.every(r=>r.online==='false'&&Number(r.events)===0),initial);
  check('Monitor displays an explicit connection count',await director.evaluate('document.querySelector("#connected-online-count").innerText.includes("0")'));

  const b = await browser.page(base+'/app/customer.html?customer=customer-B',1440,1100);
  await b.wait('!!window.gsApp?.getState().state','B ready');
  await rowWait(director,'B','e.dataset.online==="true"&&Number(e.dataset.events)>=1','B presence reaches monitor');
  check('Opening B updates the monitor without entering activity view',await director.evaluate('!document.querySelector("#monitor-view").hidden&&document.querySelector("#activity-view").hidden'));
  check('Opening B leaves A and C offline',(await rowData(director,'A')).online==='false'&&(await rowData(director,'C')).online==='false');
  const countAtEntry=Number((await rowData(director,'B')).events);
  await b.click('#benefit-button');
  await rowWait(director,'B','e.dataset.currentView==="benefit"&&e.dataset.lastEvent==="BENEFIT_RESULT_VIEW"','B benefit visible in same monitor');
  const benefit=await rowData(director,'B');
  check('Benefit action updates current screen, latest action, and count',benefit.text.includes('내 혜택')&&Number(benefit.events)>countAtEntry,benefit);
  check('Benefit use does not falsely set Size Need',benefit.detected==='false');
  await closeSheet(b);
  await rowWait(director,'B','e.dataset.currentView==="live"','closing sheet returns monitor to LIVE');
  check('Returning to LIVE is visible in the monitor',true);

  await b.click('#size-button');
  await rowWait(director,'B','e.dataset.currentView==="size"','manual size screen');
  check('Manual size result alone remains a non-detected Need',(await rowData(director,'B')).detected==='false');
  await closeSheet(b);
  await b.click('[data-detail="size"]');
  await rowWait(director,'B','e.dataset.currentView==="detail"&&e.dataset.lastEvent==="SIZE_TAB_OPEN"','size chart signal');
  check('First distinct Size signal is shown without premature detection',(await rowData(director,'B')).detected==='false');
  await b.click('#size-reviews');
  await rowWait(director,'B','e.dataset.detected==="true"','second size signal detects need');
  check('Size chart and size reviews update actual Need in same row',true);
  await closeSheet(b);

  await b.click('#purchase-button');
  await b.click('[data-color="블랙"]');
  await b.click('[data-purchase-size="77"]');
  await rowWait(director,'B','e.dataset.currentView==="purchase"&&e.innerText.includes("블랙")&&e.innerText.includes("77")','B selected options visible');
  check('Purchase view and actual selected color and size reach monitor',true);
  await closeSheet(b);
  await b.click('#styling-button');
  await b.click('[data-look="LOOK_02"]');
  await rowWait(director,'B','e.dataset.currentView==="styling"&&e.innerText.includes("LOOK 02")','selected styling look visible');
  check('Styling view and actual chosen look reach monitor',true);
  await closeSheet(b);

  const secret='비공개_모니터회귀_25841 두께감 알려줘';
  await b.fill('#ask-input',secret); await b.click('#ask-submit');
  await b.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(secret)})`,'private question posted');
  // A detected Need can expose its suggestion immediately after ASK is received.
  // Verify the question ledger and the actual latest action, not a transient ASK label.
  await rowWait(director,'B','["ASK_LIVE_SUBMIT","AI_SUGGESTION_SHOWN"].includes(e.dataset.lastEvent)','question or following suggestion in monitor');
  const questionState=await state(), questionCustomer=questionState.integration.customers.find(item=>item.id==='customer-B');
  await rowWait(director,'B',`e.dataset.lastEvent===${JSON.stringify(questionCustomer.last_event)}&&Number(e.dataset.events)===${questionCustomer.events}`,'latest received action and count in monitor');
  check('Question receipt and following latest action agree with the same monitor row',questionState.integration.recent.some(item=>item.customer_id==='customer-B'&&item.event_type==='ASK_LIVE_SUBMIT'&&item.intent==='PRODUCT_THICKNESS'));
  check('Director DOM and public API exclude private question text',!(await director.evaluate('document.body.innerText')).includes(secret)&&!JSON.stringify(await state()).includes(secret));

  await b.click('[data-mode="landscape"]');
  await rowWait(director,'B','e.innerText.includes("가로")','orientation in monitor');
  check('Customer orientation update is visible beside current screen',true);
  await b.fill('#media-mode','video');
  await rowWait(director,'B','e.innerText.includes("참고 영상")','video mode in monitor');
  check('Customer media mode updates the connected monitor row',true);
  await b.fill('#media-mode','image');
  await b.click('[data-mode="portrait"]');
  await rowWait(director,'B','e.innerText.includes("상품 이미지")&&e.innerText.includes("세로")','image portrait restored');
  await director.evaluate('document.querySelector("#customer-table").scrollIntoView({block:"center",behavior:"instant"})');
  check('Desktop monitor has no page-level horizontal overflow',await director.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await shot(director,'connected-customers-monitor');
  await director.viewport(390,844,true);
  await director.evaluate('document.querySelector("#customer-table").scrollIntoView({block:"start",behavior:"instant"})');
  check('Mobile monitor keeps wide customer table within its own scroller',await director.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await shot(director,'connected-customers-mobile');
  await director.viewport(1440,1100);

  const b2 = await browser.page(base+'/app/customer.html?customer=customer-B');
  await b2.wait('!!window.gsApp?.getState().state');
  await rowWait(director,'B','e.innerText.includes("2개 탭")','same customer second tab');
  check('Two B tabs remain one connected customer',(await state()).integration.presence.online_customers===1);
  await b2.navigate('about:blank');
  await rowWait(director,'B','e.dataset.online==="true"&&e.innerText.includes("1개 탭")','one B tab remains');
  check('Leaving one B tab retains its remaining connection',true);
  const beforeLeave=await rowData(director,'B');
  await b.navigate('about:blank');
  await rowWait(director,'B','e.dataset.online==="false"','last B tab leaves');
  const afterLeave=await rowData(director,'B');
  check('Leaving final customer tab sets disconnected while retaining activity',Number(afterLeave.events)===Number(beforeLeave.events)&&afterLeave.lastEvent===beforeLeave.lastEvent&&afterLeave.text.includes('블랙'));

  // Check loss of the Director's own API connection separately from customer presence.
  await director.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await director.wait('document.querySelector("#connection").classList.contains("offline")','Director offline');
  await rowWait(director,'B','e.dataset.online==="unknown"','connection unknown rather than stale offline');
  check('Director API failure marks presence unknown rather than treating it as customer state',true);
  await director.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0});
  await rowWait(director,'B','e.dataset.online==="false"','Director reconnect displays actual presence');
  check('Director reconnect restores last known activity and current presence',Number((await rowData(director,'B')).events)===Number(afterLeave.events));

  // Preserve the existing approval targeting while augmenting the monitor display.
  const a = await browser.page(base+'/app/customer.html?customer=customer-A');
  await a.wait('!!window.gsApp?.getState().state');
  await director.click('#demo-start'); await director.click('#demo-spike');
  await director.wait('document.querySelector("#director-state").dataset.state==="ALERT"');
  await director.click('#app-approve'); await director.click('#approval-confirm');
  await rowWait(director,'A','e.dataset.highlight==="true"','A is still the approved target');
  await rowWait(director,'B','e.dataset.highlight==="false"&&e.dataset.detected==="false"','B excluded after demo reset');
  await a.wait('document.querySelector("#size-button").dataset.highlight==="true"','approval reaches customer');
  check('Connected-row additions preserve actual A approval and unrelated B exclusion',true);
  check('No uncaught browser exceptions',[...director.errors,...a.errors,...b.errors,...b2.errors].length===0);
  report.status='PASS'; report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  fs.writeFileSync(path.join(evidence,'connected-customers-verification.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
});
