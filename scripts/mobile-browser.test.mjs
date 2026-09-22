import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { launchBrowser } from './browser-harness.mjs';
const app = process.env.APP_URL || 'http://127.0.0.1:4173';
assert.equal((await fetch(`${app}/health`)).status, 200);
const artifacts = new URL('../artifacts/mobile/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await launchBrowser();
const checks = [];
let mobile;
const passed = name => { checks.push(name); console.log('PASS', name); };
try {
  mobile = await browser.page(`${app}/mobile.html`);
  const { evaluate: ev, click, waitFor, viewport, capture } = mobile;
  await waitFor(`document.querySelector('#gs-reference-video').readyState >= 2`);
  await ev(`new Promise(resolve => { const v=document.querySelector('video'); if(v.requestVideoFrameCallback) {v.requestVideoFrameCallback(resolve); setTimeout(resolve,1000);} else setTimeout(resolve,300); })`);
  await ev(`window.__video = document.querySelector('video'); window.__input = document.querySelector('#ask-input')`);
  async function layout(label) {
    const result = await ev(`(() => {
      const q=document.querySelector('#ask-form').getBoundingClientRect(), p=document.querySelector('.purchase-bar').getBoundingClientRect();
      const input=document.querySelector('#ask-input'), button=document.querySelector('#purchase-button');
      const reachable=[input,button].every(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});
      const overflow=[...document.querySelectorAll('.device-scroll,.primary,.conversation,.composer,.purchase-bar')].filter(el=>el.clientWidth && el.scrollWidth>el.clientWidth+1).map(el=>el.className);
      return { noDocumentOverflow:document.documentElement.scrollWidth<=innerWidth, noOverlap:q.bottom<=p.top, withinViewport:p.bottom<=innerHeight+1 && q.top>=0, reachable, overflow };
    })()`);
    assert.deepEqual(result, { noDocumentOverflow: true, noOverlap: true, withinViewport: true, reachable: true, overflow: [] }, label);
  }
  await layout('390 portrait'); await capture(new URL('portrait-390.png', artifacts));
  await click('[data-size="77"]');
  await click('#ask-input'); await mobile.type('전환 중 작성한 질문');
  await click('[data-question="상품후기 알려줘"]');
  await waitFor(`document.querySelector('.pending')`);
  const pending = await ev(`document.querySelector('.pending').textContent`);
  assert.equal(pending, '구매후기를 확인하고 있어요');
  await click('#expand-button');
  assert.equal(await ev(`!!document.querySelector('.pending')`), true);
  assert.equal(await ev(`document.body.classList.contains('landscape')`), true);
  assert.equal(await ev(`document.querySelector('#ask-input').value`), '전환 중 작성한 질문');
  await waitFor(`!document.querySelector('.pending')`);
  assert.match(await ev(`document.querySelector('#messages').textContent`), /평점 4.5, 리뷰 1,199건/);
  assert.equal(await ev(`window.__input===document.querySelector('#ask-input') && window.__video===document.querySelector('video')`), true);
  assert.equal(await ev(`document.querySelector('[data-size="77"]').getAttribute('aria-pressed')`), 'true');
  await layout('390 manual landscape'); await capture(new URL('manual-landscape-390.png', artifacts));
  await viewport(844, 390); await layout('844 landscape');
  await capture(new URL('landscape-844.png', artifacts));
  const split = await ev(`document.querySelector('.primary').getBoundingClientRect().right <= document.querySelector('.conversation').getBoundingClientRect().left`);
  assert.equal(split, true);
  await click('#expand-button'); await viewport(320, 568); await layout('320 portrait');
  await capture(new URL('portrait-320.png', artifacts));
  // Simulate reduced visible space; hardware IME behavior remains a real-device check.
  await click('#ask-input'); await viewport(320, 360); await layout('320 keyboard-sized viewport');
  await capture(new URL('keyboard-viewport-320.png', artifacts));
  await viewport(390, 844);
  passed('Portrait/manual landscape share messages, selected 77, draft, pending AI and video node; 320px input/purchase accessible');

  for (const [question, expected] of [['두께감 어때?', '63%'], ['색상이 화면과 비슷해?', '99%'], ['오늘 주문하면 언제 와?', '배송 예시']]) {
    await click(`[data-question="${question}"]`);
    await waitFor(`!document.querySelector('.pending')`);
    assert.match(await ev(`document.querySelector('#messages').lastElementChild.textContent`), new RegExp(expected));
  }
  await click('#ask-input');
  await mobile.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
  await mobile.type('모델은 몇 사이즈 입었어?'); await click('#send-button');
  await waitFor(`!document.querySelector('.pending')`);
  assert.match(await ev(`document.querySelector('#messages').lastElementChild.textContent`), /확인할 수 없어요/);
  await click('#ask-input'); await mobile.type('구두 사이즈 추천해줘'); await click('#send-button');
  await waitFor(`!document.querySelector('.pending')`);
  assert.match(await ev(`document.querySelector('#messages').lastElementChild.textContent`), /신발 사이즈는 확인할 수 없어요/);
  assert.doesNotMatch(await ev(`document.querySelector('#messages').lastElementChild.textContent`), /66/);
  await click('#ask-input'); await mobile.type('수선비와 매장 재고 알려줘'); await click('#send-button');
  await waitFor(`!document.querySelector('.pending')`);
  assert.match(await ev(`document.querySelector('#messages').lastElementChild.textContent`), /정확하게 답하기 어려워요/);
  await capture(new URL('ask-timeline.png', artifacts));
  passed('Four grounded ASK intents, delivery simulation, unsupported/model-size limits and actor labels');

  await click('.styling-hero');
  const expectedIds = [['1084192893','1092284229','1092943486'], ['1084192893','1103680106','1121878867'], ['1084192893']];
  for (let i = 0; i < 3; i++) {
    await click(`[data-look="${i}"]`);
    assert.equal(await ev(`document.querySelector('.look-visual img').complete && document.querySelector('.look-visual img').naturalWidth>0`), true);
    assert.match(await ev(`document.querySelector('#sheet-content').textContent`), /AI 코디 예시/);
    const ids = await ev(`[...document.querySelectorAll('#sheet-content a[data-product-link]')].map(a=>new URL(a.href).searchParams.get('prdid'))`);
    assert.deepEqual(ids, expectedIds[i]);
    assert.equal(await ev(`document.querySelector('#sheet-content').scrollWidth<=document.querySelector('#sheet-content').clientWidth`), true);
    await capture(new URL(`look-${i + 1}.png`, artifacts));
  }
  assert.match(await ev(`document.querySelector('#sheet-content').textContent`), /판매 상품 미확정/);
  // Validate actual link activation without contacting a live commerce system.
  await ev(`window.__openedLink=null; document.addEventListener('click', e=>{const a=e.target.closest('a[data-product-link]');if(a){window.__openedLink={url:a.href,target:a.target,rel:a.rel};e.preventDefault();}}, {capture:true})`);
  await click('#sheet-content a[data-product-link]');
  const link = await ev('window.__openedLink');
  assert.equal(link.url, 'https://m.gsshop.com/prd/prd.gs?prdid=1084192893'); assert.equal(link.target, '_blank'); assert.match(link.rel, /noopener/);
  for (const index of [0, 1]) {
    await click(`[data-look="${index}"]`);
    for (const id of expectedIds[index].slice(1)) {
      await click(`#sheet-content a[href$="${id}"]`);
      assert.equal((await ev('window.__openedLink')).url, `https://m.gsshop.com/prd/prd.gs?prdid=${id}`);
    }
  }
  await click('[data-look="0"]');
  await ev(`document.querySelector('.look-visual img').src='/assets/mobile/missing-look.jpg'`);
  await waitFor(`document.querySelector('.look-visual').hidden`);
  assert.equal(await ev(`document.querySelectorAll('.item-card').length`), 3);
  await click('#close-sheet');
  passed('All 3 static looks, preserved confirmed GS SHOP links, no fabricated daily product links, image-error product fallback');

  await click('.secondary-actions [data-action="size"]');
  assert.match(await ev(`document.querySelector('#sheet-content').textContent`), /66 사이즈를 먼저 확인해보세요/);
  assert.match(await ev(`document.querySelector('#sheet-content').textContent`), /87%/);
  await click('[data-action="size-purchase"]');
  assert.match(await ev(`document.querySelector('#sheet-content').textContent`), /선택 옵션: 66/);
  await click('[data-action="purchase-complete"]');
  assert.match(await ev(`document.querySelector('#sheet-content').textContent`), /실제 주문이나 결제는 발생하지 않았습니다/);
  await click('#close-sheet');
  await click('.secondary-actions [data-action="benefit"]');
  const discounts = await ev(`[...document.querySelectorAll('.ledger dd')].map(x=>x.textContent)`);
  assert.deepEqual(discounts, ['49,900원','−2,495원','−1,890원','−4,385원','45,515원']);
  await capture(new URL('benefits.png', artifacts)); await click('#close-sheet');
  passed('Size66/87% and half-size guidance, detail-to-purchase, exact benefit math, no actual order');

  const director = await browser.page(`${app}/director.html`, 1440, 1000);
  await director.click('.shared-diagnostics summary');
  for (let run = 1; run <= 3; run++) {
    const previousRun = await ev(`window.GSAILiveState.read().runId`);
    await director.click('[data-gs-action="reset"]');
    await waitFor(`window.GSAILiveState.read().runId>${previousRun} && !window.GSAILiveState.read().need.detected`);
    await click('.option-line [data-detail="size"]');
    assert.equal(await ev(`window.GSAILiveState.read().need.detected`), false);
    await click('[data-action="size-reviews"]');
    await waitFor(`window.GSAILiveState.read().need.detected`);
    assert.equal(await ev(`document.querySelector('#sheet-title').textContent`), '상품상세'); // No forced result redirect.
    await click('#close-sheet');
    await director.waitFor(`document.querySelector('#gs-d-signal').textContent==='26건'`);
    await director.click('[data-gs-action="host"]'); await director.click('[data-gs-action="app"]');
    await waitFor(`document.querySelector('#approval-label').textContent.includes('PD 승인')`);
    assert.equal(await director.evaluate(`document.querySelector('#gs-d-target').textContent`), '33명');
    assert.deepEqual(await ev(`window.GSAILiveState.read().target.included`), ['A']);
    assert.deepEqual(await ev(`window.GSAILiveState.read().target.excluded`), ['B','C']);
    await click('#accept-suggestion');
    assert.equal(await ev(`document.querySelector('#sheet-title').textContent`), '지수님의 내 사이즈');
    await click('#close-sheet');
    await director.click('[data-gs-action="result"]');
    await director.waitFor(`document.querySelector('#gs-d-highlight').textContent==='강조 중'`);
    if (run < 3) await director.click('[data-gs-action="expire"]');
    await director.waitFor(`document.querySelector('#gs-d-highlight').textContent==='만료'`, run === 3 ? 35000 : 10000);
    assert.equal(await ev(`document.querySelector('#suggestion').hidden`), true);
    passed(`Reset repeat ${run}/3: real size-table/review clicks → Director 8→26 → approve33/A-only → accept/result/expiry`);
  }
  const previousRun = await ev(`window.GSAILiveState.read().runId`);
  await director.click('[data-gs-action="reset"]');
  await waitFor(`window.GSAILiveState.read().runId>${previousRun} && !window.GSAILiveState.read().need.detected`);
  await click('.option-line [data-detail="size"]'); await click('[data-action="size-reviews"]'); await click('#close-sheet');
  await click('#dismiss-suggestion');
  await waitFor(`document.querySelector('#suggestion').hidden && window.GSAILiveState.read().customer.dismissed`);
  await mobile.tab('Page.reload');
  await waitFor(`document.readyState==='complete' && window.GSAILiveState?.read().customer.dismissed`);
  await click('.option-line [data-detail="size"]'); await click('[data-action="size-reviews"]'); await click('#close-sheet');
  assert.equal(await ev(`document.querySelector('#suggestion').hidden`), true);
  await click('.secondary-actions [data-action="size"]');
  assert.equal(await ev(`document.querySelector('#sheet-title').textContent`), '지수님의 내 사이즈');
  await click('#close-sheet');
  await capture(new URL('dismissed-manual-size.png', artifacts));
  passed('Dismissal survives reload and repeated behavior in same broadcast; explicit My Size still allowed');
  await viewport(320, 568);
  for (const [action, filename] of [['styling','small-look'], ['size','small-size'], ['benefit','small-benefit'], ['purchase','small-purchase']]) {
    await click(action === 'styling' ? '.styling-hero' : action === 'purchase' ? '#purchase-button' : `.secondary-actions [data-action="${action}"]`);
    assert.equal(await ev(`document.querySelector('#sheet-content').scrollWidth<=document.querySelector('#sheet-content').clientWidth && document.querySelector('#sheet').getBoundingClientRect().bottom<=innerHeight+1`), true);
    await capture(new URL(`${filename}-320.png`, artifacts)); await click('#close-sheet');
  }
  await click('#expand-button'); await layout('320 manual landscape');
  await capture(new URL('manual-landscape-320.png', artifacts));
  passed('320px sheets and explicit split layout fit without horizontal overflow; third run verified real 30-second expiry');
  assert.deepEqual(browser.errors, []);
  passed('No uncaught browser exceptions');
  await writeFile(new URL('report.json', artifacts), JSON.stringify({ checkedAt: new Date().toISOString(), app, checks, limits: ['External commerce destinations checked against provided product IDs and pointer activation, not current remote stock or availability', 'Chrome emulation; iOS/Android physical keyboard and Safari not device-tested'] }, null, 2));
} catch (error) {
  if (mobile) await mobile.capture(new URL('failure.png', artifacts));
  throw error;
} finally { await browser.close(); }
