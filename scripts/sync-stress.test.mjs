import assert from 'node:assert/strict';
import { launchBrowser } from './browser-harness.mjs';
const browser=await launchBrowser();
try {
  const mobile=await browser.page('http://127.0.0.1:4173/mobile.html');
  const director=await browser.page('http://127.0.0.1:4173/director.html',1440,1100);
  await director.evaluate(`window.GSAILiveState.emit('RESET')`);
  await mobile.waitFor(`window.GSAILiveState.read().runId===2`);
  const result=await Promise.all([mobile.evaluate(`Promise.all(Array.from({length:40},()=>window.GSAILiveState.emit('CUSTOMER_EVENT',{eventType:'ASK_LIVE_SUBMIT',intent:'color'},'stress'))).then(()=>({state:window.GSAILiveState.read().activity,revision:window.GSAILiveState.read().revision}))`),director.evaluate(`Promise.all(Array.from({length:40},()=>window.GSAILiveState.emit('CUSTOMER_EVENT',{eventType:'ASK_LIVE_SUBMIT',intent:'thickness'},'stress'))).then(()=>({state:window.GSAILiveState.read().activity,revision:window.GSAILiveState.read().revision}))`)]);
  console.log('After each queue',JSON.stringify(result));
  await mobile.evaluate(`new Promise(resolve=>setTimeout(resolve,1500))`);
  const read=`({ state:window.GSAILiveState.read().activity, revision:window.GSAILiveState.read().revision, stored:JSON.parse(localStorage.getItem(window.GSAILiveState.STORAGE_KEY)).activity.questionCount, ui:document.querySelector('#actual-question-count')?.textContent })`;
  const settled=await Promise.all([mobile.evaluate(read),director.evaluate(read)]);
  console.log('Settled',JSON.stringify(settled));
  assert.equal(settled[0].state.questionCount,80);assert.equal(settled[1].state.questionCount,80);assert.equal(settled[1].ui,'80건');
} finally {await browser.close();}
