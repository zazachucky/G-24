// Real Chrome/HTTP verification of reviewed video knowledge and native seek behavior.
const fs = require('node:fs');
const path = require('node:path');
const {launch, delay} = require('./browser_driver.cjs');
const base = process.env.GS_VIDEO_URL || 'http://127.0.0.1:8782';
const evidence = path.resolve(__dirname, '../docs/evidence');
const REF = 'reference-core-authentic-cardigan-01', SAMPLE = 'main-product-sample-120s';
const report = {status:'RUNNING', started_at:new Date().toISOString(), server:base,
  scope:'Actual HTTP state and Chrome playback/seek. Reference answers use reviewed original video frames; authored sample uses its production script. ASR accuracy and unrestricted real-time video understanding are not claimed.',
  checks:[], screenshots:[], media:{}};
let browser;
const check = (name, result, details) => {if (!result) throw new Error(name + (details ? ': '+JSON.stringify(details) : '')); report.checks.push({name,status:'PASS',...(details ? {details} : {})}); console.log('PASS',name);};
async function state(customer) {return (await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''))).json();}
async function action(action, extra={}) {const s=await state();const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:s.run_id,...extra})});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;}
async function boot(page) {await page.wait('!!window.gsApp?.getState().state && !!document.querySelector("#video-asset")','video-enabled customer ready');}
async function ask(page, text) {
  const count=await page.evaluate('gsApp.getState().state.customer.messages.filter(m=>m.actor==="ASK_LIVE"&&m.status==="complete").length');
  await page.fill('#ask-input',text);await page.click('#ask-submit');
  await page.wait(`gsApp.getState().state.customer.messages.filter(m=>m.actor==='ASK_LIVE'&&m.status==='complete').length>${count}`,'video answer completes');
  return page.evaluate('gsApp.getState().state.customer.messages.filter(m=>m.actor==="ASK_LIVE"&&m.status==="complete").at(-1)');
}
async function pauseAt(page, at) {
  if (!(await page.evaluate('document.querySelector("#live-video").paused'))) await page.click('#video-play');
  await page.wait('document.querySelector("#live-video").paused','player paused');
  await page.fill('#video-seek',String(at));
  await page.wait(`Math.abs(document.querySelector('#live-video').currentTime-${at})<.2`,'seek control target');
  await page.wait(`Math.abs(gsApp.getState().state.customer.ui.video_time-${at})<.3 && gsApp.getState().state.customer.ui.video_paused`,'media snapshot saved');
}
async function shot(page, name) {await page.screenshot(path.join(evidence,name+'.png'));report.screenshots.push(name+'.png');}
const citationSelector = answer => `[data-message-id="${answer.message_id}"] [data-video-jump]`;

