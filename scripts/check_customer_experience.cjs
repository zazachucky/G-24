// Actual Customer controls added from the supplied experience reference.
// Start a dedicated server on 8781. This suite never resets the user's 8765 server.
const fs=require('node:fs');
const path=require('node:path');
const {launch,delay}=require('./browser_driver.cjs');
const base=process.env.GS_EXPERIENCE_URL||'http://127.0.0.1:8781';
const output=path.resolve(__dirname,'../docs/evidence');
const report={status:'RUNNING',started_at:new Date().toISOString(),base,scope:'Actual Chrome Customer actions for share, cart, per-tab leave, public comments, review cards, size, benefits and styling; existing product facts retained',checks:[],screenshots:[]};
let browser;
function check(name,ok,details){if(!ok)throw new Error(name+(details?': '+JSON.stringify(details):''));report.checks.push({name,status:'PASS',...(details?{details}:{})});console.log('PASS',name);}
async function state(customer){return(await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''))).json();}
async function action(action,extra={}){const before=await state();const response=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:before.run_id,...extra})});const next=await response.json();if(!response.ok)throw new Error(JSON.stringify(next));return next;}
async function until(predicate,label,customer,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){const current=await state(customer);if(predicate(current))return current;await delay(100);}throw new Error('State timeout: '+label);}
async function close(page){if(await page.evaluate('document.querySelector("#dialog").open')){await page.click('#dialog-close');await page.wait('!document.querySelector("#dialog").open');await delay(140);}}
async function ask(page,text){await page.fill('#ask-input',text);await page.click('#ask-submit');await page.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(text)})`);}
async function boot(page){await page.wait('!!window.gsApp?.getState().state');}
async function shot(page,name){await page.wait('!document.querySelector("#toast").classList.contains("show")');await delay(300);const file='customer-experience-'+name+'.png';await page.screenshot(path.join(output,file));report.screenshots.push(file);}
async function switchCustomer(page,id){await page.fill('#customer-select',id);await page.wait(`gsApp.getState().state?.customer.id===${JSON.stringify(id)}`);await delay(250);}
async function stylingLayout(page,width,height){
 await close(page);await page.viewport(width,height,true);
 const landscape=width>height;
 if(await page.evaluate('document.body.classList.contains("landscape")')!==landscape){await page.click('#orientation-toggle');await page.wait(`document.body.classList.contains('landscape')===${landscape}`);}
 await page.click('#styling-button');await page.wait('!!document.querySelector("#styling-all-button")');
 const cta=await page.evaluate(`(() => {
  const button=document.querySelector('#styling-all-button');button.scrollIntoView({block:'center',behavior:'instant'});
  const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.textContent.trim())break;}
  const range=document.createRange();range.selectNodeContents(node);const label=range.getBoundingClientRect(),arrow=button.querySelector('svg').getBoundingClientRect(),rect=button.getBoundingClientRect();
  const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
  return {direction:getComputedStyle(button).flexDirection,labelCenter:label.y+label.height/2,arrowCenter:arrow.y+arrow.height/2,arrowAfterLabel:arrow.left>=label.right-1,height:rect.height,uncovered:hit===button||button.contains(hit)};
 })()`);
 check(`STYLE UI ${width}x${height} all-products label and arrow share one horizontal row`,cta.direction==='row'&&Math.abs(cta.labelCenter-cta.arrowCenter)<=4&&cta.arrowAfterLabel&&cta.uncovered,cta);
 await shot(page,`styling-footer-${width}x${height}`);
 await page.click('#styling-all-button');await page.wait('document.querySelector("#sheet-title").textContent==="전체 코디 상품"');
 await page.wait('[...document.querySelectorAll(".styling-all-item>img")].every(image=>image.complete&&image.naturalWidth>0)');
 const catalog=await page.evaluate(`(() => {
  const dialog=document.querySelector('#dialog'),content=document.querySelector('#sheet-content'),cards=[...document.querySelectorAll('.styling-all-item')];
  return {viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,dialogWidth:dialog.clientWidth,contentWidth:content.scrollWidth,overflowingCards:cards.filter(card=>card.scrollWidth>card.clientWidth+1).map(card=>card.dataset.stylingSku),count:cards.length};
 })()`);
 check(`STYLE UI ${width}x${height} seven-product catalog has no horizontal overflow`,catalog.count===7&&catalog.documentWidth<=width+1&&catalog.contentWidth<=catalog.dialogWidth+1&&!catalog.overflowingCards.length,catalog);
 await shot(page,`styling-all-${width}x${height}`);
 const lastLink=await page.evaluate(`(() => {
  const link=[...document.querySelectorAll('.styling-all-item a')].at(-1);link.scrollIntoView({block:'center',behavior:'instant'});
  const rect=link.getBoundingClientRect(),footer=document.querySelector('#sheet-footer').getBoundingClientRect(),header=document.querySelector('.sheet-header').getBoundingClientRect();
  const hits=[.2,.5,.8].every(fraction=>{const hit=document.elementFromPoint(rect.x+rect.width*fraction,rect.y+rect.height/2);return hit===link||link.contains(hit);});
  return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,height:rect.height,headerBottom:header.bottom,footerTop:footer.top,uncovered:hits,sku:link.closest('[data-styling-sku]').dataset.stylingSku};
 })()`);
 check(`STYLE UI ${width}x${height} last product detail link is tappable above the footer`,lastLink.uncovered&&lastLink.height>=44&&lastLink.top>=lastLink.headerBottom-1&&lastLink.bottom<=lastLink.footerTop+1&&lastLink.left>=0&&lastLink.right<=width+1,lastLink);
 await shot(page,`styling-all-last-${width}x${height}`);
 await page.click('#styling-back');await page.wait('document.querySelector("#sheet-title").textContent==="코디 추천"');
 check(`STYLE UI ${width}x${height} return preserves the selected daily look`,await page.evaluate('gsApp.getState().ui.look==="LOOK_03"&&document.querySelector(".look-tabs .active").dataset.look==="LOOK_03"&&document.querySelector(".look-image img").src.includes("look-03.png")'));
 await close(page);
}

(async()=>{
 if(new URL(base).port==='8765')throw new Error('Use an isolated server. This suite does not reset port 8765.');
 await action('reset');browser=await launch();
 const a=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
 const b=await browser.page(base+'/app/customer.html?customer=customer-B',390,844,true);
 const director=await browser.page(base+'/app/director.html',1440,1100);
 await Promise.all([boot(a),boot(b)]);await director.wait('document.body.dataset.connection==="online"');
 await until(s=>s.integration.presence.online_customers===2,'two actual customers');
 await action('advance',{seconds:0});const clock=(await state()).now;

 await a.click('#share-button');await a.wait('document.querySelector("#share-dialog").open');
 await a.evaluate('window.__clipboardWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async()=>{throw new Error("injected permission rejection")};');
 await a.click('#share-copy');await a.wait('!document.querySelector("#share-fallback").hidden');
 check('SHARE01 rejected clipboard permission provides a selectable public link',await a.evaluate('document.activeElement.id==="share-url"&&document.querySelector("#share-url").value==="https://m.gsshop.com/prd/prd.gs?prdid=1084192893"&&document.querySelector("#share-url").selectionEnd===document.querySelector("#share-url").value.length'));
 check('SHARE02 failed copy does not claim a successful share event',!(await state()).integration.event_counts.SHARE_COPY);
 await a.evaluate('navigator.clipboard.writeText=window.__clipboardWrite');
 await a.send('Browser.grantPermissions',{origin:base,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await a.click('#share-copy');await a.wait('document.querySelector("#share-status").textContent.includes("복사했어요")');
 check('SHARE03 successful copy writes only the actual product URL',await a.evaluate('navigator.clipboard.readText()')==='https://m.gsshop.com/prd/prd.gs?prdid=1084192893');
 await until(s=>s.integration.event_counts.SHARE_COPY===1,'share event');await a.key('Escape');await a.wait('!document.querySelector("#share-dialog").open');
 check('SHARE04 keyboard can close the share dialog',true);

 const secondA=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);await boot(secondA);
 await until(s=>s.integration.customers[0].sessions===2,'same customer second tab');
 await a.click('#live-exit');await a.wait('document.body.dataset.joined==="false"&&!document.querySelector("#live-landing").hidden');
 let current=await until(s=>s.integration.customers[0].sessions===1,'exit only one A tab');
 check('LIVE01 exit removes only this tab presence without ending the broadcast',!current.ended&&current.integration.presence.online_customers===2&&await secondA.evaluate('document.body.dataset.joined==="true"&&!document.querySelector(".device").hidden'));
 await a.navigate(base+'/app/customer.html?customer=customer-A');await boot(a);
 check('LIVE02 exited state survives reload in the same tab',await a.evaluate('document.body.dataset.joined==="false"'));
 await switchCustomer(a,'customer-B');check('LIVE03 another virtual customer does not inherit A departure',await a.evaluate('document.body.dataset.joined==="true"'));
 await switchCustomer(a,'customer-A');check('LIVE04 returning to A restores this tab departure',await a.evaluate('document.body.dataset.joined==="false"'));
 await a.click('#live-rejoin');await a.wait('document.body.dataset.joined==="true"');
 await until(s=>s.integration.customers[0].sessions===2,'rejoin A');
 check('LIVE05 rejoin retains original run and avoids duplicate customer entry',(await state()).now===clock&&(await state()).integration.event_counts.LIVE_ENTER===2);
 await secondA.navigate('about:blank');await until(s=>s.integration.customers[0].sessions===1,'second A leaves');

 const secret='비공개_체험검사_9921 두께감 알려줘';await ask(a,secret);
 await a.wait('document.querySelector("#messages [data-review-group=thickness]")');
 check('ASK01 thickness answer renders original 63/35/2 bars inside the conversation',await a.evaluate('(() => {const card=document.querySelector("#messages [data-review-group=thickness]");return [...card.querySelectorAll(".review-line b")].map(e=>e.textContent).sort().join(",")==="2%,35%,63%"&&[...card.querySelectorAll(".bar i")].map(e=>e.style.width).sort().join(",")==="2%,35%,63%"&&card.innerText.includes("1,202");})()'));
 await a.click('#messages [data-route="product_detail.reviews"]');await a.wait('document.querySelector("#dialog").open');
 check('ASK02 full review action opens actual review data',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("리뷰 1,200건")&&document.querySelector("#sheet-content").innerText.includes("원본 비율 합계 99%")'));await close(a);
 await ask(a,'색상이 화면과 비슷해?');await a.wait('document.querySelector("#messages [data-review-group=color]")');
 check('ASK03 inline color card preserves 99 percent total',await a.evaluate('document.querySelector("#messages [data-review-group=color]").innerText.includes("원본 합계 99%")'));
 check('ASK04 private question remains absent from public API and other customer',!JSON.stringify(await state()).includes(secret)&&!JSON.stringify(await state('customer-B')).includes(secret));

 await a.click('.public-comments summary');const publicText='함께 보는 공개 댓글 <b>그대로 표시</b>';
 await a.fill('#public-comment-input',publicText);await a.click('#public-comment-submit');
 current=await until(s=>s.integration.comments.length===1,'public comment publication');const commentId=current.integration.comments[0].comment_id;
 await b.wait(`!!document.querySelector('[data-public-comment-id="${commentId}"]')`);
 await director.wait(`!!document.querySelector('[data-comment-id="${commentId}"]')`);
 check('CHAT01 explicit public comment reaches another customer and Director',current.integration.comments[0].text===publicText);
 check('CHAT02 public markup is escaped and private ASK is never overlaid',await b.evaluate(`document.querySelector('[data-public-comment-id="${commentId}"]').innerText.includes('<b>그대로 표시</b>')&&!document.querySelector('[data-public-comment-id="${commentId}"] b')&&!document.querySelector('#public-comment-overlay').innerText.includes(${JSON.stringify(secret)})`));
 await a.evaluate(`window.__originalFetch=window.fetch;window.__loseComment=true;window.fetch=async(...args)=>{const body=args[1]?.body;const payload=typeof body==='string'?JSON.parse(body):null;const response=await window.__originalFetch(...args);if(payload?.action==='comment_publish'&&window.__loseComment){window.__loseComment=false;throw new TypeError('injected lost response');}return response;};`);
 await a.fill('#public-comment-input','응답 유실에도 한 번만 게시');await a.click('#public-comment-submit');await a.wait('document.querySelector("#public-comment-status").textContent.includes("확인하지 못했어요")');
 await until(s=>s.integration.comments.length===2,'server accepted before response loss');await a.click('#public-comment-submit');await a.wait('document.querySelector("#public-comment-input").value===""');
 check('CHAT03 uncertain-response retry retains one public comment', (await state()).integration.comments.length===2);await a.evaluate('window.fetch=window.__originalFetch');

 await a.click('#purchase-button');check('CART01 sold-out gray 66 cannot be added',await a.evaluate('document.querySelector("#purchase-cart-add").disabled'));
 await a.click('[data-color="블랙"]');await a.click('[data-purchase-size="77"]');await a.click('#purchase-cart-add');
 current=await until(s=>s.customer.cart.length===1&&s.customer.cart[0].quantity===1,'first actual cart addition','customer-A');
 await a.wait('!document.querySelector("#purchase-cart-add").disabled');await a.click('#purchase-cart-add');
 current=await until(s=>s.customer.cart[0]?.quantity===2,'repeat addition merges quantity','customer-A');
 check('CART02 duplicate option adds quantity to one cart line',current.customer.cart.length===1&&current.customer.cart[0].color==='블랙'&&current.customer.cart[0].size==='77');
 await close(a);await a.click('#cart-button');await a.wait('document.querySelector("#cart-total").textContent==="99,800원"');
 await a.click('[data-cart-quantity="3"]');await a.wait('document.querySelector("#cart-total").textContent==="149,700원"');
 check('CART03 increase updates actual quantity and merchandise subtotal',(await state('customer-A')).customer.cart[0].quantity===3);
 await a.click('[data-cart-quantity="2"]');await a.wait('document.querySelector("#cart-total").textContent==="99,800원"');
 check('CART04 decrease updates actual quantity',(await state('customer-A')).customer.cart[0].quantity===2);
 await b.click('#cart-button');await b.wait('document.querySelector("#dialog").open');
 check('CART05 other customer and public snapshot do not receive A cart',await b.evaluate('!!document.querySelector(".cart-empty")')&&(await state('customer-B')).customer.cart.length===0&&!Object.hasOwn(await state(),'customer'));
 const beforeReload=(await state()).integration.event_counts.CART_OPEN;
 await a.navigate(base+'/app/customer.html?customer=customer-A');await boot(a);await a.wait('document.querySelector("#dialog").open&&!!document.querySelector("#cart-total")');
 check('CART06 refresh restores cart without duplicating open or add',await a.evaluate('document.querySelector("#cart-total").textContent==="99,800원"')&&(await state()).integration.event_counts.CART_OPEN===beforeReload&&(await state('customer-A')).customer.cart[0].quantity===2);
 await switchCustomer(a,'customer-B');await a.wait('!!document.querySelector(".cart-empty")');
 check('CART07 changing customer clears the previous cart content',await a.evaluate('document.querySelectorAll("[data-cart-item]").length===0'));
 await switchCustomer(a,'customer-A');await a.wait('!!document.querySelector("[data-cart-item]")');
 const clicks=(await state()).integration.totals.purchase_clicks;
 await a.click('[data-cart-checkout]');await a.wait('document.querySelector("#sheet-title").textContent==="구매 정보 확인"');
 check('CART08 checkout keeps selected options, two items and prepared total',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("블랙 / 77 · 2개")&&document.querySelector("#sheet-content").innerText.includes("91,030원")'));
 await until(s=>s.integration.totals.purchase_clicks===clicks+1,'exactly one checkout purchase event');
 check('CART09 checkout records one purchase entry',true);
 await a.click('#demo-order');await a.wait('document.querySelector("#sheet-title").textContent==="구매 체험 완료"');
 current=await until(s=>s.customer.cart.length===0,'completed matching cart line removed','customer-A');
 check('CART10 demo completion removes its cart line and creates no real order',current.integration.totals.purchase_completions===1&&await a.evaluate('document.querySelector("#sheet-content").innerText.includes("실제 주문·결제·배송은 발생하지 않았습니다")'));await close(a);
 await a.click('#live-cart-add');await until(s=>s.customer.cart.length===1,'add from LIVE','customer-A');await a.click('#cart-button');await a.click('[data-cart-remove]');await a.wait('!!document.querySelector(".cart-empty")');
 check('CART11 explicit deletion updates cart and badge',(await state('customer-A')).customer.cart.length===0&&await a.evaluate('document.querySelector("#cart-count").textContent==="0"'));await close(a);
 await a.evaluate(`window.__originalFetch=window.fetch;window.__loseCart=true;window.fetch=async(...args)=>{const body=args[1]?.body;const payload=typeof body==='string'?JSON.parse(body):null;const response=await window.__originalFetch(...args);if(payload?.action==='cart_add'&&window.__loseCart){window.__loseCart=false;throw new TypeError('injected lost cart response');}return response;};`);
 await a.click('#live-cart-add');await until(s=>s.customer.cart[0]?.quantity===1,'cart accepted before response loss','customer-A');await a.wait('!document.querySelector("#live-cart-add").disabled');await a.click('#live-cart-add');await a.wait('document.querySelector("#toast").innerText.includes("담았어요")');
 check('CART12 uncertain-response retry does not add a duplicate quantity',(await state('customer-A')).customer.cart.length===1&&(await state('customer-A')).customer.cart[0].quantity===1);await a.evaluate('window.fetch=window.__originalFetch');
 await a.click('#cart-button');
 for(let quantity=2;quantity<=10;quantity++){await a.click(`[data-cart-quantity="${quantity}"]`);await a.wait(`document.querySelector('[data-cart-item] output').textContent==='${quantity}'`);}
 check('CART13 maximum quantity enforces 10 and exact 499000 merchandise total',await a.evaluate(`document.querySelector('[data-cart-quantity="11"]').disabled&&document.querySelector('#cart-total').textContent==='499,000원'`)&&(await state('customer-A')).customer.cart[0].quantity===10);
 await a.click('[data-cart-remove]');await a.wait('!!document.querySelector(".cart-empty")');await close(a);



 await a.click('#live-cart-add');await until(s=>s.customer.cart[0]?.quantity===1,'concurrent cart first item','customer-A');await a.wait('!document.querySelector("#live-cart-add").disabled');await a.click('#live-cart-add');await until(s=>s.customer.cart[0]?.quantity===2,'concurrent cart second item','customer-A');
 await a.click('#cart-button');await secondA.navigate(base+'/app/customer.html?customer=customer-A');await boot(secondA);await secondA.wait('!!document.querySelector("[data-cart-item]")');
 await a.click('[data-cart-checkout]');await a.wait('document.querySelector("#sheet-content").innerText.includes("블랙 / 77 · 2개")');
 await secondA.click('[data-cart-quantity="3"]');await until(s=>s.customer.cart[0]?.quantity===3,'other tab adds third item during checkout','customer-A');
 await a.click('#demo-order');await a.wait('document.querySelector("#sheet-title").textContent==="구매 체험 완료"');await until(s=>s.customer.cart[0]?.quantity===1,'only checked-out quantity removed','customer-A');
 check('CART14 concurrent same-customer tab retains newly added quantity',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("2개")')&&(await state('customer-A')).customer.cart[0].quantity===1);
 await close(a);await a.click('#cart-button');await a.click('[data-cart-remove]');await a.wait('!!document.querySelector(".cart-empty")');await close(a);await secondA.navigate('about:blank');

 await a.click('#size-button');await a.click('.size-result-options [data-size="88"]');
 await until(s=>s.integration.customers[0].selection.size==='88','size-result option reaches Director');
 await director.wait('document.querySelector("#customer-body [data-customer=customer-A]").innerText.includes("88")');
 check('SIZE01 result-level selection reaches common options and Director',await a.evaluate(`document.querySelector('.size-result-options [data-size="88"]').getAttribute('aria-pressed')==='true'&&document.querySelector('.size-num').textContent==='66'`));
 check('SIZE02 profile and review evidence avoid invented body cohorts or individual reviews',await a.evaluate('document.querySelector("#size-profile-height").value===""&&document.querySelector("#size-profile-garment").value===""&&document.querySelector(".size-review-evidence").innerText.includes("1,046")&&document.querySelector(".size-review-evidence").innerText.includes("1,202")&&document.querySelector(".size-review-evidence").innerText.includes("87%")'));
 await a.click('#size-purchase');await a.wait('document.querySelector("#sheet-title").textContent==="구매 정보 확인"');
 check('SIZE03 chosen 88 reaches purchase without resetting to recommended 66',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("블랙 / 88 · 1개")'));await close(a);
 await a.click('#benefit-button');
 check('BENEFIT01 extra conditions preserve existing benefit arithmetic',await a.evaluate('document.querySelectorAll("[data-benefit-condition]").length===3&&document.querySelector("#sheet-content").innerText.includes("45,515")&&document.querySelector("#sheet-content").innerText.includes("4,385")&&document.querySelector("[data-benefit-condition=installments]").innerText.includes("확인되지 않았습니다")'));
 await a.click('[data-benefit-condition="delivery"] [data-route]');await a.wait('document.querySelector("#sheet-content").innerText.includes("배송 시뮬레이션")');
 check('BENEFIT02 delivery condition opens the prepared delivery explanation',await a.evaluate('document.querySelector("#sheet-content").innerText.includes("2~3영업일")'));await close(a);
 await a.click('#styling-button');await a.click('.look-tabs [data-look="LOOK_02"]');
 await a.wait(`document.querySelector('.look-tabs [data-look="LOOK_02"]').getAttribute('aria-pressed')==='true'`);
 check('STYLE01 preference tab selects the large AI look and matching actual products',await a.evaluate('document.querySelector(".look-image img").src.includes("look-02.png")&&[...document.querySelectorAll(".look-items [data-product-link]")].map(e=>e.dataset.productLink).join(",")==="1103680106,1110407317"&&[...document.querySelectorAll(".look-products [data-styling-product]")].map(e=>e.dataset.stylingProduct).join(",")==="1084192893,1103680106,1110407317"&&!document.querySelector(".look-products [data-look]")'));
 await a.evaluate('document.querySelectorAll(".look-products a").forEach(link=>link.addEventListener("click",event=>event.preventDefault()))');
 const railSku='1110407317',railBefore=(await state()).integration.linked_products.find(row=>row.product_id===railSku)?.count||0;
 await a.click('.look-products [data-styling-product="'+railSku+'"]');
 await until(s=>s.integration.linked_products.some(row=>row.product_id===railSku&&row.count===railBefore+1),'actual shoe thumbnail attributed once');
 await delay(250);
 check('STYLE05 actual product thumbnail records one SKU click without changing the selected AI look',(await state()).integration.linked_products.find(row=>row.product_id===railSku).count===railBefore+1&&await a.evaluate('gsApp.getState().ui.look==="LOOK_02"&&document.querySelector(".look-tabs .active").dataset.look==="LOOK_02"&&document.querySelector(".look-image img").src.includes("look-02.png")'));
 await a.click('.look-tabs [data-look="LOOK_03"]');await a.wait('document.querySelector(".look-image img").src.includes("look-03.png")');
 const stylingLabels=await a.evaluate('[...document.querySelectorAll(".look-items a")].map(link=>link.textContent.trim())');
 check('STYLE06 all three current-look product links use the same detail label',stylingLabels.length===3&&stylingLabels.every(label=>label==='상품 상세 보기 ↗'),stylingLabels);
 await a.click('#styling-all-button');await a.wait('document.querySelector("#sheet-title").textContent==="전체 코디 상품"');
 const skus=await a.evaluate('[...document.querySelectorAll("[data-styling-sku]")].map(e=>e.dataset.stylingSku).sort()');
 check('STYLE02 all products contains exactly seven unique confirmed SKUs',JSON.stringify(skus)===JSON.stringify(['1084192893','1103554292','1092943486','1103680106','1110407317','1052764372','1085417942'].sort()));
 const catalogLabels=await a.evaluate('[...document.querySelectorAll(".styling-all-item a")].map(link=>link.textContent.trim())');
 check('STYLE07 all seven catalog product links use the same detail label',catalogLabels.length===7&&catalogLabels.every(label=>label==='상품 상세 보기 ↗'),catalogLabels);
 await a.evaluate('document.querySelectorAll("[data-product-link]").forEach(link=>link.addEventListener("click",event=>event.preventDefault()))');
 await a.click('.styling-all-grid [data-product-link]');await until(s=>s.integration.linked_products.some(row=>row.product_id==='1103554292'&&row.count===1),'catalog link click attributed to real SKU');
 check('STYLE03 actual catalog product click reaches Director attribution',true);
 await a.click('#styling-back');await a.wait('document.querySelector("#sheet-title").textContent==="코디 추천"');
 check('STYLE04 returning to look images retains selected look 03',await a.evaluate('document.querySelector(".look-image img").src.includes("look-03.png")'));await close(a);

 await a.viewport(390,844,true);await a.click('#size-button');
 check('UI01 new size result fits 390px and keyboard closes it',await a.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#dialog").getBoundingClientRect().width<=innerWidth'));
 await shot(a,'size-mobile');await a.key('Escape');await a.wait('!document.querySelector("#dialog").open');
 await a.click('#benefit-button');await shot(a,'benefit-mobile');await close(a);
 await a.click('#styling-button');await a.click('#styling-all-button');
 check('UI02 seven-product catalog fits mobile width',await a.evaluate('document.querySelector("#sheet-content").scrollWidth<=document.querySelector("#dialog").clientWidth&&document.documentElement.scrollWidth<=innerWidth'));
 await shot(a,'styling-all-mobile');await close(a);
 for(const [width,height] of [[320,740],[390,844],[844,390]])await stylingLayout(a,width,height);
 await a.viewport(390,844,true);if(await a.evaluate('document.body.classList.contains("landscape")')){await a.click('#orientation-toggle');await a.wait('!document.body.classList.contains("landscape")');}
 await a.evaluate('window.scrollTo({top:0,behavior:"instant"})');await shot(a,'live-mobile');
 await a.fill('#media-mode','video');await a.wait('document.querySelector("#live-video").readyState>=2');await a.click('#video-play');await a.wait('document.querySelector("#live-video").currentTime>.2');
 await a.fill('#video-seek','8');await a.click('#video-play');const videoBefore=await a.evaluate('gsApp.getVideo()');
 await a.click('#cart-button');await close(a);await a.click('#orientation-toggle');
 check('MEDIA01 new cart and existing orientation preserve video and frozen domain time',Math.abs((await a.evaluate('gsApp.getVideo()')).time-videoBefore.time)<.7&&(await state()).now===clock);
 await a.fill('#media-mode','image');
 await action('reset');current=await state();await a.wait(`document.body.dataset.runId===${JSON.stringify(current.run_id)}`);
 await b.wait(`document.body.dataset.runId===${JSON.stringify(current.run_id)}`);
 check('RESET01 reset clears carts public comments and old private messages',(await state('customer-A')).customer.cart.length===0&&current.integration.comments.length===0&&(await state('customer-A')).customer.messages.length===1);
 check('RESET02 customer public overlays and cart badge clear after reset',await a.evaluate('document.querySelector("#public-comment-overlay").hidden&&document.querySelector("#cart-count").textContent==="0"'));
 for(let index=1;index<=101;index++)await action('comment_publish',{customer_id:'customer-A',comment_id:'history-cap-'+index,text:'공개 댓글 누적 검수 '+index});
 await a.wait('document.querySelector("#public-comment-count").textContent==="101"');await director.wait('document.querySelector("#monitor-comments").textContent==="101건"');current=await state();
 check('CHAT04 count remains total after recent 100 comments roll over',current.integration.comments.length===100&&current.integration.monitor.comments.total===101&&await a.evaluate('document.querySelectorAll("[data-public-comment-id]").length===3&&document.querySelector("#public-comment-overlay").innerText.includes("검수 101")'));
 await action('demo_start');await action('demo_spike');current=await state();await a.wait(`document.body.dataset.runId===${JSON.stringify(current.run_id)}`);
 await a.send('Page.bringToFront');await a.evaluate('document.querySelector("#size-button").scrollIntoView({block:"center",behavior:"instant"})');
 await action('approve_app',{approval_id:'experience-personalization'});await until(s=>s.integration.event_counts.PERSONALIZATION_SHOWN===1,'visible targeted customer personalization');
 check('PERSONAL01 actual targeted button exposure is measured once',await a.evaluate('document.querySelector("#size-button").dataset.highlight==="true"'));
 await a.navigate(base+'/app/customer.html?customer=customer-A');await boot(a);await a.send('Page.bringToFront');await a.evaluate('document.querySelector("#size-button").scrollIntoView({block:"center",behavior:"instant"})');await delay(800);
 check('PERSONAL02 refresh does not duplicate approval exposure',(await state()).integration.event_counts.PERSONALIZATION_SHOWN===1);
 await b.send('Page.bringToFront');await b.evaluate('document.querySelector("#size-button").scrollIntoView({block:"center",behavior:"instant"})');await delay(600);
 check('PERSONAL03 unrelated customer receives neither highlight nor exposure',await b.evaluate('document.querySelector("#size-button").dataset.highlight==="false"')&&(await state()).integration.event_counts.PERSONALIZATION_SHOWN===1);
 await action('end');await a.wait('gsApp.getState().state.ended');
 check('END01 ended broadcast disables new public comments and cart additions',await a.evaluate('document.querySelector("#public-comment-submit").disabled&&document.querySelector("#live-cart-add").disabled'));

 check('ALL01 no uncaught browser exceptions',[...a.errors,...b.errors,...secondA.errors,...director.errors].length===0);
 report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'customer-experience-verification.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();
});
