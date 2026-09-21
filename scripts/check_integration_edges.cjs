// Real HTTP/Chrome edge checks. Run against a dedicated local server; default is 8772.
const fs = require('node:fs');
const path = require('node:path');
const {launch, delay} = require('./browser_driver.cjs');
const base = process.env.GS_EDGE_URL || 'http://127.0.0.1:8772';
const out = path.resolve(__dirname, '../docs/evidence/integration-edge-verification.json');
const report = {status:'RUNNING', started_at:new Date().toISOString(), server:base, checks:[], fault_policy:'Delay or reject delivery of actual HTTP responses; never fabricate successful payloads.'};
let browser;
const check = (name, result, details) => {if (!result) throw new Error(name+(details?' '+JSON.stringify(details):''));report.checks.push({name,status:'PASS',...(details?{details}:{})});console.log('PASS',name);};
async function state(customer) {return (await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''))).json();}
async function api(action, fields={}) {const current=await state();const response=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:current.run_id,...fields})});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;}
async function until(predicate,label,timeout=10000) {const start=Date.now();while(Date.now()-start<timeout){const current=await state();if(predicate(current))return current;await delay(80);}throw new Error('State timeout: '+label);}
async function closeSheet(page) {if(await page.evaluate('document.querySelector("#dialog").open')){await page.click('#dialog-close');await page.wait('!document.querySelector("#dialog").open');await delay(180);}}
async function reset(director, customer) {await director.click('#demo-reset');const current=await state();await customer.wait(`gsApp.getState().state?.run_id===${JSON.stringify(current.run_id)}`,'customer reset');await until(s=>s.integration.presence.online_customers>=1,'customer rejoin');}
async function suggestion(page) {await page.click('[data-detail="size"]');await page.click('#size-reviews');await closeSheet(page);await page.wait('!document.querySelector("#suggestion").hidden','suggestion visible');await page.evaluate('document.querySelector("#suggestion").scrollIntoView({block:"center",behavior:"instant"})');await delay(150);}
async function switchCustomer(page, id) {await page.fill('#customer-select',id);await page.wait(`gsApp.getState().state?.customer.id===${JSON.stringify(id)}&&!document.querySelector('#size-button').disabled`,'switch to '+id);await delay(160);}
async function fault(page, action, eventType, mode) {
 await page.evaluate(`(()=>{if(!window.__edgeFetch){window.__edgeFetch=window.fetch.bind(window);window.__edgeRequests=[];window.fetch=async(...args)=>{let body;try{body=JSON.parse(args[1]?.body||'{}')}catch{};const f=window.__edgeFault;if(String(args[0]).includes('/api/action')&&body?.action==='notice_publish')window.__edgeRequests.push(body);if(f&&!f.used&&body?.action===f.action&&(!f.eventType||body.event_type===f.eventType)){f.used=true;if(f.mode==='before')throw new TypeError('Injected network interruption before send');const response=await window.__edgeFetch(...args);f.committed=true;if(f.mode==='after')throw new TypeError('Injected response lost after server commit');await new Promise(resolve=>{window.__edgeRelease=resolve});return response;}return window.__edgeFetch(...args);};}window.__edgeFault=${JSON.stringify({action,eventType,mode,used:false,committed:false})};})()`);
}
const measuredCounts = snapshot => ({asks:snapshot.integration.totals.asks,size:snapshot.integration.totals.size_views,benefit:snapshot.integration.totals.benefit_views,styling:snapshot.integration.totals.styling_views,detail:snapshot.integration.totals.detail_views,purchase:snapshot.integration.totals.purchase_clicks,complete:snapshot.integration.totals.purchase_completions});
(async()=>{
 await api('reset');browser=await launch();
 const customer=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
 const director=await browser.page(base+'/app/director.html',1440,1100);
 await customer.wait('!!window.gsApp?.getState().state','customer boot');await director.wait('!!document.querySelector("#director-state").dataset.state','Director boot');
 // A response that commits for A is delivered only after the user chooses B.
 await suggestion(customer);await fault(customer,'event','AI_SUGGESTION_ACCEPT','delay');
 await customer.click('#suggestion-accept');await customer.wait('window.__edgeFault.committed','A acceptance committed');
 await customer.fill('#customer-select','customer-B');await customer.wait('gsApp.getState().customerId==="customer-B"','B context chosen');
 await customer.evaluate('window.__edgeRelease()');await customer.wait('gsApp.getState().state?.customer.id==="customer-B"','B state loaded');await delay(650);
 let current=await state('customer-B');
 check('Delayed A suggestion acceptance cannot open B size result',await customer.evaluate('!document.querySelector("#dialog").open&&gsApp.getState().customerId==="customer-B"'));
 check('Delayed acceptance remains attributed to A without a B result view',current.integration.recent.some(r=>r.event_type==='AI_SUGGESTION_ACCEPT'&&r.customer_id==='customer-A')&&!current.integration.recent.some(r=>r.event_type==='SIZE_RESULT_VIEW'&&r.customer_id==='customer-B')&&current.customer.ui.active_result===null);
 // A rejected dismissal never reaches the server and must not display success.
 await switchCustomer(customer,'customer-A');await reset(director,customer);await suggestion(customer);await fault(customer,'event','AI_SUGGESTION_DISMISS','before');
 await customer.click('#suggestion-dismiss');await customer.wait('window.__edgeFault.used','dismissal intercepted');await customer.wait('!document.querySelector("#suggestion-dismiss").disabled','dismiss restored');await delay(450);
 check('Failed dismissal retains offered suggestion and server eligibility',(await state('customer-A')).customer.suggestion_visible&&await customer.evaluate('!document.querySelector("#suggestion").hidden'));
 check('Failed dismissal reports failure without a success toast',await customer.evaluate('document.querySelector("#toast").innerText.includes("Injected network interruption")&&!document.querySelector("#toast").innerText.includes("다시 표시하지")'));
 // Keep each saved modal open while the virtual customer selector emits its normal change event.
 await reset(director,customer);
 const restores=[
  {view:'purchase',delta:{purchase:1},title:'구매 정보 확인',open:()=>customer.click('#purchase-button')},
  {view:'detail',delta:{detail:1},title:'상품상세',open:()=>customer.click('[data-detail="description"]')},
  {view:'guide',delta:{},title:'GS AI LIVE 체험 안내',open:()=>customer.click('#guide-button')},
  {view:'complete',delta:{purchase:1,complete:1},title:'구매 체험 완료',open:async()=>{await customer.click('#purchase-button');await customer.click('#demo-order');await customer.wait('document.querySelector("#sheet-title").innerText==="구매 체험 완료"')}}
 ];
 for(const item of restores){await closeSheet(customer);const initial=measuredCounts(await state());const expected={...initial};for(const [key,increment] of Object.entries(item.delta))expected[key]+=increment;await item.open();await until(s=>s.integration.customers.find(c=>c.id==='customer-A').active_result===item.view,item.view+' saved');await until(s=>JSON.stringify(measuredCounts(s))===JSON.stringify(expected),'initial view events committed');const before=measuredCounts(await state());await switchCustomer(customer,'customer-B');check('Switching from '+item.view+' isolates B screen',await customer.evaluate('!document.querySelector("#dialog").open'));await switchCustomer(customer,'customer-A');await customer.wait(`document.querySelector('#dialog').open&&document.querySelector('#sheet-title').innerText===${JSON.stringify(item.title)}`,item.view+' restored');await delay(450);const after=measuredCounts(await state());check('Restoring '+item.view+' preserves view without duplicate behavior',JSON.stringify(after)===JSON.stringify(before),{before,after});}
 await closeSheet(customer);
 // A pre-send publication failure must leave both the server and customer untouched.
 await director.click('.nav [data-view="activity"]');await director.fill('#notice-text','실패 검증용 공용 안내');await fault(director,'notice_publish',null,'before');await director.click('#notice-publish');await director.wait('window.__edgeFault.used&&!document.querySelector("#notice-publish").disabled','publication failure returned');
 check('Failed notice publication is not claimed as published',(await state()).integration.notices.length===0&&await director.evaluate('document.querySelector("#notice-form-status").innerText.includes("확인하지 못했습니다")&&!document.querySelector("#notice-list [data-notice-id]")'));
 check('Failed public notice never appears on customer',await customer.evaluate('!document.querySelector("#messages").innerText.includes("실패 검증용")'));
 // Lose only the response after a real successful commit, then retry exactly that draft.
 await director.fill('#notice-text','응답 유실 후 재시도하는 공용 안내');await director.fill('#notice-route','size');await fault(director,'notice_publish',null,'after');await director.click('#notice-publish');await director.wait('window.__edgeFault.committed&&!document.querySelector("#notice-publish").disabled','committed response lost');
 current=await until(s=>s.integration.notices.length===1,'notice exists after lost response');const noticeId=current.integration.notices[0].notice_id;
 check('Lost notice response keeps draft and does not claim success',await director.evaluate('document.querySelector("#notice-text").value==="응답 유실 후 재시도하는 공용 안내"&&document.querySelector("#notice-form-status").innerText.includes("확인하지 못했습니다")'));
 await director.click('#notice-publish');await director.wait('document.querySelector("#notice-text").value===""','retry acknowledged');
 const requests=await director.evaluate('window.__edgeRequests');
 check('Notice retry reuses the committed identifier',requests.at(-1).notice_id===noticeId&&requests.at(-2).notice_id===noticeId);
 check('Lost response and retry produce one shared notice',(await state()).integration.notices.length===1);
 await customer.wait(`!!document.querySelector('[data-notice-id="${noticeId}"]')`,'shared notice received');
 check('Customer renders the retried notice once',await customer.evaluate(`document.querySelectorAll('[data-notice-id="${noticeId}"]').length===1`));
 // Reset invalidates a pending committed response. Final states must use the new run.
 await closeSheet(customer);await reset(director,customer);await suggestion(customer);await fault(customer,'event','AI_SUGGESTION_ACCEPT','delay');await customer.click('#suggestion-accept');await customer.wait('window.__edgeFault.committed','old-run acceptance committed');
 await director.click('#demo-reset');const fresh=await state();await customer.evaluate('window.__edgeRelease()');await customer.wait(`gsApp.getState().state?.run_id===${JSON.stringify(fresh.run_id)}`,'fresh run restored');await delay(650);
 current=await state('customer-A');
 check('Reset clears delayed acceptance and old result in both screens',current.run_id===fresh.run_id&&!current.customer.detected&&current.integration.totals.size_views===0&&await customer.evaluate('!document.querySelector("#dialog").open')&&await director.evaluate(`document.body.dataset.runId===${JSON.stringify(fresh.run_id)}`));
 check('Reset removes prior public notices and persisted result',current.integration.notices.length===0&&current.customer.ui.active_result===null);
 check('No uncaught browser exceptions during failures and context changes',[...customer.errors,...director.errors].length===0);
 report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();});