(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  await action('demo_start');
  browser=await launch();
  const a=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
  const b=await browser.page(base+'/app/customer.html?customer=customer-B',390,844,true);
  await Promise.all([boot(a),boot(b)]);
  const domainBefore=(await state()).now;
  await a.fill('#media-mode','video');
  await a.wait('document.querySelector("#live-video").readyState>=2&&!document.querySelector("#live-video").hidden','reference loads');
  check('Catalog offers separate reference and authored sample assets',await a.evaluate(`document.querySelectorAll('#video-asset option').length===2 && gsApp.getState().ui.video_asset_id===${JSON.stringify(REF)}`));
  check('Reference keeps explicit current-product mismatch label',await a.evaluate('document.querySelector("#video-info").innerText.includes("현재 상품과 다름")'));
  await pauseAt(a,12.3);
  const summary=await ask(a,'방송 내용 요약해줘');
  check('Reference summary cites reviewed original frames',summary.intent==='VIDEO_CONTENT'&&summary.provenance==='reviewed_video_frames'&&summary.source_refs.every(p=>p.includes('transcript-frames/'))&&summary.text.includes('현재 상품과 다른'));
  const question='검수 A만: 영상에서 재킷 코디한 장면 찾아줘';
  const jacket=await ask(a,question);
  check('Reference jacket question returns actual 34-second evidence',jacket.video?.asset_id===REF&&jacket.video.start===34&&jacket.text.includes('재킷에도 찰떡'));
  await a.click(citationSelector(jacket));
  await a.wait('document.querySelector("#live-video").currentTime>=34&&document.querySelector("#live-video").currentTime<37','message CTA seeks native player');
  check('Message scene button changes native video time',await a.evaluate('!document.querySelector("#live-video").paused'));
  await a.click('#video-return');
  await a.wait('Math.abs(document.querySelector("#live-video").currentTime-12.3)<.2&&document.querySelector("#live-video").paused','original paused position restored');
  check('Previous viewing position restores original asset time and pause state',await a.evaluate(`gsApp.getState().ui.video_asset_id===${JSON.stringify(REF)} && document.querySelector('#video-return').hidden`));
  await pauseAt(a,47);
  const beforeCurrent=await a.evaluate('gsApp.getState().state.customer.messages.length');
  await a.click('#video-current-ask');
  await a.wait(`gsApp.getState().state.customer.messages.length>${beforeCurrent+1}`,'current-frame response');
  const current=await a.evaluate('gsApp.getState().state.customer.messages.filter(m=>m.actor==="ASK_LIVE").at(-1)');
  check('Current scene question uses actual 47-second player clock',current.video?.start===46&&current.text.includes('공통 블랙 + 선택 1컬러'));
  const unavailable=await ask(a,'모델은 몇 사이즈 입었어?');
  check('Unverified worn size stays unsupported without a scene citation',unavailable.intent==='UNSUPPORTED_VIDEO'&&!unavailable.video&&unavailable.text.includes('확인'));
  check('Other customer and public Director state exclude private video question',!(await b.evaluate('document.querySelector("#messages").innerText')).includes(question)&&!JSON.stringify(await state()).includes(question));
  check('Video seek is present in shared event data without question text',(await state()).logs.some(log=>log.action==='VIDEO_SCENE_SEEK'&&log.detail?.metadata?.chapter_id==='REF_JACKET'));
  await a.click('[data-mode="landscape"]');
  await a.evaluate(`document.querySelector('[data-message-id="${current.message_id}"]').scrollIntoView({block:'center',behavior:'instant'});document.querySelector('.primary').scrollTop=0;`);
  await shot(a,'video-experience-reference-answer');
  await a.click('[data-mode="portrait"]');

  await a.fill('#video-asset',SAMPLE);
  await a.wait('Math.abs(document.querySelector("#live-video").duration-120)<.1','sample loads actual 120 seconds');
  check('Sample selection uses real 120-second asset and authored-source label',await a.evaluate(`gsApp.getState().ui.video_asset_id===${JSON.stringify(SAMPLE)}&&document.querySelector('#video-info').innerText.includes('제작 대본')`));
  const size=await ask(a,'샘플 영상에서 66 사이즈 실측 설명 찾아줘');
  check('Sample size answer preserves script provenance and real garment measurements',size.provenance==='script_reference_not_asr'&&size.video?.start===40&&size.text.includes('45센티미터')&&size.text.includes('61센티미터'));
  await a.click(citationSelector(size));
  await a.wait('document.querySelector("#live-video").currentTime>=40&&document.querySelector("#live-video").currentTime<44','sample citation seeks 40 seconds');
  await a.fill('#video-volume','0.7');
  if(await a.evaluate('document.querySelector("#live-video").muted'))await a.click('#video-mute');
  await delay(350);
  report.media.sample=await a.evaluate('(()=>{const v=document.querySelector("#live-video");return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,paused:v.paused,muted:v.muted,volume:v.volume,decoded_frames:v.getVideoPlaybackQuality().totalVideoFrames,audio_decoded_bytes:v.webkitAudioDecodedByteCount||0}})()');
  check('Sample MP4 has decoded frames and audio with functioning volume controls',report.media.sample.width===1920&&report.media.sample.height===1080&&report.media.sample.decoded_frames>0&&report.media.sample.audio_decoded_bytes>0&&!report.media.sample.muted&&Math.abs(report.media.sample.volume-.7)<.01,report.media.sample);
  check('Video playback and seeks leave frozen Need/approval clock unchanged',(await state()).now===domainBefore);
  await pauseAt(a,42.2);
  await a.click('#orientation-toggle');
  check('Orientation preserves selected sample and native paused position',await a.evaluate(`gsApp.getState().ui.video_asset_id===${JSON.stringify(SAMPLE)}&&document.querySelector('#live-video').paused&&Math.abs(document.querySelector('#live-video').currentTime-42.2)<.2`));
  await shot(a,'video-experience-sample-answer');
  await a.navigate(base+'/app/customer.html?customer=customer-A');await boot(a);
  await a.wait('Math.abs(document.querySelector("#live-video").duration-120)<.1&&Math.abs(document.querySelector("#live-video").currentTime-42.2)<.3','refresh restores sample position');
  check('Refresh restores asset time pause state and private video answer',await a.evaluate(`gsApp.getState().ui.video_asset_id===${JSON.stringify(SAMPLE)}&&document.querySelector('#live-video').paused&&document.querySelector('#messages').innerText.includes('45센티미터')`));
  const archivedJacket=await a.evaluate('gsApp.getState().state.customer.messages.find(m=>m.video?.chapter_id==="REF_JACKET")');
  await a.click(citationSelector(archivedJacket));
  await a.wait('document.querySelector("#live-video").duration<60&&document.querySelector("#live-video").currentTime>=34&&document.querySelector("#live-video").currentTime<38','archived citation switches back to referenced asset');
  await a.click('#video-return');
  await a.wait('Math.abs(document.querySelector("#live-video").duration-120)<.1&&Math.abs(document.querySelector("#live-video").currentTime-42.2)<.3&&document.querySelector("#live-video").paused','cross-asset return');
  check('Cross-asset citation returns to original sample and paused position',await a.evaluate(`gsApp.getState().ui.video_asset_id===${JSON.stringify(SAMPLE)}`));

  await a.fill('#customer-select','customer-B');
  await a.wait('gsApp.getState().state?.customer?.id==="customer-B"&&document.querySelector("#video-asset").value==="'+REF+'"','switch customer media isolation');
  check('Customer switch resets citation return state and excludes A answers',await a.evaluate('document.querySelector("#video-return").hidden&&!document.querySelector("#messages").innerText.includes("검수 A만")&&gsApp.getState().ui.media_mode==="image"'));
  await a.fill('#customer-select','customer-A');
  await a.wait('gsApp.getState().state?.customer?.id==="customer-A"&&Math.abs(document.querySelector("#live-video").duration-120)<.1&&Math.abs(document.querySelector("#live-video").currentTime-42.2)<.3','A media restored');
  check('Returning to A restores its asset and private video answers',await a.evaluate('document.querySelector("#messages").innerText.includes("검수 A만")&&document.querySelector("#live-video").paused'));
  const runBefore=(await state()).run_id;
  const reset=await action('reset');
  await a.wait(`gsApp.getState().state.run_id===${JSON.stringify(reset.run_id)}&&document.querySelector('#video-asset').value===${JSON.stringify(REF)}`,'reset clears selected asset');
  check('Reset clears video questions previous-position memory and playback state',reset.run_id!==runBefore&&await a.evaluate('gsApp.getState().ui.media_mode==="image"&&document.querySelector("#video-return").hidden&&!document.querySelector("#messages").innerText.includes("검수 A만")&&document.querySelector("#live-video").currentTime===0'));
  await a.fill('#media-mode','video');await a.wait('document.querySelector("#live-video").readyState>=2','reference reload');
  await a.evaluate('document.querySelector(".demo-toolbar details").open=true');await a.click('#simulate-media-error');
  await a.wait('gsApp.getState().ui.media_mode==="image"&&!document.querySelector("#media-error").hidden','media error fallback');
  check('Video error falls back to images and preserves customer actions',await a.evaluate('document.querySelector("#live-video").hidden&&!document.querySelector("#size-button").disabled&&!document.querySelector("#ask-input").disabled'));
  await a.fill('#video-asset',SAMPLE);await a.wait('Math.abs(document.querySelector("#live-video").duration-120)<.1&&!document.querySelector("#live-video").hidden','new asset recovers from error');
  check('Selecting a known asset recovers from simulated media failure',await a.evaluate('document.querySelector("#media-error").hidden'));
  await a.evaluate('document.querySelector(".demo-toolbar details").open=false');
  await a.viewport(390,844,true);await a.click('#orientation-toggle');
  check('Video controls and scene catalog fit mobile viewport',await a.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await shot(a,'video-experience-mobile');
  check('No uncaught browser exceptions during video evidence workflow',[...a.errors,...b.errors].length===0,[...a.errors,...b.errors]);
  report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'video-experience-verification.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();
});
