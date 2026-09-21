// End-to-end slot audit. Run an isolated server on 8776; never reset the user's 8765 run.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {launch, delay} = require('./browser_driver.cjs');
const base = process.env.GS_DEMO_URL || 'http://127.0.0.1:8776';
const output = path.resolve(__dirname, '../docs/evidence');
const report = {status:'RUNNING', started_at:new Date().toISOString(), base,
  scope:'Real Chrome Customer A/B/C interactions and all four Director views; isolated run; fixed Simulation remains separate from actual counts',
  setup:'Reset and virtual-clock actions are explicit test setup. Behavioral events are emitted by actual Customer UI interactions.', checks:[], screenshots:[]};
let browser;
const check = (name, condition, details) => {
  if (!condition) throw new Error(name + (details ? ': '+JSON.stringify(details) : ''));
  report.checks.push({name, status:'PASS', ...(details ? {details} : {})}); console.log('PASS', name);
};
async function state(customer) {const response=await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''));if(!response.ok)throw new Error('State HTTP '+response.status);return response.json();}
async function api(action, extra={}) {const current=await state();const response=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:current.run_id,...extra})});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;}
async function until(predicate,label,timeout=10000) {const start=Date.now();while(Date.now()-start<timeout){const current=await state();if(predicate(current))return current;await delay(100);}throw new Error('State timeout: '+label);}
async function closeSheet(page) {if(await page.evaluate('document.querySelector("#dialog").open')){await page.click('#dialog-close');await page.wait('!document.querySelector("#dialog").open');await delay(180);}}
async function ask(page,text) {await page.fill('#ask-input',text);await page.click('#ask-submit');await page.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(text)})`,'submitted question');}
async function view(page,name) {await page.click(`.nav [data-view="${name}"]`);await page.wait(`!document.querySelector('#${name}-view').hidden`);}
async function shot(page,name) {
  await page.send('Page.bringToFront');await page.evaluate('window.scrollTo({top:0,behavior:"instant"})');
  await delay(450); // Let the view entrance transition finish before capturing its data.
  const layout=await page.send('Page.getLayoutMetrics');
  const image=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
    clip:{x:0,y:0,width:layout.cssContentSize.width,height:layout.cssContentSize.height,scale:1}});
  const file='dashboard-slots-'+name+'.png';fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,file),Buffer.from(image.data,'base64'));report.screenshots.push(file);
}
async function metrics(page,expected) {await page.wait(`(() => {const expected=${JSON.stringify(expected)};const cards=[...document.querySelectorAll('#integration-metrics [data-metric]')];return cards.length===10&&cards.every(e=>Number(e.dataset.count)===expected[e.dataset.metric]);})()`,'all ten actual metric cards');}
async function measured(page,before,after) {await page.wait(`(() => {const before=${JSON.stringify(before)},after=${JSON.stringify(after)};const rows=[...document.querySelectorAll('#measured-body [data-measured]')];return rows.length===4&&rows.every(e=>Number(e.dataset.before)===before[e.dataset.measured]&&(after===null?e.dataset.after==='':Number(e.dataset.after)===after[e.dataset.measured]));})()`,'all four actual measurement rows');}
async function responseCounts(page,expected) {await page.wait(`(() => {const expected=${JSON.stringify(expected)};return [...document.querySelectorAll('#response-counts [data-response]')].every(e=>Number(e.dataset.count)===expected[e.dataset.response]);})()`,'answer statuses');}
async function commons(page,current) {await page.wait(`(() => {const s=${JSON.stringify({now:current.now,counts:current.counts,run:current.run_id})};const n=id=>Number(document.querySelector(id).textContent.replaceAll(',',''));return document.body.dataset.runId===s.run&&Number(document.querySelector('#clock').dataset.now)===s.now&&n('#detected-count')===s.counts.detected&&n('#event-count')===s.counts.events&&n('#ui-count')===s.counts.ui_events&&n('#fixture-count')===s.counts.fixture_events;})()`,'common KPI values');}
async function showNotice(page,id) {await page.send('Page.bringToFront');await page.wait(`!!document.querySelector('[data-notice-id="${id}"]')`);await page.evaluate(`document.querySelector('[data-notice-id="${id}"]').scrollIntoView({block:'center',behavior:'instant'})`);await delay(550);}
async function network(page,offline) {await page.send('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:0,uploadThroughput:0});}

(async()=>{
  if(new URL(base).port==='8765')throw new Error('Use an isolated test server; port 8765 is protected from this resetting audit.');
  await api('reset');browser=await launch();
  const a=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
  const b=await browser.page(base+'/app/customer.html?customer=customer-B',1440,1100);
  const c=await browser.page(base+'/app/customer.html?customer=customer-C',1440,1100);
  const director=await browser.page(base+'/app/director.html',1440,1100);
  await Promise.all([a,b,c].map(page=>page.wait('!!window.gsApp?.getState().state')));
  await director.wait('document.body.dataset.connection==="online"');
  await until(s=>s.integration.presence.online_customers===3,'three real customer pages');
  let current=await api('advance',{seconds:0}); // Preserve positive receive time, freeze subsequent clock.
  await commons(director,current);
  check('MON01 shared run, clock and all common KPI slots match received state',current.counts.detected===0&&current.counts.fixture_events===0&&current.counts.ui_events===3&&current.counts.events===3);
  await director.wait('document.querySelector("#presence-online").textContent==="3"&&document.querySelector("#presence-sessions").textContent.includes("3")');
  check('MON02 presence is three customers and three tabs, with three UI entries',current.integration.presence.sessions===3&&current.integration.event_counts.LIVE_ENTER===3);
  check('MON03 fixture product snapshot is explicitly rendered',await director.evaluate('document.querySelector("#product-id").textContent==="1084192893"&&document.querySelector("#product-price").textContent.includes("49,900")&&document.querySelector("#product-rating").textContent.includes("1,200")'));
  const stableEvents=current.counts.events;await delay(5500);
  check('MON04 repeated polling and heartbeat do not create activity', (await state()).counts.events===stableEvents);
  await director.click('#analytics-open');await director.wait('!document.querySelector("#analytics-view").hidden');
  await measured(director,{asks:0,size_views:0,purchase_clicks:0,purchase_completions:0},null);
  check('ANA01 actual analysis opens before approval or fixed results',await director.evaluate('document.querySelector("#analytics-content").hidden&&!document.querySelector("#measured-table").closest("[hidden]")'));
  await view(director,'monitor');
  await a.click('[data-detail="size"]');await a.click('#size-reviews');await closeSheet(a);
  current=await until(s=>s.counts.detected===1,'A Size Need from two distinct actual actions');
  await commons(director,current);
  check('MON05 actual size table and review generate one unique Need',current.integration.event_counts.SIZE_TAB_OPEN===1&&current.integration.event_counts.REVIEW_SIZE_VIEW===1&&current.campaign.state==='NORMAL');
  await director.wait('document.querySelector("#detected-count").textContent==="1"&&document.querySelector("#signal-number").textContent==="0"');
  check('MON06 cumulative detection changes before scheduled chart analysis',current.campaign.evidence.current_customers===0&&current.campaign.evidence.as_of===0);
  current=await api('advance',{seconds:60-current.now});await commons(director,current);
  await director.wait('document.querySelector("#current-bar-label").textContent==="1명"&&document.querySelector("#previous-bar-label").textContent==="0명"');
  check('MON07 first tick derives 0 to 1 customers from real UI and stays below spike threshold',current.campaign.evidence.as_of===60&&current.campaign.evidence.current_customers===1&&current.campaign.evidence.previous_customers===0&&!current.campaign.evidence.spike&&current.campaign.state==='NORMAL');
  check('MON08 graph geometry represents one customer, not raw event count',await director.evaluate('Number(document.querySelector("#current-bar").getAttribute("height"))===5&&document.querySelector("#chart-description").textContent.includes("60")'));
  check('MON09 limited demo audience and prepared representative questions are identified',await director.evaluate('document.querySelector("#monitor-view").innerText.includes("10명")&&document.querySelector("#monitor-view").innerText.includes("3명")&&document.querySelector(".questions-title").innerText.includes("Fixture")'));
  await shot(director,'monitor');

  const secret='비공개_구좌검사_603921 두께감과 배송 알려줘';await ask(a,secret);
  await until(s=>s.integration.totals.asks===1,'first actual ASK');
  await a.fill('#ask-fault','delay');await ask(a,'색상 알려줘');await view(director,'activity');
  await responseCounts(director,{pending:1,completed:1,fallback:0,cancelled:0});
  check('ACT01 pending answer status is visible before completion',true);
  current=await until(s=>s.integration.response.fallback===1,'wall-clock delayed fallback',8000);
  await responseCounts(director,{pending:0,completed:2,fallback:1,cancelled:0});
  check('ACT02 timeout moves one request from pending to completed and fallback',current.now===60);
  await a.fill('#ask-fault','error');await ask(a,'상품후기 알려줘');await a.fill('#ask-fault','');
  await responseCounts(director,{pending:0,completed:3,fallback:2,cancelled:0});
  check('ACT03 explicit response error adds one prepared fallback',true);
  await b.fill('#ask-fault','delay');await ask(b,'배송 알려줘');
  await until(s=>s.integration.response.pending===1,'B pending before product switch');
  await b.evaluate('document.querySelector(".demo-toolbar details").open=true');await b.click('#switch-product');
  current=await until(s=>s.customers[1].current_product==='demo-other-product'&&s.integration.response.cancelled===1,'cancel on context change');
  await responseCounts(director,{pending:0,completed:3,fallback:2,cancelled:1});
  const mainBeforeOther={...current.counts};
  await b.click('#benefit-button');await closeSheet(b);await delay(400);
  current=await state();await commons(director,current);
  check('MON10 other-product browsing does not contaminate main-product KPI or actual totals',JSON.stringify(current.counts)===JSON.stringify(mainBeforeOther)&&current.integration.totals.benefit_views===0,{before:mainBeforeOther,after:current.counts});
  await b.click('#switch-product');await b.fill('#ask-fault','');await until(s=>s.customers[1].current_product==='1084192893','B returns to main product');
  await a.send('Page.bringToFront');await a.evaluate('document.querySelector("#suggestion").scrollIntoView({block:"center"})');
  await until(s=>s.integration.event_counts.AI_SUGGESTION_SHOWN===1,'A sees suggestion');
  await a.click('#suggestion-accept');await a.wait('document.querySelector("#dialog").open');await closeSheet(a);
  await a.click('#benefit-button');await closeSheet(a);await a.click('#styling-button');await a.click('[data-look="LOOK_02"]');
  await a.evaluate('document.querySelectorAll("[data-product-link]").forEach(e=>e.addEventListener("click",event=>event.preventDefault()))');
  await a.click('[data-product-link]');await closeSheet(a);
  await a.click('#purchase-button');await a.click('[data-color="블랙"]');await a.click('[data-purchase-size="77"]');
  await a.click('#demo-order');await a.wait('document.querySelector("#sheet-title").innerText==="구매 체험 완료"');await closeSheet(a);
  await a.click('#gallery-next');await a.click('[data-mode="landscape"]');await a.fill('#media-mode','video');
  await a.wait('document.querySelector("#live-video").readyState>=2');await a.click('#video-play');await a.wait('!document.querySelector("#live-video").paused');
  await until(s=>s.integration.event_counts.MEDIA_PLAY===1,'actual video play');await a.click('#video-play');await until(s=>s.integration.event_counts.MEDIA_PAUSE===1,'actual video pause');
  await a.evaluate('document.querySelector(".demo-toolbar details").open=true');await a.click('#simulate-media-error');await a.click('[data-mode="portrait"]');
  current=await until(s=>s.integration.totals.media_errors===1&&s.integration.event_counts.ORIENTATION_CHANGE===2,'last media events');
  const expected={events:Object.values(current.integration.event_counts).reduce((a,b)=>a+b,0),customers:3,asks:4,size_views:1,benefit_views:1,styling_views:1,detail_views:2,purchase_clicks:1,purchase_completions:1,media_errors:1};
  check('ACT04 all ten server metrics agree with the independent UI action ledger',JSON.stringify(current.integration.totals)===JSON.stringify(expected),{expected,actual:current.integration.totals});
  await metrics(director,expected);check('ACT05 every actual activity metric card renders the expected value',true);
  const expectedIntents={PRODUCT_THICKNESS:1,DELIVERY:2,PRODUCT_COLOR:1,PRODUCT_REVIEW:1};
  await director.wait(`(() => {const want=${JSON.stringify(expectedIntents)},rows=[...document.querySelectorAll('#intent-breakdown [data-intent]')];return rows.length===4&&rows.every(e=>Number(e.dataset.count)===want[e.dataset.intent]);})()`,'exact intent distribution');
  check('ACT06 request intent counts include two types for one compound request',current.integration.intents.reduce((sum,row)=>sum+row.count,0)===5);
  await director.wait(`document.querySelector('#selection-colors [data-value="블랙"]')?.dataset.count==='1'&&document.querySelector('#selection-sizes [data-value="77"]')?.dataset.count==='1'&&document.querySelector('#selection-looks [data-value="LOOK_02"]')?.dataset.count==='1'`);
  check('ACT07 color, size and styling distributions reflect one actual change each',current.integration.event_counts.OPTION_SELECT===2&&current.integration.event_counts.STYLING_LOOK_CHANGE===1);
  await director.wait(`document.querySelector('#linked-products [data-product_id="1103680106"]')?.dataset.count==='1'`);
  check('ACT08 linked styling product uses the clicked real SKU',current.integration.linked_products.length===1&&current.integration.linked_products[0].product_id==='1103680106'&&current.integration.linked_products[0].count===1);
  await director.wait(`(() => {const want=${JSON.stringify(current.integration.event_counts)},rows=[...document.querySelectorAll('#activity-event-counts [data-value]')];return rows.length===Object.keys(want).length&&rows.every(e=>Number(e.dataset.count)===want[e.dataset.value]);})()`,'every behavior count');
  check('ACT09 event distribution and total include all emitted event categories',await director.evaluate(`document.querySelector('#activity-event-total').innerText.includes(${JSON.stringify(String(expected.events))})`));
  await director.wait('document.querySelector("#activity-customer-body [data-customer=customer-A]").innerText.includes("블랙 / 77")&&document.querySelector("#activity-customer-body [data-customer=customer-A]").innerText.includes("LOOK 02")');
  check('ACT10 customer current-state rows show actual selections and image fallback after video error',current.integration.customers[0].media_mode==='image'&&await director.evaluate('document.querySelector("#activity-customer-body [data-customer=customer-A]").innerText.includes("상품 이미지")'));
  await director.wait('document.querySelector("#recent-activity .recent-row").dataset.eventType==="ORIENTATION_CHANGE"');
  check('ACT11 recent activity preserves newest receive order at a frozen timestamp',current.integration.recent[0].event_type==='ORIENTATION_CHANGE'&&current.integration.recent[0].metadata.orientation==='portrait');
  check('PRIV01 Director API/DOM and another customer exclude private question text',!JSON.stringify(current).includes(secret)&&!JSON.stringify(await state('customer-B')).includes(secret)&&!(await director.evaluate('document.body.innerText')).includes(secret));

  await director.fill('#notice-text','모든 고객에게 표시하는 구좌 연결 검사 안내');await director.fill('#notice-route','detail');await director.click('#notice-publish');
  current=await until(s=>s.integration.notices.length===1,'operator notice publication');const notice=current.integration.notices[0];
  for(const page of [a,b,c])await showNotice(page,notice.notice_id);
  await until(s=>s.integration.notices[0].seen_count===3,'three display acknowledgments');
  await director.wait(`document.querySelector('[data-notice-id="${notice.notice_id}"]').dataset.seenCount==='3'&&document.querySelector('#integration-notice-total').textContent==='1'`);
  check('ACT12 notice list, active summary and unique displayed-customer count share actual acknowledgments',true);
  await shot(director,'activity');
  await director.click(`[data-notice-retract="${notice.notice_id}"]`);
  await Promise.all([a,b,c].map(page=>page.wait(`!document.querySelector('[data-notice-id="${notice.notice_id}"]')`)));
  await director.wait('document.querySelector("#integration-notice-total").textContent==="0"');
  check('ACT13 retracting notice updates summary and removes all customer messages',!(await state()).integration.notices[0].active);
  await view(director,'history');current=await state();
  await director.wait(`document.querySelector('#event-log .history-row').dataset.sequence===${JSON.stringify(String(current.logs.at(-1).sequence))}`,'latest received log first');
  check('HIS01 same-time logs are newest-first by receive sequence',await director.evaluate('(() => {const rows=[...document.querySelectorAll("#event-log .history-row")];return rows.length>4&&rows.every((e,i)=>i===0||Number(rows[i-1].dataset.sequence)>Number(e.dataset.sequence));})()'));
  check('HIS02 history badge and navigation count match actual rendered log rows',await director.evaluate('(() => {const n=document.querySelectorAll("#event-log .history-row").length;return Number(document.querySelector("#action-count").textContent)===n&&document.querySelector("#log-count").textContent.includes(String(n));})()'));
  check('HIS03 option logs retain customer identity and safe selected values',await director.evaluate('[...document.querySelectorAll("#event-log [data-action=OPTION_SELECT]")].some(e=>e.innerText.includes("고객 A")&&e.innerText.includes("블랙")&&e.innerText.includes("77"))'));
  check('HIS04 analysis and advance logs retain numeric evidence and translated control origin',await director.evaluate('[...document.querySelectorAll("#event-log [data-action=ANALYSIS]")].some(e=>e.innerText.includes("0")&&e.innerText.includes("1"))&&[...document.querySelectorAll("#event-log [data-action=ADVANCE]")].every(e=>e.querySelector("p").innerText.length>0&&e.querySelector(".badge").textContent!=="control")'));
  check('HIS05 valid non-Need behavior is not presented as a failed IGNORED action',await director.evaluate('![...document.querySelectorAll("#event-log [data-action=BENEFIT_RESULT_VIEW]")].some(e=>e.innerText.includes("IGNORED"))'));
  await shot(director,'history');

  // A clean fixed scenario supplies the larger audience; real customer actions remain separately measured.
  await director.click('#demo-start');current=await state();await Promise.all([a,b,c].map(page=>page.wait(`document.body.dataset.runId===${JSON.stringify(current.run_id)}`)));
  await director.click('#demo-spike');await director.wait('document.querySelector("#director-state").dataset.state==="ALERT"');
  await a.fill('#ask-fault','');await ask(a,'배송 알려줘');await until(s=>s.integration.totals.asks===1,'preapproval request');
  await a.click('#size-button');await closeSheet(a);await a.click('#purchase-button');await closeSheet(a);
  await until(s=>s.integration.totals.size_views===1&&s.integration.totals.purchase_clicks===1,'preapproval manual usage');
  current=await state();await commons(director,current);
  check('MON11 larger fixture audience is distinguished from real customer activity',current.campaign.evidence.previous_customers===8&&current.campaign.evidence.current_customers===26&&current.counts.fixture_events===70&&current.counts.detected===34&&current.counts.ui_events===current.integration.totals.events);
  await director.click('#app-approve');await director.click('#approval-confirm');
  await a.wait('document.querySelector("#size-button").dataset.highlight==="true"');
  await ask(a,'두께감 알려줘');await a.click('#size-button');await closeSheet(a);await a.click('#purchase-button');await a.click('[data-color="블랙"]');await a.click('#demo-order');await a.wait('document.querySelector("#sheet-title").innerText==="구매 체험 완료"');await closeSheet(a);
  current=await until(s=>s.integration.measured.after.purchase_completions===1,'postapproval actual completion');
  const before={asks:1,size_views:1,purchase_clicks:1,purchase_completions:0},after={asks:1,size_views:1,purchase_clicks:1,purchase_completions:1};
  check('ANA02 actual four-metric before/after counts match separate UI action ledger',JSON.stringify(current.integration.measured.before)===JSON.stringify(before)&&JSON.stringify(current.integration.measured.after)===JSON.stringify(after));
  await director.click('#analytics-open');await measured(director,before,after);
  check('ANA03 actual four rows update before fixed Simulation publication',await director.evaluate('document.querySelector("#analytics-content").hidden&&document.querySelector("#measured-timing").textContent.includes("00:02:01")'));
  await api('advance',{seconds:30});await director.wait('Number(document.querySelector("#clock").dataset.now)===151');
  check('ANA04 elapsed threshold does not imply automatic fixed result; copy names Show Result',await director.evaluate('document.querySelector("#analytics-content").hidden&&document.querySelector("#analytics-wait").innerText.includes("Show Result")&&!document.querySelector("#analytics-wait").innerText.includes("0초 뒤")'));
  await director.click('#result-show');await director.wait('!document.querySelector("#analytics-content").hidden');
  current=await state();const fixed=current.campaign.result.metrics;
  check('ANA05 all three fixed KPI pairs remain authored Simulation',fixed.length===3&&fixed.map(m=>[m.before,m.after,m.change_percent].join('/')).join(',')==='26/11/-58,14/43/207,82/95/16'&&current.campaign.result.source==='Prototype Simulation');
  check('ANA06 rendered Simulation cards show every authored pair and source',await director.evaluate('(() => {const cards=[...document.querySelectorAll("#result-metrics .result-card")],values=[[26,11,58],[14,43,207],[82,95,16]];return cards.length===3&&cards.every((e,i)=>e.innerText.includes("Prototype Simulation")&&e.querySelector(".before").textContent===String(values[i][0])&&e.querySelector(".after").textContent===String(values[i][1])&&e.querySelector(".improvement").textContent.includes(String(values[i][2])+"%"));})()'));
  await measured(director,before,after);check('ANA07 publishing fixed results does not overwrite real measurements',JSON.stringify(current.integration.measured.before)===JSON.stringify(before)&&JSON.stringify(current.integration.measured.after)===JSON.stringify(after));
  await shot(director,'analytics');
  await view(director,'history');
  check('HIS06 approval log shows target count and expiry; all origin types appear',await director.evaluate('document.querySelector("#event-log [data-action=APP_APPROVED]").innerText.includes("33")&&document.querySelector("#event-log [data-action=APP_APPROVED]").innerText.includes("421")&&["ui","fixture","director","control","server"].every(origin=>document.querySelector(`#event-log [data-origin="${origin}"]`))'));

  // Freeze a genuinely received snapshot at the response boundary. The server's
  // wall-clock monitor.as_of continues advancing, so real HTTP replies are awaited
  // first and only successful responses are replayed; network failures stay real.
  for(const page of [a,b,c])await page.navigate('about:blank');
  current=await until(s=>s.integration.presence.sessions===0,'all real customer pages left');
  await director.wait('document.querySelector("#presence-online").textContent==="0"');
  const frozen=await director.evaluate(`(async()=>{
    const original=window.fetch.bind(window), source=await original('/api/state',{cache:'no-store'});
    if(!source.ok)throw new Error('Could not capture actual server snapshot');
    const body=await source.text();
    window.__dashboardFrozenProbe={body,last_body:null,delivered:0,network_failures:0,source_status:source.status};
    window.fetch=async(...args)=>{
      const requested=new URL(String(args[0]),location.href).pathname==='/api/state';
      let response;
      try {response=await original(...args);} catch(error) {
        if(requested)window.__dashboardFrozenProbe.network_failures++;
        throw error;
      }
      if(requested&&response.ok){
        window.__dashboardFrozenProbe.delivered++;
        window.__dashboardFrozenProbe.last_body=body;
        return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
      }
      return response;
    };
    return body;
  })()`);
  await director.wait('window.__dashboardFrozenProbe.delivered>=1','Director receives captured snapshot before outage');
  await delay(150);
  const deliveredBefore=await director.evaluate('window.__dashboardFrozenProbe.delivered');
  report.reconnect_snapshot={sha256:createHash('sha256').update(frozen).digest('hex'),
    source:'Actual HTTP 200 response captured immediately before outage',
    monitor_as_of:JSON.parse(frozen).integration.monitor.as_of,
    policy:'Await original fetch, propagate network/HTTP failures, replay unchanged body only after successful HTTP'};
  await network(director,true);
  await director.wait('document.body.dataset.connection==="offline"');
  check('REC01 outage marks common and both customer presence panels unknown',await director.evaluate('document.querySelector("#presence-online").textContent!=="0"&&[...document.querySelectorAll("#customer-body tr,#activity-customer-body tr")].every(e=>e.dataset.online==="unknown")'));
  for(const name of ['monitor','activity','history','analytics']){await view(director,name);check('REC02 '+name+' retains an explicit connection warning',await director.evaluate('!document.querySelector("#connection-error").hidden&&document.body.dataset.connection==="offline"'));}
  await network(director,false);await director.wait('document.body.dataset.connection==="online"');
  await director.wait('document.querySelector("#presence-online").textContent==="0"&&[...document.querySelectorAll("#customer-body tr,#activity-customer-body tr")].every(e=>e.dataset.online==="false")');
  const replay=await director.evaluate('({delivered:window.__dashboardFrozenProbe.delivered,last_body:window.__dashboardFrozenProbe.last_body,network_failures:window.__dashboardFrozenProbe.network_failures,source_status:window.__dashboardFrozenProbe.source_status})');
  check('REC03 identical frozen snapshot restores every presence panel',replay.last_body===frozen&&replay.delivered>deliveredBefore&&replay.network_failures>=1&&replay.source_status===200,
    {same_response_body:replay.last_body===frozen,successful_deliveries_before:deliveredBefore,successful_deliveries_after:replay.delivered,actual_network_failures:replay.network_failures});
  await measured(director,before,after);check('REC04 reconnection preserves measured and Simulation evidence',await director.evaluate('!document.querySelector("#analytics-content").hidden&&document.querySelectorAll("#result-metrics .result-card").length===3'));
  check('ALL01 no uncaught browser exceptions across actual four-view workflow',[...a.errors,...b.errors,...c.errors,...director.errors].length===0);
  report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'dashboard-slots-verification.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
});
