// Acceptance of the mobile customer goal, through the real HTTP app and Chrome.
// Use a dedicated server: this script resets the supplied run.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {launch, delay} = require('./browser_driver.cjs');
const root = path.resolve(__dirname, '..');
const base = process.env.GS_MOBILE_URL || 'http://127.0.0.1:8795';
const output = path.join(root, 'docs/evidence');
const report = {status:'RUNNING', started_at:new Date().toISOString(), base,
  scope:'Customer mobile goal: real Chrome layout/hit-testing, shared state, static styling and prepared product evidence; no production commerce certification.',
  checks:[], screenshots:[], source_hashes:{}};
let browser;
function check(name, value, evidence) {
  if (!value) throw new Error(name + (evidence ? ' ' + JSON.stringify(evidence) : ''));
  report.checks.push({name, status:'PASS', ...(evidence ? {evidence} : {})});
  console.log('PASS', name);
}
async function state(customer='customer-A') {
  return (await fetch(base + '/api/state?customer_id=' + customer)).json();
}
async function action(name, extra={}, customer='customer-A') {
  const current = await state(customer);
  const response = await fetch(base + '/api/action', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:name, run_id:current.run_id, customer_id:customer, ...extra})});
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function ready(page) {
  await page.wait('!!window.gsApp?.getState().state && !!document.querySelector("#gallery-image")?.naturalWidth', 'customer ready');
}
async function capture(page, name) {
  await page.screenshot(path.join(output, name + '.png'));
  report.screenshots.push(name + '.png');
}
async function closeSheet(page) {
  if (await page.evaluate('document.querySelector("#dialog").open')) {
    const acknowledged = await page.evaluate(`(() => {
      if (!window.__mobileGoalCloseObserver) {
        window.__mobileGoalCloseObserver=true;window.__mobileGoalCloseAcks=0;
        const original=window.fetch;
        window.fetch=async (...args)=>{const response=await original(...args);let payload;try{payload=JSON.parse(args[1]?.body||'null');}catch{}if(response.ok&&payload?.action==='ui_state'&&payload.patch?.active_result===null)window.__mobileGoalCloseAcks++;return response;};
      }
      return window.__mobileGoalCloseAcks;
    })()`);
    await page.click('#dialog-close');
    await page.wait('!document.querySelector("#dialog").open', 'sheet closed');
    await page.wait(`window.__mobileGoalCloseAcks>${acknowledged}`, 'actual close response acknowledged before navigation');
    await page.wait('gsApp.getState().state.customer.ui.active_result===null', 'closed view persisted before next navigation');
  }
}
async function mode(page, value) {
  const current = await page.evaluate('gsApp.getState().ui.orientation');
  if (current !== value) await page.click('#orientation-toggle');
  await page.wait(`gsApp.getState().ui.orientation===${JSON.stringify(value)}&&document.body.classList.contains('landscape')===${value==='landscape'}`, 'orientation ' + value);
  await delay(120);
}
async function geometry(page) {
  return page.evaluate(`(() => {
    const rect = s => {const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const hit = s => {const e=document.querySelector(s),r=e.getBoundingClientRect();const inside=r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;const samples=[[.15,.5],[.5,.5],[.85,.5]];return {inside,uncovered:samples.every(([x,y])=>{const top=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return top===e||e.contains(top);}),rect:rect(s)};};
    const overflowingPanels=['.primary','.conversation','.composer','.product-panel','.quick-actions','.purchase-bar','.question-chips'].filter(s=>{const e=document.querySelector(s);return e.scrollWidth>e.clientWidth+1;});
    return {viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth+1,overflowingPanels,video:rect('#media-stage'),primary:rect('.primary'),conversation:rect('.conversation'),composer:rect('.composer'),purchase:rect('.purchase-bar'),input:hit('#ask-input'),send:hit('#ask-submit'),buy:hit('#purchase-button'),inputFont:parseFloat(getComputedStyle(document.querySelector('#ask-input')).fontSize)};
  })()`);
}
async function layout(page, name, landscape) {
  const g = await geometry(page);
  check(name + ' no page/panel overflow; input/send/purchase visible and unobstructed', !g.overflow && !g.overflowingPanels.length && [g.input,g.send,g.buy].every(v=>v.inside&&v.uncovered), g);
  check(name + ' 16:9 LIVE frame; readable input and touch controls', Math.abs(g.video.width/g.video.height - 16/9)<0.025 && g.inputFont>=16 && g.input.rect.height>=40 && g.send.rect.height>=40 && g.buy.rect.height>=40, g);
  if (landscape) {
    check(name + ' video/product left, conversation and composer right', g.primary.right<=g.conversation.x+2 && g.composer.x>=g.conversation.x-2 && g.primary.width>0 && g.conversation.width>0, g);
  } else {
    check(name + ' composer reserved above purchase', g.composer.bottom<=g.purchase.y+1 && g.input.rect.bottom<=g.purchase.y+1, g);
  }
  await capture(page, name);
}
async function ask(page, text) {
  await page.fill('#ask-input', text);
  await page.click('#ask-submit');
  await page.wait(`gsApp.getState().state.customer.messages.some(m=>m.actor==='CUSTOMER'&&m.text===${JSON.stringify(text)})`, 'question sent');
}
async function sizeSignals(page) {
  await page.click('.product-panel [data-detail="size"]');
  await page.wait('!!document.querySelector("#size-reviews")', 'size chart open');
  await page.click('#size-reviews');
  await page.wait('!!document.querySelector("#review-size")', 'size review open');
  await closeSheet(page);
  await page.wait('!document.querySelector("#suggestion").hidden', 'proactive suggestion');
}

