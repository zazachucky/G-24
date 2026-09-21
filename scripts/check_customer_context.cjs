// Real HTTP replies with an injected delivery delay to exercise customer races.
const fs=require('node:fs');
const path=require('node:path');
const {launch,delay}=require('./browser_driver.cjs');
const base=process.env.GS_DEMO_URL||'http://127.0.0.1:8765';
const out=path.resolve(__dirname,'../docs/evidence/customer-context-verification.json');
const report={status:'RUNNING',checks:[],started_at:new Date().toISOString()};
let browser;
async function api(action,extra={},customer){const s=await(await fetch(base+'/api/state')).json();const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,run_id:s.run_id,...(customer?{customer_id:customer}:{}),...extra})});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;}
const check=(name,value)=>{if(!value)throw new Error(name);report.checks.push({name,status:'PASS'});console.log('PASS',name);};
async function ask(p,text){await p.fill('#ask-input',text);await p.click('#ask-submit');await p.wait(`document.querySelector('#messages').innerText.includes(${JSON.stringify(text)})`,'question submitted');}
(async()=>{
 await api('reset');browser=await launch();
 const a=await browser.page(base+'/app/customer.html?customer=customer-A');
 const b=await browser.page(base+'/app/customer.html?customer=customer-B');
 const c=await browser.page(base+'/app/customer.html?customer=customer-C');
 for(const p of [a,b,c])await p.wait('!!window.gsApp?.getState().state','customer boot');
 await ask(b,'B 전용 질문: 두께감 어때?');await ask(c,'C 전용 질문: 색상이 어때?');
 await ask(b,'내 혜택 알려줘');await b.wait('document.querySelector("#dialog").open','B benefit');await b.click('#dialog-close');await b.wait('!document.querySelector("#dialog").open','B close');await delay(150);
 const before=(await(await fetch(base+'/api/state')).json()).integration.totals.benefit_views;
 await a.fill('#customer-select','customer-B');await a.wait('gsApp.getState().state?.customer?.id==="customer-B"','B selected');await delay(300);
 check('Archived direct result remains closed after customer switch',!(await a.evaluate('document.querySelector("#dialog").open')));
 check('Customer switch does not emit duplicate result view',(await(await fetch(base+'/api/state')).json()).integration.totals.benefit_views===before);
 await a.fill('#customer-select','customer-A');await a.wait('gsApp.getState().state?.customer?.id==="customer-A"','A selected');
 await a.evaluate(`(()=>{const original=window.fetch;window.fetch=async (...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/state?customer_id=customer-B'))await new Promise(r=>setTimeout(r,650));return response;};})()`);
 await a.fill('#customer-select','customer-B');await delay(80);await a.fill('#customer-select','customer-C');
 await a.wait('gsApp.getState().state?.customer?.id==="customer-C"','C selected');await delay(750);
 check('Delayed B response cannot replace active C conversation',await a.evaluate('gsApp.getState().customerId==="customer-C"&&gsApp.getState().state?.customer?.id==="customer-C"&&!document.querySelector("#messages").innerText.includes("B 전용")&&document.querySelector("#messages").innerText.includes("C 전용")'));
 // Action fields from fixtures must produce useful detail/inquiry routes.
 const reviewSelector='#messages [data-route="product_detail.review"],#messages [data-route="product_detail.reviews"]';
 await ask(c,'상품후기 알려줘');await c.wait(`!!document.querySelector(${JSON.stringify(reviewSelector)})`,'review answer CTA');
 await c.click('#messages [data-route="product_detail.review"],#messages [data-route="product_detail.reviews"]');await c.wait('document.querySelector("#dialog").open','review CTA opens');
 check('Prepared review action reaches reviews',await c.evaluate('document.querySelector("#sheet-content").innerText.includes("1,202")'));await c.click('#dialog-close');
 const inquirySelector='#messages [data-route="product_detail.inquiry"],#messages [data-route="product_detail.questions"]';
 await ask(c,'모델은 몇 사이즈 입었어?');await c.wait(`!!document.querySelector(${JSON.stringify(inquirySelector)})`,'unverified worn-size inquiry CTA');
 await c.click('#messages [data-route="product_detail.inquiry"],#messages [data-route="product_detail.questions"]');await c.wait('document.querySelector("#dialog").open','inquiry CTA opens');
 check('Unsupported/video question offers product inquiry',await c.evaluate('document.querySelector("#sheet-content").innerText.includes("상품문의")'));await c.click('#dialog-close');
 // Product change cancels pending replies and preserves rejection across products.
 await c.fill('#ask-fault','delay');await ask(c,'두께감 어때?');await c.wait('!!document.querySelector(".processing")','pending request');
 await c.evaluate('document.querySelector(".demo-toolbar details").open=true');await c.click('#switch-product');await delay(5500);
 check('Product change drops old product pending reply',await c.evaluate('!document.querySelector(".processing")&&!document.querySelector("#messages").innerText.includes("두께감 어때?")'));
 await c.click('#switch-product');await c.wait('gsApp.getState().state.customers.find(c=>c.id==="customer-C").current_product==="1084192893"','return product');
 check('Canceled request does not turn into completed answer',await c.evaluate('gsApp.getState().state.customer.messages.some(m=>m.text.includes("요청을 취소"))&&!gsApp.getState().state.customer.messages.some(m=>m.fallback&&m.text.includes("63%"))'));
 await c.fill('#ask-fault','error');await ask(c,'오늘 주문하면 언제 와?');
 await c.wait('document.querySelector("#messages").innerText.includes("준비 답변으로 대체")','error fallback');
 check('Adapter error renders same-intent delivery fallback',await c.evaluate('gsApp.getState().state.customer.messages.some(m=>m.fallback&&m.text.includes("배송 시뮬레이션"))'));
 await a.fill('#customer-select','customer-A');await a.wait('gsApp.getState().state?.customer?.id==="customer-A"','A selected for highlight overrides');
 const approve=async()=>{await api('demo_start');await api('demo_spike');await api('approve_app',{approval_id:'context-check-approval'});await a.wait('document.querySelector("#size-button").dataset.highlight==="true"','A approved');};
 await approve();await a.evaluate('document.querySelector(".demo-toolbar details").open=true');await a.click('#switch-product');
 await a.wait('document.querySelector("#size-button").dataset.highlight==="false"','switch cancels highlight');await a.click('#switch-product');
 await a.wait('gsApp.getState().state.customers.find(c=>c.id==="customer-A").current_product==="1084192893"','back to main');
 check('Returning to product does not restore old highlight',await a.evaluate('document.querySelector("#size-button").dataset.highlight==="false"'));
 await approve();await a.click('#suggestion-dismiss');await a.wait('document.querySelector("#size-button").dataset.highlight==="false"','dismiss overrides approval');
 await a.click('#size-button');await a.wait('document.querySelector("#dialog").open','manual size after dismissal');
 check('Post-approval dismissal preserves manual size',await a.evaluate('document.querySelector("#sheet-title").innerText==="내 사이즈"'));await a.click('#dialog-close');
 await approve();const director=await browser.page(base+'/app/director.html');await director.wait('!!document.querySelector("#director-state")?.dataset.state','director ready');await director.click('#end-live');
 await a.wait('gsApp.getState().state.ended&&!gsApp.getState().state.customer.highlight','broadcast ended');
 await a.click('#size-button');await a.wait('document.querySelector("#dialog").open','manual size after broadcast end');await delay(150);
 check('Broadcast end removes highlight and preserves manual browsing',await a.evaluate('document.querySelector("#sheet-title").innerText==="내 사이즈"&&!document.querySelector("#toast").innerText.includes("종료된 방송")'));
 check('No browser exceptions',[...a.errors,...b.errors,...c.errors].length===0);
 report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();});
