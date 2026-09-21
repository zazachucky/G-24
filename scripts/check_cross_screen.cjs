// Real Chrome interactions on independent Customer/Director pages and shared HTTP state.
const fs = require('node:fs');
const path = require('node:path');
const {launch, delay} = require('./browser_driver.cjs');
const base = process.env.GS_DEMO_URL || 'http://127.0.0.1:8765';
const output = path.resolve(__dirname, '../docs/evidence');
const report = {status:'RUNNING', started_at:new Date().toISOString(), checks:[], screenshots:[]};
let browser;
const check = (name, condition, details) => {
  if (!condition) throw new Error(name + (details ? ': ' + JSON.stringify(details) : ''));
  report.checks.push({name, status:'PASS', ...(details ? {details} : {})}); console.log('PASS',name);
};
async function state(customer) {return (await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''))).json();}
async function api(action, extra={}) {
  const current = await state();
  const response = await fetch(base+'/api/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,run_id:current.run_id,...extra})});
  const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); return result;
}
async function until(predicate, label, timeout=10000) {
  const started=Date.now(); while(Date.now()-started<timeout) {const current=await state();if(predicate(current))return current;await delay(100);} throw new Error('State timeout: '+label);
}
async function boot(page) {await page.wait('!!window.gsApp?.getState().state', 'customer ready');}
async function closeSheet(page) {if(await page.evaluate('document.querySelector("#dialog").open')){await page.click('#dialog-close');await page.wait('!document.querySelector("#dialog").open');await delay(200);}}
async function ask(page, text) {await page.fill('#ask-input',text);await page.click('#ask-submit');await page.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(text)})`,'question posted');}
async function shot(page,name) {await page.screenshot(path.join(output,name+'.png'));report.screenshots.push(name+'.png');}
async function noticeInView(page, id) {
  await page.send('Page.bringToFront');
  await page.wait(`!!document.querySelector('[data-notice-id="${id}"]')`, 'broadcast notice rendered');
  await page.evaluate(`document.querySelector('[data-notice-id="${id}"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await delay(650);
}
(async()=>{
  await api('reset'); browser=await launch();
  const a=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
  const b=await browser.page(base+'/app/customer.html?customer=customer-B',390,844,true);
  const c=await browser.page(base+'/app/customer.html?customer=customer-C',390,844,true);
  const director=await browser.page(base+'/app/director.html',1440,1100);
  await Promise.all([boot(a),boot(b),boot(c)]);
  await director.wait('!!document.querySelector("#director-state")?.dataset.state');
  await director.click('[data-view="activity"]');
  let current=await until(s=>s.integration.presence.online_customers===3,'3 actual customer sessions');
  await director.wait('document.querySelector("#presence-online").innerText.includes("3")','Director presence');
  check('Customer presence reaches Director', current.integration.presence.sessions===3);
  const initialCount=current.integration.totals.events;
  await delay(5500);
  check('Polling and heartbeat do not inflate behavior totals',(await state()).integration.totals.events===initialCount);

  const secret='비공개_연동검사_7841 두께감과 배송 알려줘';
  await ask(a,secret);
  current=await until(s=>s.integration.totals.asks===1,'ASK aggregate');
  await director.wait('document.querySelector("#intent-breakdown").innerText.includes("두께")&&document.querySelector("#intent-breakdown").innerText.includes("배송")','actual intent categories');
  check('Multi-intent question reaches categories once', current.integration.intents.some(r=>r.intent==='PRODUCT_THICKNESS'&&r.count===1)&&current.integration.intents.some(r=>r.intent==='DELIVERY'&&r.count===1));
  check('Director API and other customer exclude private question',!JSON.stringify(current).includes(secret)&&!JSON.stringify(await state('customer-B')).includes(secret));
  check('Director DOM excludes private question',!(await director.evaluate('document.body.innerText')).includes(secret));
  await a.fill('#ask-fault','delay');await ask(a,'색상 알려줘');
  await until(s=>s.integration.response.pending===1,'pending response status');
  await director.wait('document.querySelector("#response-counts").innerText.includes("1")','response status visible');
  current=await until(s=>s.integration.response.pending===0&&s.integration.response.fallback===1,'fallback',8000);
  check('Prepared fallback is counted once per request',current.integration.response.completed===2);
  await a.fill('#ask-fault','');

  await a.click('[data-detail="size"]');await a.click('#size-reviews');await closeSheet(a);
  await a.send('Page.bringToFront');await a.evaluate('document.querySelector("#suggestion").scrollIntoView({block:"center"})');
  current=await until(s=>s.integration.event_counts.AI_SUGGESTION_SHOWN===1,'visible suggestion event');
  check('Need detail signals and suggestion exposure connected',current.customers[0].detected&&current.integration.event_counts.SIZE_TAB_OPEN===1&&current.integration.event_counts.REVIEW_SIZE_VIEW===1);
  await a.click('#suggestion-accept');await a.wait('document.querySelector("#dialog").open');await closeSheet(a);
  check('Suggestion acceptance appears in actual activity',(await until(s=>s.integration.event_counts.AI_SUGGESTION_ACCEPT===1,'accept')).integration.totals.size_views===1);
  await a.click('#benefit-button');await closeSheet(a);
  await a.click('#styling-button');await a.click('[data-look="LOOK_02"]');
  // Prevent external navigation while preserving the real delegated product-click handler.
  await a.evaluate('document.querySelectorAll("[data-product-link]").forEach(e=>e.addEventListener("click",event=>event.preventDefault()))');
  await a.click('[data-product-link]');await closeSheet(a);
  current=await until(s=>s.integration.linked_products.some(p=>p.product_id==='1103680106'&&p.count===1),'linked SKU aggregate');
  check('Benefit and styling results and quick actions connected',current.integration.totals.benefit_views===1&&current.integration.totals.styling_views===1&&current.integration.event_counts.QUICK_ACTION_CLICK>=2);
  check('Look selection is recorded with its actual SKU',current.integration.selections.looks.some(r=>r.value==='LOOK_02'&&r.count===1));
  await director.wait('document.querySelector("#linked-products").innerText.includes("1103680106")','linked product Director row');
  await a.click('#purchase-button');await a.click('[data-color="블랙"]');await a.click('[data-purchase-size="77"]');
  await until(s=>s.integration.customers.find(x=>x.id==='customer-A').selection.size==='77','option sync');
  let optionCount=(await state()).integration.event_counts.OPTION_SELECT;
  await a.click('[data-purchase-size="77"]');await delay(300);
  check('Repeated same option does not count as a change',(await state()).integration.event_counts.OPTION_SELECT===optionCount);
  await a.click('#demo-order');await a.wait('document.querySelector("#sheet-title").innerText==="구매 체험 완료"');await closeSheet(a);
  current=await until(s=>s.integration.totals.purchase_completions===1,'purchase completion');
  check('Purchase attempt and demo completion measured separately',current.integration.totals.purchase_clicks===1);
  await director.wait('document.querySelector("#activity-customer-body").innerText.includes("블랙")&&document.querySelector("#activity-customer-body").innerText.includes("77")','actual options in Director');
  await a.click('#gallery-next');await a.click('[data-mode="landscape"]');
  await a.fill('#media-mode','video');await a.wait('document.querySelector("#live-video").readyState>=2');
  await a.click('#video-play');await a.wait('!document.querySelector("#live-video").paused&&document.querySelector("#live-video").currentTime>.2');
  await until(s=>s.integration.event_counts.MEDIA_PLAY>=1,'play event');
  await a.click('#video-play');await until(s=>s.integration.event_counts.MEDIA_PAUSE>=1,'pause event');
  await a.evaluate('document.querySelector(".demo-toolbar details").open=true');await a.click('#simulate-media-error');
  current=await until(s=>s.integration.totals.media_errors===1,'media error integration');
  check('Image/orientation/media changes reach the same event stream',current.integration.event_counts.PRODUCT_IMAGE_VIEW===1&&current.integration.event_counts.ORIENTATION_CHANGE>=1&&current.integration.event_counts.MEDIA_PLAY>=1&&current.integration.event_counts.MEDIA_PAUSE>=1);
  await a.click('[data-mode="portrait"]');
  current=await until(s=>s.integration.event_counts.ORIENTATION_CHANGE>=2,'portrait return');
  await director.wait(`(() => {const expected=${JSON.stringify(current.integration.totals)};return [...document.querySelectorAll('#integration-metrics [data-metric]')].length===10&&[...document.querySelectorAll('#integration-metrics [data-metric]')].every(e=>Number(e.dataset.count)===expected[e.dataset.metric]);})()`,'all visible Director metric values match actual actions');
  check('All ten Director metric cards render received actual values',true);
  await director.wait('!!document.querySelector("#recent-activity [data-event-type=MEDIA_ERROR]")','recent media error activity');
  await shot(director,'integration-activity');

  const noticeText='사이즈표를 함께 확인해주세요. <b>공용 안내</b>';
  await director.fill('#notice-text',noticeText);await director.fill('#notice-route','detail');await director.click('#notice-publish');
  current=await until(s=>s.integration.notices.length===1,'published notice');
  const notice=current.integration.notices[0];
  await noticeInView(a,notice.notice_id);
  await noticeInView(b,notice.notice_id);
  current=await until(s=>s.integration.notices[0].seen_count>=2,'rendered acknowledgments');
  check('Director announcement is shared with display acknowledgments',current.integration.notices[0].seen_by.includes('customer-A')&&current.integration.notices[0].seen_by.includes('customer-B'));
  check('Notice HTML is rendered as text',await a.evaluate(`document.querySelector('[data-notice-id="${notice.notice_id}"]').innerText.includes('<b>공용 안내</b>')&&!document.querySelector('[data-notice-id="${notice.notice_id}"] b')`));
  await a.click(`[data-notice-id="${notice.notice_id}"] [data-route]`);await a.wait('document.querySelector("#sheet-title").innerText==="상품상세"');
  check('Public notice CTA opens actual customer detail',await a.evaluate('document.querySelector("#dialog").open'));await closeSheet(a);
  await c.navigate(base+'/app/customer.html?customer=customer-C');await boot(c);await noticeInView(c,notice.notice_id);
  current=await until(s=>s.integration.notices[0].seen_count===3,'late rejoin sees notice');
  check('Late load retains notice without duplicate seen count',current.integration.notices[0].active);
  await director.wait(`document.querySelector('[data-notice-id="${notice.notice_id}"]').dataset.seenCount==='3'`,'Director displays all acknowledgments');
  await shot(c,'integration-customer-notice');
  await director.click(`[data-notice-retract="${notice.notice_id}"]`);
  await Promise.all([a,b,c].map(p=>p.wait(`!document.querySelector('[data-notice-id="${notice.notice_id}"]')`,'notice retracted')));
  check('Retraction removes announcement from all customers',!(await state()).integration.notices[0].active);

  // Lease expires on wall time even if the demo's domain clock is frozen.
  await api('advance',{seconds:0});
  const frozen=(await state()).now;
  await b.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  current=await until(s=>s.integration.presence.online_customers===2,'lease expires after lost connection',18000);
  check('Lost connection expires actual presence on wall clock',current.now===frozen);
  await b.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0});
  await until(s=>s.integration.presence.online_customers===3,'presence recovers',10000);
  check('Customer reconnect restores presence without duplicate entry',(await state()).integration.event_counts.LIVE_ENTER===3);
  const beforeReload=(await state()).integration.totals;
  await a.navigate(base+'/app/customer.html?customer=customer-A');await boot(a);await delay(700);
  current=await state();
  check('Refresh retains selections and avoids duplicate result views',current.integration.customers[0].selection.size==='77'&&current.integration.totals.size_views===beforeReload.size_views&&current.integration.totals.asks===beforeReload.asks);

  // Director controls and measured counters share exactly the same run.
  await director.click('#demo-start');
  current=await state();
  await a.wait(`document.body.dataset.runId===${JSON.stringify(current.run_id)}`,'new run');
  await director.click('#demo-spike');await director.click('[data-view="monitor"]');
  await director.wait('document.querySelector("#director-state").dataset.state==="ALERT"');
  await ask(a,'혜택 알려줘');await a.wait('document.querySelector("#dialog").open');await closeSheet(a);
  await director.click('#app-approve');await director.click('#approval-confirm');
  await a.wait('document.querySelector("#size-button").dataset.highlight==="true"','approved customer');
  await b.wait('document.querySelector("#size-button").dataset.highlight==="false"','unrelated customer');
  await a.click('#size-button');await closeSheet(a);await a.click('#purchase-button');await a.click('#demo-order');await a.wait('document.querySelector("#sheet-title").innerText==="구매 체험 완료"');await closeSheet(a);
  current=await until(s=>s.integration.measured.after.purchase_completions===1,'measured postapproval');
  check('Real measurements split at approval receive order',current.integration.measured.before.asks===1&&current.integration.measured.after.size_views===1&&current.integration.measured.after.purchase_clicks===1);
  check('Fixture events remain separate from actual UI data',current.counts.fixture_events===70&&current.integration.totals.events===current.counts.ui_events&&current.campaign.approval.count===33);
  await director.click('[data-view="analytics"]');
  await director.wait(`(() => {const expected=${JSON.stringify(current.integration.measured)};return [...document.querySelectorAll('#measured-body [data-measured]')].every(e=>Number(e.dataset.before)===expected.before[e.dataset.measured]&&Number(e.dataset.after)===expected.after[e.dataset.measured]);})()`,'measured analytics matches actual approval boundary');
  check('Director measured table renders actual before and after values',true);
  await director.click('#result-show');await director.wait('document.querySelector("#director-state").dataset.state==="RESULT"');
  current=await state();
  check('Fixed Simulation is preserved beside actual usage',current.campaign.result.source==='Prototype Simulation'&&current.campaign.result.metrics.map(x=>x.change_percent).join(',')==='-58,207,16');
  await shot(director,'integration-analytics');
  await director.click('#end-live');await a.wait('gsApp.getState().state.ended&&!gsApp.getState().state.customer.highlight');
  const endedTotal=(await state()).integration.totals.events;
  await a.click('#benefit-button');await closeSheet(a);
  check('Broadcast end reaches customer and stops behavior recording',(await state()).integration.totals.events===endedTotal);
  await director.click('[data-view="activity"]');
  check('Ended broadcast disables public publishing',await director.evaluate('document.querySelector("#notice-publish").disabled'));
  await director.click('#demo-reset');
  current=await state();await a.wait(`document.body.dataset.runId===${JSON.stringify(current.run_id)}`);
  await until(s=>s.integration.presence.online_customers===3,'all customers rejoin reset');
  current=await state();
  check('Reset clears analytics notices private messages and approval',current.integration.totals.asks===0&&current.integration.notices.length===0&&!current.campaign.approval&&(await state('customer-A')).customer.messages.length===1);
  await director.click('[data-view="activity"]');
  await director.viewport(390,844,true);await delay(150);
  check('New Director activity view fits mobile viewport',await director.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await shot(director,'integration-director-mobile');
  check('No uncaught exceptions during connected workflow',[...a.errors,...b.errors,...c.errors,...director.errors].length===0);
  report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'cross-screen-verification.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
});