(async()=>{
  fs.mkdirSync(output, {recursive:true});
  for (const file of ['app/customer.html','app/customer.css','app/customer.js','fixtures/styling-looks.json','fixtures/styling-candidates.json','fixtures/main-product.json','fixtures/demo-config.json','fixtures/ask-live.json','assets/lookbooks/look-01.png','assets/lookbooks/look-02.png','assets/lookbooks/look-03.png']) {
    report.source_hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  }
  await action('reset');
  browser = await launch();
  const a = await browser.page(base + '/app/customer.html?customer=customer-A', 390, 844, true);
  await ready(a);
  const bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  report.run_id = (await state()).run_id;

  const colors = await a.evaluate(`(() => {
    const s=x=>getComputedStyle(document.querySelector(x));
    const area=x=>{const r=document.querySelector(x).getBoundingClientRect();return r.width*r.height;};
    const e=document.querySelector('#styling-button'),r=e.getBoundingClientRect();
    const initiallyVisible=r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&[[.15,.5],[.5,.5],[.85,.5]].every(([x,y])=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)));
    return {device:s('.device').backgroundColor,ink:s('.product-name').color,styleBg:s('#styling-button').backgroundColor,styleColor:s('#styling-button').color,benefit:s('.benefit-link strong').color,price:s('.price-line strong').color,input:s('#ask-input').fontSize,message:s('.message>p').fontSize,styleArea:area('#styling-button'),sizeArea:area('#size-button'),benefitArea:area('#benefit-button'),title:e.innerText,initiallyVisible,styleRect:{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
  })()`);
  check('DESIGN01 white/charcoal body, purple AI and coral benefit price roles', colors.device==='rgb(255, 255, 255)' && colors.ink==='rgb(40, 41, 51)' && [colors.styleBg,colors.styleColor].includes('rgb(118, 68, 207)') && colors.benefit==='rgb(206, 82, 108)' && colors.price!==colors.styleColor, colors);
  check('DESIGN02 styling is primary and exposed on entry; main conversation text readable', colors.styleArea>=1.2*Math.max(colors.sizeArea,colors.benefitArea) && /코디/.test(colors.title) && parseFloat(colors.message)>=14 && colors.initiallyVisible, colors);
  check('ENTRY01 correct default product/options and four quick questions', await a.evaluate(`gsApp.getState().ui.orientation==='portrait'&&gsApp.getState().ui.size==='66'&&document.querySelector('.product-panel').innerText.includes('49,900')&&document.querySelector('.benefit-link').innerText.includes('45,515')&&[...document.querySelectorAll('.size-options [data-size]')].map(e=>e.dataset.size).join(',')==='55,66,77,88'&&[...document.querySelectorAll('.question-chips button')].map(e=>e.innerText).join(',')==='상품후기,두께감,색상,배송일정'&&document.querySelector('#ask-input').placeholder==='궁금한 것을 물어보세요'`));
  await layout(a, 'mobile-goal-portrait-390', false);
  await a.viewport(320,568,true); await delay(120);
  await layout(a, 'mobile-goal-portrait-320', false);

  // The toggle must create two columns without a browser/OS viewport change.
  await mode(a, 'landscape');
  await layout(a, 'mobile-goal-expanded-320', true);
  check('ORIENT01 narrow-screen toggle has explicit return control', await a.evaluate(`innerWidth===320&&document.querySelector('#expand-label').textContent==='세로로 보기'&&document.querySelector('#orientation-toggle').getAttribute('aria-pressed')==='true'`));
  await a.viewport(844,390,true); await delay(120);
  await layout(a, 'mobile-goal-landscape-844', true);
  for (const [button,title] of [['#size-button','내 사이즈'],['#styling-button','코디 추천'],['#benefit-button','내 혜택'],['#purchase-button','구매 정보 확인']]) {
    await a.click(button); await a.wait('document.querySelector("#dialog").open', 'landscape result accessible');
    check('ORIENT02 landscape action accessible: ' + title, await a.evaluate(`document.querySelector('#sheet-title').textContent===${JSON.stringify(title)}&&document.querySelector('#dialog').getBoundingClientRect().right<=innerWidth+1`));
    await closeSheet(a);
  }
  await a.viewport(390,844,true); await mode(a,'portrait');

  await ask(a,'색상이 화면과 비슷해?');
  await a.wait('document.querySelector("#messages").innerText.includes("91%")','existing inline answer');
  await a.wait(`(() => {const p=[...document.querySelectorAll('#messages .message.ai>p:first-of-type')].at(-1);if(!p)return false;const r=p.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.y>=0&&r.bottom<=innerHeight&&!!top&&(p===top||p.contains(top));})()`,'submitted ASK answer visible in scrollable timeline');
  check('ASK00 submitted answer is actually visible above the reserved controls',true);
  await capture(a,'mobile-goal-portrait-ask-answer');
  await a.click('.size-options [data-size="77"]');
  await a.fill('#ask-fault','delay');
  await ask(a,'상품후기 알려줘');
  await a.wait('!!document.querySelector(".processing")','pending ASK');
  const pending = await a.evaluate(`(() => {const s=gsApp.getState(),p=document.querySelector('.processing'),r=p.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {ids:s.state.customer.messages.map(m=>m.message_id),request:s.state.customer.messages.find(m=>m.status==='pending').request_id,text:p.innerText,visible:r.y>=0&&r.bottom<=innerHeight&&!!top&&(p===top||p.contains(top))};})()`);
  check('ASK01 pending state exposes visible progress only', /확인하고|준비/.test(pending.text) && !/87%|68%|63%|91%|4,385|1,202/.test(pending.text) && pending.visible, pending);
  await a.fill('#ask-input','입력 중인 다음 질문');
  await mode(a,'landscape');
  const toggled = await a.evaluate(`(() => {const s=gsApp.getState();return {ids:s.state.customer.messages.map(m=>m.message_id),request:s.state.customer.messages.find(m=>m.status==='pending')?.request_id,draft:document.querySelector('#ask-input').value,size:s.ui.size};})()`);
  check('ORIENT03 shared conversation/draft/size/pending request preserved', JSON.stringify(pending.ids)===JSON.stringify(toggled.ids) && pending.request===toggled.request && toggled.draft==='입력 중인 다음 질문' && toggled.size==='77', {before:pending,after:toggled});
  await mode(a,'portrait');
  await a.wait('!document.querySelector(".processing")','answer completes after orientation',7000);
  const completed = await a.evaluate(`(() => {const s=gsApp.getState();return {answers:s.state.customer.messages.filter(m=>m.request_id===${JSON.stringify(pending.request)}&&m.actor==='ASK_LIVE'),draft:document.querySelector('#ask-input').value,actors:[...document.querySelectorAll('.message-label')].map(e=>e.innerText),dialog:document.querySelector('#dialog').open};})()`);
  check('ASK02 single inline answer completes and preserves next draft', completed.answers.length===1 && completed.answers[0].text.includes('68%') && completed.draft==='입력 중인 다음 질문' && !completed.dialog, completed);
  check('ASK03 operator/customer/AI roles are distinct in same timeline', await a.evaluate(`!!document.querySelector('#messages .message.op')&&!!document.querySelector('#messages .message.customer')&&!!document.querySelector('#messages .message.ai')&&document.querySelector('#messages').innerText.includes('OPERATOR')&&document.querySelector('#messages').innerText.includes('ASK LIVE')&&document.querySelector('#messages').innerText.includes('CUSTOMER')`));
  await a.fill('#ask-fault',''); await a.fill('#ask-input','');
  for (const [question,expected] of [['두께감 어때?','63%'],['오늘 주문하면 언제 와?','배송 시뮬레이션'],['모델은 몇 사이즈 입었어?','착용 사이즈']]) {
    await ask(a,question); await a.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(expected)})`,'grounded answer');
    check('ASK04 grounded answer or clear limit: ' + question,true);
  }

  await a.click('#styling-button');
  for (const [id,tab,terms,ids] of [
    ['LOOK_01','오피스',['그레이','아이보리','슬랙스','로퍼'],['1103554292','1092943486']],
    ['LOOK_02','데이트',['그레이','브라운','스커트','메리제인'],['1103680106','1110407317']],
    ['LOOK_03','데일리',['그레이','데님','스니커즈'],['1052764372','1085417942']]
  ]) {
    await a.click('.look-tabs [data-look="'+id+'"]');
    await a.wait('document.querySelector(".look-image img").complete&&document.querySelector(".look-image img").naturalWidth>0&&[...document.querySelectorAll(".look-items img,.look-products img")].every(i=>i.complete&&i.naturalWidth>0)','static look and actual product images');
    const look=bootstrap.looks.looks.find(l=>l.look_id===id);
    const displayed=await a.evaluate(`({src:document.querySelector('.look-image img').getAttribute('src'),label:document.querySelector('.look-image .badge').innerText,reason:document.querySelector('.look-description').innerText,tab:document.querySelector('.look-tabs .active').innerText,text:document.querySelector('#sheet-content').innerText,links:[...document.querySelectorAll('.look-items [data-product-link]')].map(a=>({id:a.dataset.productLink,url:a.href,target:a.target,rel:a.rel})),actualImages:document.querySelectorAll('.look-items img').length,rail:[...document.querySelectorAll('.look-products [data-styling-product]')].map(a=>({id:a.dataset.stylingProduct,category:a.dataset.category,label:a.querySelector('span')?.textContent.trim(),src:a.querySelector('img')?.getAttribute('src'),url:a.href,target:a.target,rel:a.rel,look:a.dataset.look,tracking:a.dataset.productLink})),railHasLookSelector:!!document.querySelector('.look-products [data-look]')})`);
    check('STYLE01 '+tab+' static labeled image, preference, reason and actual cards', displayed.src==='/'+look.static_lookbook_image && displayed.label==='AI 코디 예시' && displayed.tab===tab && terms.every(t=>displayed.reason.includes(t)) && displayed.actualImages===3 && /실제 상품/.test(displayed.text), displayed);
    check('STYLE02 '+tab+' only confirmed product links; no shoe size inference', displayed.links.length===2 && ids.every(id=>displayed.links.some(link=>link.id===id&&link.url===bootstrap.candidates.products.find(p=>p.product_id===id&&p.runtime_eligible&&p.verification_status==='PUBLIC_PAGE_AND_IMAGE_VERIFIED').product_url&&link.target==='_blank'&&link.rel.includes('noopener'))) && /신발.*사이즈|사이즈.*신발/.test(displayed.text) && look.selected_size===null, {links:displayed.links,size_policy:look.size_policy});
    const topImage=bootstrap.product.images.find(image=>image.color==='GRAY'&&image.kind==='product_only');
    const expectedRail=[{id:look.top_product_id,category:'TOP',label:'상의',src:'/'+topImage.local_path,url:bootstrap.product.links.product},...ids.map(productId=>{const product=bootstrap.candidates.products.find(p=>p.product_id===productId);return {id:productId,category:product.category,label:product.category==='BOTTOM'?'하의':'신발',src:'/'+product.image,url:product.product_url};})];
    check('STYLE04 '+tab+' sidebar shows the exact actual top, bottom and shoes for this preference',displayed.rail.length===3&&!displayed.railHasLookSelector&&displayed.rail.every((item,index)=>{const expected=expectedRail[index];return ['id','category','label','src','url'].every(key=>item[key]===expected[key])&&item.target==='_blank'&&item.rel.includes('noopener')&&item.rel.includes('noreferrer')&&(index===0?!item.tracking:item.tracking===item.id)&&!item.src.includes('/lookbooks/');}),{expected:expectedRail,actual:displayed.rail});
    await capture(a,'mobile-goal-styling-'+id.toLowerCase());
    const clickSku=ids[0],beforeClicks=(await state()).integration.linked_products.find(row=>row.product_id===clickSku)?.count||0;
    await a.evaluate('document.querySelectorAll(".look-products a").forEach(link=>link.addEventListener("click",event=>event.preventDefault()))');
    await a.click('.look-products [data-styling-product="'+clickSku+'"]');
    let afterClicks=beforeClicks;
    for(let attempt=0;attempt<50&&afterClicks===beforeClicks;attempt++){await delay(100);afterClicks=(await state()).integration.linked_products.find(row=>row.product_id===clickSku)?.count||0;}
    await delay(250);
    const currentClicks=(await state()).integration.linked_products.find(row=>row.product_id===clickSku)?.count||0;
    check('STYLE05 '+tab+' product thumbnail counts once and retains the large AI example',currentClicks===beforeClicks+1&&await a.evaluate(`gsApp.getState().ui.look===${JSON.stringify(id)}&&document.querySelector('.look-tabs .active').dataset.look===${JSON.stringify(id)}&&document.querySelector('.look-image img').getAttribute('src')===${JSON.stringify('/'+look.static_lookbook_image)}`),{product_id:clickSku,before:beforeClicks,after:currentClicks});
  }
  await closeSheet(a);
  await mode(a,'landscape'); await a.click('#styling-button');
  check('STYLE03 selected preference survives reopening and orientation', await a.evaluate(`document.querySelector('.look-tabs .active').dataset.look==='LOOK_03'&&gsApp.getState().ui.look==='LOOK_03'`));
  await closeSheet(a); await mode(a,'portrait');

  await a.click('#size-button');
  const size = await a.evaluate(`({recommended:document.querySelector('#recommended-size').textContent,text:document.querySelector('#sheet-content').innerText,usual:document.querySelector('#size-profile-usual').value})`);
  check('SIZE01 default virtual profile66,87%review and half-size guidance', size.recommended==='66'&&size.usual==='66'&&size.text.includes('66 사이즈를 먼저 확인해보세요.')&&size.text.includes('87%')&&/반사이즈/.test(size.text)&&/한 사이즈|크게/.test(size.text),size);
  await a.click('#sheet-footer [data-detail="size"]');
  const rows=await a.evaluate('[...document.querySelectorAll(".size-table tbody tr")].map(r=>[...r.querySelectorAll("td")].map(c=>Number(c.innerText)))');
  check('SIZE02 displayed measurements match provided snapshot exactly', JSON.stringify(rows)===JSON.stringify(bootstrap.product.size_guide.rows.map(r=>r.values)),{rows});
  await closeSheet(a);
  await a.click('#benefit-button');
  const benefit=await a.evaluate('document.querySelector("#sheet-content").innerText');
  check('BENEFIT01 exact prepared VIP/GS Pay arithmetic and explicit demo label', ['49,900','2,495','1,890','4,385','45,515'].every(v=>benefit.includes(v))&&/가상 VIP/.test(benefit)&&/예시/.test(benefit),{base:49900,vip:2495,gs_pay:1890,total:4385,final:45515});
  await a.click('#sheet-footer [data-purchase]');
  check('PURCHASE01 benefit connects selected77 to labeled purchase simulation',await a.evaluate(`document.querySelector('#sheet-content').innerText.includes('그레이 / 77')&&document.querySelector('#sheet-content').innerText.includes('실제 주문·결제·배송은 발생하지 않습니다.')`));
  await a.click('#demo-order'); await a.wait('document.querySelector("#sheet-title").textContent==="구매 체험 완료"','demo complete');
  check('PURCHASE02 demo completion confirms no actual order',await a.evaluate(`document.querySelector('#sheet-content').innerText.includes('실제 주문·결제·배송은 발생하지 않았습니다.')`));
  await closeSheet(a);

  // Reset establishes that two real UI actions, not a fixture, trigger the suggestion.
  const clean=await action('reset'); await a.wait(`document.body.dataset.runId===${JSON.stringify(clean.run_id)}`,'fresh run');
  await sizeSignals(a);
  check('NEED01 real size chart+review creates small proposal without forced result', await a.evaluate(`gsApp.getState().state.customer.detected&&!document.querySelector('#dialog').open&&document.querySelector('#suggestion').innerText.includes('사이즈가 고민되시나요?')`));
  await a.click('#suggestion-accept'); await a.wait('document.querySelector("#sheet-title").textContent==="내 사이즈"','suggestion accepted');
  check('NEED02 acceptance opens size result',await a.evaluate('document.querySelector("#dialog").open'));await closeSheet(a);
  const fresh=await action('reset');await a.wait(`document.body.dataset.runId===${JSON.stringify(fresh.run_id)}`,'dismissal fresh run');
  await sizeSignals(a);await a.click('#suggestion-dismiss');
  await a.wait('gsApp.getState().state.customer.dismissed','dismissed stored');
  await a.click('.product-panel [data-detail="size"]');await a.click('#size-reviews');await closeSheet(a);
  await a.navigate(base+'/app/customer.html?customer=customer-A');await ready(a);
  check('NEED03 rejection suppresses same-live proposal after actions and reload',await a.evaluate(`gsApp.getState().state.customer.dismissed&&document.querySelector('#suggestion').hidden&&!document.querySelector('#dialog').open`));
  await a.click('#size-button');await a.wait('document.querySelector("#dialog").open','manual size after rejection');
  check('NEED04 manual size stays available after rejection',await a.evaluate(`document.querySelector('#sheet-title').textContent==='내 사이즈'`));await closeSheet(a);
  const repeated=await action('reset');await a.wait(`document.body.dataset.runId===${JSON.stringify(repeated.run_id)}`,'repeat-action fresh run');
  await a.click('.product-panel [data-detail="size"]');await a.wait('!!document.querySelector("#size-reviews")','first chart visit');await closeSheet(a);
  check('NEED05 one size action does not create proposal',await a.evaluate(`!gsApp.getState().state.customer.detected&&document.querySelector('#suggestion').hidden`));
  await a.click('.product-panel [data-detail="size"]');await a.wait('!!document.querySelector("#size-reviews")','second independent chart visit');await closeSheet(a);
  await a.wait('!document.querySelector("#suggestion").hidden','two independent same-kind size actions');
  check('NEED06 two new size-chart actions also count under the current goal',await a.evaluate(`gsApp.getState().state.customer.detected&&!document.querySelector('#dialog').open`));
  await a.click('#info-button');await a.wait('document.querySelector("#dialog").open','demo guide');
  const guide=await a.evaluate('document.querySelector("#sheet-content").innerText');
  check('SCOPE01 UI discloses simulation and actual local Director connection',/데모|시뮬레이션/.test(guide)&&/주문|결제/.test(guide)&&/로컬|연결|연동/.test(guide),{guide});
  check('RUNTIME01 no uncaught browser errors',a.errors.length===0,a.errors);
  report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'mobile-customer-goal-verification.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
});
