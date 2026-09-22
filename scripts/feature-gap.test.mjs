import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser-harness.mjs';
const app=process.env.APP_URL || 'http://127.0.0.1:4173';
const output=new URL('../artifacts/feature-gaps/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await launchBrowser();
const checks=[];
const pass=name=>{checks.push(name);console.log('PASS',name);};
let mobile,director;
try {
  mobile=await browser.page(`${app}/mobile.html`);
  director=await browser.page(`${app}/director.html`,1440,1100);
  const m=mobile.evaluate,d=director.evaluate;
  await director.click('#demo-toggle');await director.click('#reset-btn');await director.click('#confirm-reset');
  await mobile.waitFor(`window.GSAILiveState.read().stage==='NORMAL'`);
  assert.match(await m(`document.querySelector('.live-meta').textContent`),/1,248.*데모/);
  assert.equal(await m(`document.querySelector('#video-chat').hidden`),false);
  await mobile.click('[data-action="toggle-overlay"]');assert.equal(await m(`document.querySelector('#video-chat').hidden`),true);
  await mobile.click('#expand-button');assert.equal(await m(`document.querySelector('#video-chat').hidden`),true);
  await mobile.click('#expand-button');await mobile.click('[data-action="toggle-overlay"]');
  await mobile.click('[data-action="cart"]');assert.match(await m(`document.querySelector('#sheet-content').textContent`),/비어 있어요/);await mobile.click('#close-sheet');
  await mobile.click('[data-size="77"]');await mobile.click('#purchase-button');await mobile.click('[data-action="add-cart"]');
  await mobile.click('[data-cart-size="77"][data-cart-change="1"]');
  assert.match(await m(`document.querySelector('.cart-total').textContent`),/91,030원/);
  await mobile.click('#close-sheet');await mobile.click('[data-size="66"]');await mobile.click('#purchase-button');await mobile.click('[data-action="add-cart"]');
  assert.equal(await m(`document.querySelector('#cart-count').textContent`),'3');
  assert.match(await m(`document.querySelector('.cart-total').textContent`),/136,545원/);
  await mobile.capture(new URL('cart.png',output));
  await mobile.click('#close-sheet');await mobile.click('#expand-button');await mobile.click('[data-action="cart"]');
  assert.equal(await m(`document.querySelectorAll('.cart-item').length`),2);
  await mobile.click('[data-cart-size="77"][data-cart-remove]');
  await mobile.click('[data-action="cart-checkout"]');assert.match(await m(`document.querySelector('#sheet-content').textContent`),/45,515원/);
  await mobile.click('[data-action="cart-complete"]');assert.match(await m(`document.querySelector('#sheet-content').textContent`),/실제 주문이나 결제는 발생하지 않았습니다/);
  assert.equal(await m(`document.querySelector('#cart-count').textContent`),'0');await mobile.click('#close-sheet');await mobile.click('#expand-button');
  await mobile.click('[data-action="leave"]');await mobile.click('[data-action="close"]');assert.match(await m('location.pathname'),/mobile.html/);
  pass('Live viewer demo label, shared conversation overlay toggle, exit cancellation, cart add/quantity/remove/shared-layout/checkout');

  for(const question of ['두께감 어때?','두께감 어때?','색상이 화면과 비슷해?']) {
    await mobile.click(`[data-question="${question}"]`);await mobile.waitFor(`!document.querySelector('.pending')`);
  }
  assert.deepEqual(await m(`[...document.querySelector('#messages').lastElementChild.querySelectorAll('meter')].map(el=>el.value)`),[91,6,2]);
  assert.deepEqual(await m(`[...document.querySelectorAll('.message.ai')].find(el=>el.textContent.includes('두께감 평가')).querySelector('.answer-chart') !== null`),true);
  await director.waitFor(`document.querySelector('#actual-question-count').textContent==='3건'`);
  assert.match(await d(`document.querySelector('#question-ranking li').textContent`),/두께감.*2건/);
  assert.match(await d(`document.querySelector('[data-intent="color"]').textContent`),/1건/);
  assert.equal(await d(`JSON.stringify(window.GSAILiveState.read().events).includes('question":')`),false);
  await mobile.capture(new URL('ask-review-chart.png',output));
  await director.click('[data-range="30"]');
  assert.equal(await d(`document.querySelectorAll('.chart-legend span').length`),5);
  await d(`document.querySelector('.question-panel').scrollIntoView({block:'center'})`);
  await director.capture(new URL('director-questions.png',output));
  pass('ASK review graph uses supplied percentages; real UI question counts and ranked normalized TOP5 reach Director without raw text storage');

  await mobile.click('.styling-hero');await mobile.click('.look-thumbs [data-look="2"]');
  assert.equal(await m(`document.querySelector('.look-tabs [data-look="2"]').getAttribute('aria-selected')`),'true');
  await mobile.capture(new URL('look-thumbnails.png',output));await mobile.click('[data-action="all-products"]');
  assert.equal(await m(`document.querySelectorAll('#sheet-content a[data-product-link]').length`),5);
  assert.deepEqual(await m(`[...document.querySelectorAll('#sheet-content a[data-product-link]')].map(a=>new URL(a.href).searchParams.get('prdid')).sort()`),['1084192893','1092284229','1092943486','1103680106','1121878867']);
  assert.match(await m(`document.querySelector('.unconfirmed').textContent`),/판매 상품 미확정/);
  await mobile.capture(new URL('all-products.png',output));await mobile.click('#sheet-footer [data-action="styling"]');
  assert.equal(await m(`document.querySelector('.look-tabs [data-look="2"]').getAttribute('aria-selected')`),'true');await mobile.click('#close-sheet');
  await mobile.click('.secondary-actions [data-action="size"]');
  assert.match(await m(`document.querySelector('.size-evidence').textContent`),/유사 체형 집단이 아닌 상품 전체/);
  await mobile.click('.size-evidence [data-size="88"]');await mobile.click('.size-evidence [data-action="purchase"]');
  assert.match(await m(`document.querySelector('#sheet-content').textContent`),/선택 옵션: 88/);await mobile.click('#close-sheet');
  await mobile.click('.secondary-actions [data-action="benefit"]');
  assert.match(await m(`document.querySelector('.saving-summary').textContent`),/4,385원/);
  const extra=await m(`document.querySelector('.extra-benefits').textContent`);
  for(const phrase of ['무료배송','추가 적립 · 확인 필요','할부 · 확인 필요','빠른 배송 · 확인 필요'])assert.ok(extra.includes(phrase));
  await mobile.capture(new URL('benefit-conditions.png',output));await mobile.click('#close-sheet');
  pass('Clickable look thumbnails/all 5 confirmed products, selection-return state, size evidence/options, explicit extra-benefit data limits');

  // Main Director controls, not debug shortcuts: verify the actual advertised workflow.
  await mobile.click('.option-line [data-detail="size"]');await mobile.click('[data-action="size-reviews"]');await mobile.click('#close-sheet');
  await director.waitFor(`document.querySelector('#status-pill').textContent==='관심 급증 감지'`);
  assert.match(await d(`document.querySelector('#evidence-panel').textContent`),/실제 감지 근거 2건/);
  await director.click('#insight-cta');
  await director.waitFor(`document.querySelector('#status-pill').textContent==='PD 승인 대기'`);
  // Waiting through updates must not revert the locally reviewed ACTION stage to ALERT.
  await d(`new Promise(resolve=>setTimeout(resolve,1300))`);
  assert.equal(await d(`window.GSAILiveState.read().stage`),'ACTION');
  await director.click('#host-action');await director.click('#host-message');
  await director.tab('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});
  await director.type('');
  await director.tab('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace'});
  await director.tab('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace'});
  assert.equal(await d(`document.querySelector('#approve-host').disabled`),true);
  const approvedMessage='평소 66 기준과 반사이즈 상향 선택을 다시 안내해주세요. 검수 메시지';
  await director.type(approvedMessage);await director.click('#approve-host');
  await director.waitFor(`window.GSAILiveState.read().approvals.host && !document.querySelector('#host-dialog').open`);
  assert.equal(await d(`window.GSAILiveState.read().actionDetails.hostMessage`),approvedMessage);
  assert.equal(await d(`document.querySelector('#host-action').disabled`),true);
  await director.click('#app-action');
  assert.equal(await d(`document.querySelectorAll('#segment-body tr').length`),3);
  assert.equal(await d(`document.querySelectorAll('#preview-customer option').length`),3);
  await d(`document.querySelector('#preview-customer').value='B';document.querySelector('#preview-customer').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.match(await d(`document.querySelector('#customer-preview').textContent`),/별도 실제 고객 세션이 연결된 것은 아닙니다/);
  await director.capture(new URL('director-target-review.png',output));await director.click('#approve-app');
  await mobile.waitFor(`document.querySelector('#approval-label').textContent.includes('PD 승인')`);
  assert.equal(await d(`document.querySelector('#result-action').disabled`),false);
  await director.click('#result-action');await director.waitFor(`!document.querySelector('#analytics-content').hidden`);
  assert.match(await d(`document.querySelector('#result-action-receipt').textContent`),new RegExp(approvedMessage));
  assert.ok(await d(`!!window.GSAILiveState.read().actionDetails.appApprovedAt`));
  await director.capture(new URL('director-receipts-results.png',output));
  await director.click('[data-view="history"]');
  await d(`new Promise(resolve=>setTimeout(resolve,1200))`);
  assert.equal(await d(`document.querySelector('#history-view').hidden`),false);
  assert.match(await d(`document.querySelector('#history-list').textContent`),new RegExp(approvedMessage));
  await director.tab('Page.reload');await director.waitFor(`document.readyState==='complete' && window.GSAILiveState.read().approvals.host`);
  assert.match(await d(`document.querySelector('#result-action-receipt').textContent`),new RegExp(approvedMessage));
  pass('Native Director review → edited host approval → A/B/C target preview → APP approval → receipt/time/results; persistence and history navigation');

  // Reset initiated from Mobile must also reset the actual Director body, not just a bridge card.
  await mobile.click('[data-action="guide"]');await mobile.click('#demo-reset-options summary');await mobile.click('[data-action="reset"]');
  await director.waitFor(`document.querySelector('#status-pill').textContent==='모니터링 중'`);
  assert.equal(await d(`document.querySelector('#actual-question-count').textContent`),'0건');
  assert.equal(await d(`document.querySelector('#action-options').hidden`),true);
  await mobile.click('.option-line [data-detail="size"]');await mobile.click('[data-action="size-reviews"]');await mobile.click('#close-sheet');await mobile.click('#dismiss-suggestion');
  await director.waitFor(`window.GSAILiveState.read().customer.dismissed`);
  await director.click('#insight-cta');await director.click('#app-action');
  assert.equal(await d(`document.querySelector('#approve-app').disabled`),true);
  assert.match(await d(`document.querySelector('#segment-body').textContent`),/거절 제외/);
  await director.click('#app-cancel');
  pass('Customer-side Reset clears main Director/real counts; declined A is excluded in native approval modal');

  await mobile.viewport(320,568);
  for(const action of ['cart','benefit','size','styling']) {
    await mobile.click(action==='cart'?'[data-action="cart"]':action==='styling'?'.styling-hero':`.secondary-actions [data-action="${action}"]`);
    assert.equal(await m(`document.querySelector('#sheet-content').scrollWidth<=document.querySelector('#sheet-content').clientWidth`),true);
    await mobile.capture(new URL(`small-${action}.png`,output));await mobile.click('#close-sheet');
  }
  assert.equal(await m(`document.documentElement.scrollWidth<=innerWidth`),true);
  await mobile.click('#expand-button');
  assert.equal(await m(`document.documentElement.scrollWidth<=innerWidth`),true);
  await mobile.capture(new URL('small-expanded.png',output));
  await mobile.click('[data-action="leave"]');await mobile.click('[data-action="confirm-leave"]');await mobile.waitFor(`location.pathname==='/'`);
  await director.waitFor(`window.GSAILiveState.read().events.some(event=>event.type==='LIVE_EXIT')`);
  assert.deepEqual(browser.errors,[]);
  pass('New customer controls/sheets fit 320px and explicit expanded layout; no uncaught errors');
  await writeFile(new URL('report.json',output),JSON.stringify({checkedAt:new Date().toISOString(),checks,limits:['Screenshot numerical examples are not substituted for confirmed fixtures','Physical mobile keyboard, external product availability and real service APIs not tested']},null,2));
} catch(error) {
  await mobile?.capture(new URL('failure-mobile.png',output));await director?.capture(new URL('failure-director.png',output));throw error;
} finally { await browser.close(); }
