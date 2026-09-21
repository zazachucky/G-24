const fs = require('node:fs');
const path = require('node:path');
const {launch,delay} = require('./browser_driver.cjs');
const root = path.resolve(__dirname,'..');
const base = process.env.GS_DEMO_URL || 'http://127.0.0.1:8765';
const output = path.join(root,'docs/evidence');
const report = {status:'RUNNING',started_at:new Date().toISOString(),scope:'Actual local app, shared HTTP state and Chrome browser UI; Video AI not evaluated',checks:[],runs:[],media:{},screenshots:[]};
let browser;
const assert = (name,value,details) => {if(!value)throw new Error(name+(details?' '+JSON.stringify(details):''));report.checks.push({name,status:'PASS',...(details?{details}:{})});console.log('PASS',name);};
async function state(customer) {return (await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''))).json();}
async function action(action,extra={},customer) {const s=await state();const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:s.run_id,...(customer?{customer_id:customer}:{}),...extra})});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;}
async function boot(page){await page.wait('!!window.gsApp?.getState().state','customer boot');}
async function screenshot(page,name){const filename=name+'.png';await page.screenshot(path.join(output,filename));report.screenshots.push(filename);}
async function closeSheet(page){if(await page.evaluate('document.querySelector("#dialog").open')){await page.click('#dialog-close');await page.wait('!document.querySelector("#dialog").open','sheet closed');await delay(150);}}
async function ask(page,text){await page.fill('#ask-input',text);await page.click('#ask-submit');await page.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(text)})`,'question submitted');}
async function sync(page,run){await page.wait(`document.body.dataset.runId===${JSON.stringify(run)}`,'shared run synced');}
async function highlight(page,expected){await page.wait(`document.querySelector('#size-button').dataset.highlight===${JSON.stringify(String(expected))}`,'customer highlight '+expected);}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await action('reset');
  browser=await launch();
  const a=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
  const b=await browser.page(base+'/app/customer.html?customer=customer-B',390,844,true);
  const c=await browser.page(base+'/app/customer.html?customer=customer-C',390,844,true);
  const director=await browser.page(base+'/app/director.html',1440,1100);
  await Promise.all([boot(a),boot(b),boot(c)]);
  await director.wait('!!document.querySelector("#director-state")?.dataset.state','director boot');
  const appText=await a.evaluate('document.body.innerText');
  assert('C01 product price/review/stock snapshot',appText.includes('49,900')&&appText.includes('1,200')&&appText.includes('일시품절'));
  assert('C01 loaded actual product images',await a.evaluate('document.querySelector("#gallery-image").naturalWidth>0'));
  await screenshot(a,'customer-portrait');
  await screenshot(b,'customer-mobile');
  assert('UI-04 mobile no horizontal overflow',await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));

  // Actual customer UI signals, observed in a different Director browser page.
  await a.click('[data-detail="size"]');
  await a.wait('!!document.querySelector(".size-table")','size chart');
  assert('C06 eight garment measurements',await a.evaluate('document.querySelectorAll(".size-table tbody tr").length===8'));
  const originalLink=await a.evaluate('document.querySelector("#sheet-content a.source").getAttribute("href")');
  assert('C06 valid size chart source',Boolean(originalLink)&&!originalLink.includes('undefined'));
  await a.click('#size-reviews');
  await a.wait('document.querySelector("#sheet-content").innerText.includes("99%")','original review ratios');
  assert('C03 original 99% preserved',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("1,202")'));
  await closeSheet(a);
  await a.wait('!document.querySelector("#suggestion").hidden','personal need suggestion');
  const uiEvidence=await state('customer-A');
  assert('D01 actual UI triggered Need',uiEvidence.customer.detected&&uiEvidence.counts.ui_events>=2);
  await director.wait('document.querySelector("#customer-table").innerText.includes("감지")','Director received real UI signals');
  assert('UI-03 Director same run',await director.evaluate('document.body.innerText.includes("고객 A")'));
  await screenshot(director,'director-ui-signal');
  await a.click('#suggestion-accept');await a.wait('document.querySelector("#sheet-title").innerText==="내 사이즈"','accepted size result');await closeSheet(a);

  for (const [question,expected] of [['두께감 어때?','63%'],['색상이 화면과 비슷해?','91%'],['상품후기 알려줘','68%'],['오늘 주문하면 언제 와?','배송 시뮬레이션'],['모델은 몇 사이즈 입었어?','착용 사이즈']]) {
    await ask(a,question);await a.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(expected)})`,'ASK evidence '+expected);
    assert('ASK supported/unsupported: '+question,true);
  }
  assert('C08 customer B has no A private question',!(await b.evaluate('document.querySelector("#messages").innerText')).includes('두께감 어때?'));
  const publicState=await state();
  assert('C08 Director has no private question payload',!JSON.stringify(publicState).includes('모델은 몇 사이즈'));
  assert('C08 shared operator has no customer identifier',(await state('customer-A')).customer.messages.find(m=>m.actor==='OPERATOR').customer_id===null);
  await a.click('#benefit-button');await a.wait('document.querySelector("#sheet-content").innerText.includes("4,385")','benefit total');
  assert('C07 prepared benefit calculation',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("45,515")&&document.querySelector("#sheet-content").innerText.includes("데모 혜택 예시")'));
  await closeSheet(a);

  await a.click('#styling-button');
  for(const [id,productIds] of [['LOOK_01',['1103554292','1092943486']],['LOOK_02',['1103680106','1110407317']],['LOOK_03',['1052764372','1085417942']]]){
    await a.click(`.look-tabs [data-look="${id}"]`);
    await a.wait('!!document.querySelector(".look-image img")?.naturalWidth','lookbook loaded');
    await a.wait('document.querySelectorAll(".look-items img").length===3&&[...document.querySelectorAll(".look-items img")].every(i=>i.complete&&i.naturalWidth>0)','all selected Look product images loaded');
    const links=await a.evaluate('[...document.querySelectorAll(".look-items [data-product-link]")].map(a=>a.href)');
    assert('S01 actual linked products '+id,productIds.every(id=>links.some(link=>link.includes(id))));
    assert('S01 loaded real product cards '+id,await a.evaluate('[...document.querySelectorAll(".look-items img")].every(i=>i.complete&&i.naturalWidth>0)'));
  }
  await screenshot(a,'customer-styling');
  await a.evaluate('document.querySelector(".look-image img").src="/assets/lookbooks/missing-test.png"');
  await a.wait('document.querySelector("#sheet-content").innerText.includes("불러오지 못했어요")','image fallback');
  assert('S02 image failure retains actual product cards and thumbnails',await a.evaluate('document.querySelectorAll(".look-items [data-product-link]").length===2&&document.querySelectorAll(".look-products [data-styling-product]").length===3&&[...document.querySelectorAll(".look-products img")].every(i=>i.complete&&i.naturalWidth>0)'));
  await closeSheet(a);
  await a.click('[data-size="77"]');await a.click('#gallery-next');
  const preserved=await a.evaluate('gsApp.getState()');
  await a.click('[data-mode="landscape"]');await a.wait('document.body.classList.contains("landscape")','landscape');
  await screenshot(a,'customer-landscape');
  const afterOrientation=await a.evaluate('gsApp.getState()');
  assert('C02 orientation preserves selections and conversation',afterOrientation.ui.size==='77'&&afterOrientation.ui.look===preserved.ui.look&&afterOrientation.ui.image_index===preserved.ui.image_index&&afterOrientation.state.customer.messages.length===preserved.state.customer.messages.length);
  await a.click('[data-mode="portrait"]');
  await a.click('#purchase-button');await a.wait('document.querySelector("#sheet-content").innerText.includes("구매 시뮬레이션")','purchase preview');
  await a.click('[data-color="블랙"]');await a.click('[data-purchase-size="66"]');
  assert('C06 purchase selected options',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("블랙 / 66")'));
  await a.key('Escape');await a.wait('!document.querySelector("#dialog").open','Escape closes dialog');
  assert('UI-04 dialog restores focus',await a.evaluate('document.activeElement.id==="purchase-button"'));

  // Error/latency adapter is local: actual UI request, 5s deadline, single fallback.
  await a.fill('#ask-fault','delay');await ask(a,'두께감 알려줘');
  await a.wait('!!document.querySelector("#messages .processing")','pending response');
  await a.click('[data-mode="landscape"]');
  await a.wait('!document.querySelector("#messages .processing")','5s fallback',7000);
  const delayed=(await state('customer-A')).customer.messages.filter(m=>m.actor==='ASK_LIVE'&&m.fallback);
  assert('F01 same intent 5s fallback once',delayed.length===1&&delayed[0].text.includes('63%'));
  await delay(1500);
  assert('F01 late adapter response not duplicated',(await state('customer-A')).customer.messages.filter(m=>m.actor==='ASK_LIVE'&&m.fallback).length===1);
  await a.fill('#ask-fault','');await a.click('[data-mode="portrait"]');

  // Three complete browser journeys, with independent A/B/C customer pages.
  for(let round=1;round<=3;round++){
    await director.click('#demo-reset');await delay(250);
    await director.click('#demo-start');
    await director.wait('Number(document.querySelector("#clock").dataset.now)===68','demo68');
    let current=await state();await Promise.all([sync(a,current.run_id),sync(b,current.run_id),sync(c,current.run_id)]);
    await a.wait('!document.querySelector("#suggestion").hidden','A suggestion after reset');
    assert('D05 round '+round+' C rejected / manual size available',(await state('customer-C')).customer.dismissed&&await c.evaluate('!document.querySelector("#size-button").disabled'));
    await a.click('#suggestion-accept');await a.wait('document.querySelector("#dialog").open','A accepts');await closeSheet(a);
    await director.click('#demo-spike');
    await director.wait('document.querySelector("#director-state").dataset.state==="ALERT"','computed spike');
    current=await state();assert('D03 round '+round+' actual 8→26 +225%',current.campaign.evidence.previous_customers===8&&current.campaign.evidence.current_customers===26&&current.campaign.evidence.change_percent===225);
    await Promise.all([highlight(a,false),highlight(b,false),highlight(c,false)]);
    if(round===1){await screenshot(director,'director-alert');await director.click('#host-review');await director.wait('!!document.querySelector("#host-confirm")','host preview');await director.click('#host-reviewed');await director.click('#host-confirm');await director.wait('document.querySelector("#director-state").dataset.state==="ACTION"','host action');assert('D07 host action independent',(await state()).campaign.approval===null);await highlight(a,false);}
    await director.click('#app-approve');await director.wait('!!document.querySelector("#approval-confirm")','approval dialog');
    await director.click('#approval-confirm');await director.wait('Number(document.querySelector("#clock").dataset.now)===121','approval121');
    current=await state();assert('D04 round '+round+'33 fixed targets',current.campaign.approval.targets.length===33&&current.campaign.approval.targets.includes('customer-A')&&!current.campaign.approval.targets.includes('customer-B')&&!current.campaign.approval.targets.includes('customer-C'));
    await Promise.all([highlight(a,true),highlight(b,false),highlight(c,false)]);
    assert('D04 round '+round+' no forced result',!(await a.evaluate('document.querySelector("#dialog").open')));
    if(round===1)await screenshot(a,'customer-approved');
    await director.click('#result-show');await director.wait('document.querySelector("#director-state").dataset.state==="RESULT"','result151');
    current=await state();assert('D08 round '+round+' result151 fixed simulation',current.now===151&&current.campaign.result.source==='Prototype Simulation'&&current.campaign.result.metrics.map(m=>m.change_percent).join(',')==='-58,207,16');
    if(round===1)await screenshot(director,'director-result');
    await director.click('#expire-action');await director.wait('Number(document.querySelector("#clock").dataset.now)===421','expiry421');await highlight(a,false);
    assert('D06 round '+round+' expiry',!(await state('customer-A')).customer.highlight);
    report.runs.push({round,status:'PASS',run_id:current.run_id,spike:[8,26],targets:33,approved_at:121,result_at:151,expires_at:421});
  }

  // Media does not change the frozen domain clock, even when ending/replaying.
  await a.fill('#media-mode','video');await a.wait('document.querySelector("#live-video").readyState>=2&&!document.querySelector("#live-video").hidden','actual MP4 ready');
  const beforeMedia=await state();
  assert('MEDIA-04 mismatch label',await a.evaluate('document.querySelector("#video-info").innerText.includes("현재 상품과 다름")'));
  await a.click('#video-play');await a.wait('document.querySelector("#live-video").currentTime>.3','MP4 playback advances');await a.click('#video-play');
  await a.fill('#video-seek','22');await a.wait('Math.abs(document.querySelector("#live-video").currentTime-22)<.2','seek22');
  await a.click('#video-mute');await a.fill('#video-volume','0.6');
  const beforeSwitch=await a.evaluate('gsApp.getVideo()');
  await a.click('[data-mode="landscape"]');await a.click('#benefit-button');await closeSheet(a);
  const afterSwitch=await a.evaluate('gsApp.getVideo()');
  assert('MEDIA-02 orientation/sheet preserves player',Math.abs(beforeSwitch.time-afterSwitch.time)<.2&&beforeSwitch.paused===afterSwitch.paused&&beforeSwitch.muted===afterSwitch.muted&&Math.abs(afterSwitch.volume-.6)<.01);
  report.media=await a.evaluate('(()=>{const v=document.querySelector("#live-video");return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,object_fit:getComputedStyle(v).objectFit,decoded_frames:v.getVideoPlaybackQuality().totalVideoFrames,audio_decoded_bytes:v.webkitAudioDecodedByteCount??null}})()');
  assert('MEDIA-01 57.9s 9:16 video/audio decode',Math.abs(report.media.duration-57.9)<.1&&report.media.width===720&&report.media.height===1280&&report.media.decoded_frames>0&&report.media.audio_decoded_bytes>0,report.media);
  assert('MEDIA-02 full frame contain',report.media.object_fit==='contain');
  await screenshot(a,'customer-reference-video');
  await a.fill('#video-seek',String(report.media.duration-.15));await a.click('#video-play');await a.wait('document.querySelector("#live-video").ended','video ended');
  const afterMedia=await state();
  assert('MEDIA-03 playback/seek/end independent from scenario',afterMedia.now===beforeMedia.now&&afterMedia.counts.detected===beforeMedia.counts.detected&&afterMedia.counts.fixture_events===beforeMedia.counts.fixture_events&&JSON.stringify(afterMedia.campaign)===JSON.stringify(beforeMedia.campaign));
  // Opening benefit above records one UI event; media operations record none.
  await a.click('#video-play');await a.wait('document.querySelector("#live-video").currentTime<3&&!document.querySelector("#live-video").paused','replay');await a.click('#video-play');
  assert('MEDIA-03 replay does not reset domain',(await state()).run_id===beforeMedia.run_id&&(await state()).now===421);
  await a.evaluate('document.querySelector("#live-video").src="/assets/video/reference/missing-test.mp4";document.querySelector("#live-video").load()');
  await a.wait('!document.querySelector("#media-error").hidden&&document.querySelector("#live-video").hidden','real missing file fallback');
  assert('MEDIA-06 nonvideo features remain usable',await a.evaluate('!document.querySelector("#ask-input").disabled'));
  await a.click('[data-mode="portrait"]');await ask(a,'배송 일정 알려줘');await a.wait('document.querySelector("#messages").innerText.includes("배송 시뮬레이션")','ASK after video fail');

  // Pending responses from the old run cannot reappear after a real UI reset.
  await a.fill('#ask-fault','delay');await ask(a,'두께감 어때?');await a.wait('!!document.querySelector(".processing")','pending beforeReset');
  await director.click('#demo-reset');const resetRun=(await state()).run_id;await sync(a,resetRun);await delay(5500);
  assert('F02 reset cancels old requests',(await state('customer-A')).customer.messages.length===1);
  const finalState=await state();assert('F02 reset clears approval/detections/result',!finalState.campaign.approval&&!finalState.campaign.result&&finalState.counts.detected===0);
  await director.viewport(390,844,true);await delay(100);
  assert('UI-04 Director narrow viewport no overflow',await director.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await screenshot(director,'director-mobile');
  const allErrors=[...a.errors,...b.errors,...c.errors,...director.errors];assert('No uncaught browser exceptions',allErrors.length===0,allErrors);
  report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(output,'browser-verification.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
  console.log('Report:',path.join(output,'browser-verification.json'));
});
