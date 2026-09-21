// Real Chrome/HTTP regression for media selection and unchanged polling.
// CDP cannot reliably operate the OS-native select popup on this macOS runner.
// Selection is dispatched through the DOM change event; popup pointer interaction is not claimed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {launch, delay} = require('./browser_driver.cjs');
const base = process.env.GS_MEDIA_SELECTION_URL || 'http://127.0.0.1:8812';
const evidence = path.resolve(__dirname, '../docs/evidence');
const REF = 'reference-core-authentic-cardigan-01', SAMPLE = 'main-product-sample-120s';
const report = {status:'RUNNING', started_at:new Date().toISOString(), server:base,
  scope:'Chrome media element, same-origin HTTP state, browser playback and actual select change handling. Polling instrumentation checks both select value setters and option DOM mutations. The OS-native select popup is not automated by this CDP runner.',
  checks:[], screenshots:[], source_sha256:{}};
let browser;
const check = (name, result, details) => {
  if (!result) throw new Error(name + (details ? ': '+JSON.stringify(details) : ''));
  report.checks.push({name,status:'PASS',...(details ? {details} : {})}); console.log('PASS',name);
};
async function action(action, extra={}) {
  const state=await (await fetch(base+'/api/state')).json();
  const response=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:state.run_id,...extra})});
  const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;
}
async function settle(page) {
  await page.wait('document.querySelector("#live-video").readyState>=2','media metadata ready');
  await delay(600);
}
async function checkQuietPolling(page, label) {
  await page.evaluate(`(() => {
    const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    const probe=window.__mediaPollingProbe={writes:[],mutations:[],polls:0,observers:[],fetch:window.fetch};
    for(const id of ['media-mode','video-asset']) {
      const select=document.getElementById(id);
      Object.defineProperty(select,'value',{configurable:true,get(){return descriptor.get.call(this);},set(value){probe.writes.push({id,value});descriptor.set.call(this,value);}});
      const observer=new MutationObserver(records=>probe.mutations.push(...records.map(record=>({id,type:record.type}))));
      observer.observe(select,{subtree:true,childList:true,characterData:true});probe.observers.push(observer);
    }
    window.fetch=function(...args){if(String(args[0]).startsWith('/api/state'))probe.polls++;return probe.fetch.apply(this,args);};
  })()`);
  await delay(1700);
  const result=await page.evaluate(`(() => {
    const probe=window.__mediaPollingProbe;
    const result={polls:probe.polls,value_writes:probe.writes,option_mutations:probe.mutations};
    window.fetch=probe.fetch;probe.observers.forEach(observer=>observer.disconnect());
    for(const id of ['media-mode','video-asset'])delete document.getElementById(id).value;
    delete window.__mediaPollingProbe;return result;
  })()`);
  check(label,result.polls>=2&&result.value_writes.length===0&&result.option_mutations.length===0,result);
}
async function selectVideo(page, asset, duration) {
  await page.evaluate('document.querySelector("#video-asset").scrollIntoView({block:"center",behavior:"instant"})');
  await page.fill('#video-asset',asset);
  await page.wait(`gsApp.getState().ui.media_mode==='video'&&gsApp.getState().ui.video_asset_id===${JSON.stringify(asset)}&&!document.querySelector('#live-video').hidden&&document.querySelector('#live-video').readyState>=2&&Math.abs(document.querySelector('#live-video').duration-${duration})<.2`,'selected media loads');
  await page.wait(`gsApp.getState().state.customer.ui.media_mode==='video'&&gsApp.getState().state.customer.ui.video_asset_id===${JSON.stringify(asset)}`,'media selection persisted');
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function shot(page,name) {await page.screenshot(path.join(evidence,name+'.png'));report.screenshots.push(name+'.png');}

(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  for(const file of ['app/customer.js','app/video_experience.js','scripts/check_media_selection.cjs'])report.source_sha256[file]=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex');
  await action('demo_start');browser=await launch();
  const page=await browser.page(base+'/app/customer.html?customer=customer-A',390,844,true);
  await page.wait('!!window.gsApp?.getState().state&&!!document.querySelector("#video-asset")','customer ready');
  await settle(page);
  const initial=await page.evaluate(`(() => {const select=document.querySelector('#video-asset');return {mode:gsApp.getState().ui.media_mode,stored_asset:gsApp.getState().ui.video_asset_id,value:select.value,prompt:select.selectedOptions[0].textContent,disabled_prompt:select.selectedOptions[0].disabled,assets:[...select.options].filter(option=>option.value).map(option=>option.value)}})()`);
  check('Image mode shows a choice prompt while preserving reference identity',initial.mode==='image'&&initial.value===''&&initial.stored_asset===REF&&initial.disabled_prompt&&initial.prompt.includes('선택'),initial);
  check('Reference and sample remain the two playable catalog choices',JSON.stringify(initial.assets)===JSON.stringify([REF,SAMPLE]),initial.assets);
  await checkQuietPolling(page,'Image-mode polling leaves select values and option DOM untouched');
  await page.evaluate('document.querySelector("#video-asset").scrollIntoView({block:"center",behavior:"instant"})');
  await shot(page,'media-selection-image-prompt-390');
  const referenceDuration=await page.evaluate('document.querySelector("#live-video").duration');
  await selectVideo(page,REF,referenceDuration);
  check('Choosing the initial reference explicitly enters video mode',await page.evaluate(`document.querySelector('#video-asset').value===${JSON.stringify(REF)}&&document.querySelector('#media-mode').value==='video'&&document.querySelector('#live-video').currentSrc.endsWith('/reference/core-authentic-cardigan.mp4')`));
  const visibility=await page.evaluate(`(() => {const r=document.querySelector('#media-stage').getBoundingClientRect(),scroll=document.querySelector('.device-scroll').getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible_height:Math.max(0,Math.min(r.bottom,scroll.bottom,innerHeight)-Math.max(r.top,scroll.top,0))};})()`);
  check('Explicit selection reveals the video inside the mobile scroll viewport',visibility.visible_height>=100,visibility);
  await shot(page,'media-selection-reference-390');
  await settle(page);await checkQuietPolling(page,'Paused-video polling leaves select values and option DOM untouched');
  await page.click('#video-play');
  await page.wait('!document.querySelector("#live-video").paused&&document.querySelector("#live-video").currentTime>.5','reference playback advances');
  const playback=await page.evaluate('(()=>{const v=document.querySelector("#live-video");return {time:v.currentTime,width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality().totalVideoFrames}})()');
  check('Reference MP4 plays with advancing time and decoded portrait frames',playback.time>.5&&playback.width>0&&playback.height>playback.width&&playback.frames>0,playback);
  await page.click('#video-play');await page.wait('document.querySelector("#live-video").paused','pause before switching');

  await selectVideo(page,SAMPLE,120);
  check('Switching to the sample changes the native source and label',await page.evaluate(`document.querySelector('#live-video').currentSrc.endsWith('/test-live/gs-ai-live-test-120s.mp4')&&document.querySelector('#media-mode option[value="video"]').textContent==='상품 설명 샘플'&&document.querySelector('#video-info').innerText.includes('제작 대본')`));
  await page.fill('#media-mode','image');
  await page.wait('gsApp.getState().state.customer.ui.media_mode==="image"&&document.querySelector("#video-asset").value===""','image mode returns to prompt');
  check('Image mode hides and pauses video while retaining the remembered sample',await page.evaluate(`document.querySelector('#live-video').hidden&&document.querySelector('#live-video').paused&&!document.querySelector('#gallery-image').hidden&&gsApp.getState().ui.video_asset_id===${JSON.stringify(SAMPLE)}`));
  await selectVideo(page,REF,referenceDuration);
  check('Reference remains selectable after changing sample back to images',await page.evaluate(`document.querySelector('#video-asset').value===${JSON.stringify(REF)}&&!document.querySelector('#live-video').hidden`));
  await page.fill('#media-mode','image');await page.wait('gsApp.getState().state.customer.ui.media_mode==="image"','reference image mode saved');
  await selectVideo(page,REF,referenceDuration);
  check('Choosing the same remembered reference after image mode starts video again',await page.evaluate(`gsApp.getState().ui.media_mode==='video'&&gsApp.getState().ui.video_asset_id===${JSON.stringify(REF)}&&document.querySelector('#video-asset').value===${JSON.stringify(REF)}`));
  await page.fill('#media-mode','image');await page.wait('gsApp.getState().state.customer.ui.media_mode==="image"','legacy mode image saved');
  await page.fill('#media-mode','video');
  await page.wait('!document.querySelector("#live-video").hidden&&gsApp.getState().state.customer.ui.media_mode==="video"','broadcast screen selector still works');
  check('Broadcast-screen mode selector still restores the remembered video',await page.evaluate(`document.querySelector('#video-asset').value===${JSON.stringify(REF)}`));

  await page.evaluate('document.querySelector(".demo-toolbar details").open=true');await page.click('#simulate-media-error');
  await page.wait('gsApp.getState().ui.media_mode==="image"&&!document.querySelector("#media-error").hidden','fallback after media error');
  check('Media error returns to images and the video-choice prompt',await page.evaluate('document.querySelector("#video-asset").value===""&&document.querySelector("#live-video").hidden&&!document.querySelector("#ask-input").disabled'));
  await page.evaluate('document.querySelector(".demo-toolbar details").open=false');
  await selectVideo(page,REF,referenceDuration);
  check('The same reference can be reselected after the error fallback',await page.evaluate('document.querySelector("#media-error").hidden&&!document.querySelector("#live-video").hidden'));
  await page.click('#video-play');await page.wait('!document.querySelector("#live-video").paused&&document.querySelector("#live-video").currentTime>.5','retry playback works');
  check('Retried reference actually resumes playback',await page.evaluate('document.querySelector("#live-video").getVideoPlaybackQuality().totalVideoFrames>0'));
  await page.evaluate('document.querySelector("#live-video").src="/assets/video/reference/selection-test-missing.mp4";document.querySelector("#live-video").load()');
  await page.wait('!!document.querySelector("#live-video").error&&gsApp.getState().ui.media_mode==="image"&&!document.querySelector("#media-error").hidden','real missing-file error falls back');
  check('A real missing MP4 returns to images and the choice prompt',await page.evaluate('document.querySelector("#video-asset").value===""&&gsApp.getMediaErrors().some(error=>!error.simulated&&error.code===4)'));
  await selectVideo(page,REF,referenceDuration);
  check('Explicit same-reference retry reloads the valid source after a real MP4 failure',await page.evaluate('!document.querySelector("#live-video").error&&document.querySelector("#live-video").readyState>=2&&document.querySelector("#live-video").currentSrc.endsWith("/reference/core-authentic-cardigan.mp4")&&document.querySelector("#media-error").hidden'));
  await page.click('#video-play');await page.wait('!document.querySelector("#live-video").paused&&document.querySelector("#live-video").currentTime>.5','real error retry plays');
  check('The reloaded reference decodes and plays after real-file error recovery',await page.evaluate('document.querySelector("#live-video").getVideoPlaybackQuality().totalVideoFrames>0'));
  check('No uncaught browser exceptions in media selection workflows',page.errors.length===0,page.errors);
  report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'media-selection-verification.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();
});
