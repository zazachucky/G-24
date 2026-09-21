// Real Customer form edits and HTTP state; private profile data must not reach Director.
const fs=require('node:fs');
const path=require('node:path');
const {launch,delay}=require('./browser_driver.cjs');
const base=process.env.GS_SIZE_URL||'http://127.0.0.1:8791';
const output=path.resolve(__dirname,'../docs/evidence');
const report={status:'RUNNING',started_at:new Date().toISOString(),server:base,
  scope:'Actual private sizing form, transparent garment-comparison rules, manual purchase options and customer isolation. No predictive body-fit or synthetic review claims.',checks:[],screenshots:[]};
let browser;
const check=(name,ok,details)=>{if(!ok)throw new Error(name+(details?': '+JSON.stringify(details):''));report.checks.push({name,status:'PASS',...(details?{details}:{})});console.log('PASS',name);};
async function state(customer){return(await fetch(base+'/api/state'+(customer?'?customer_id='+customer:''))).json();}
async function reset(){const s=await state();const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset',run_id:s.run_id})});if(!r.ok)throw new Error(await r.text());return r.json();}
async function boot(p){await p.wait('!!window.gsApp?.getState().state?.customer?.profile','profile-ready customer');}
async function close(p){if(await p.evaluate('document.querySelector("#dialog").open'))await p.click('#dialog-close');}
async function open(p){await p.click('#size-button');await p.wait('!!document.querySelector("#size-profile-form")','size form rendered');}
async function save(p,recommended){await p.click('#size-profile-save');await p.wait('document.querySelector("#size-profile-status")?.textContent.includes("저장했어요")','profile save acknowledged');await p.wait(`document.querySelector('#recommended-size')?.dataset.recommendedSize===${JSON.stringify(recommended||'')}`,'expected private recommendation');}
async function screenshot(p,name){await p.screenshot(path.join(output,name+'.png'));report.screenshots.push(name+'.png');}

(async()=>{
 if(new URL(base).port==='8765')throw new Error('Use an isolated test server for reset-based profile audit.');
 await reset();browser=await launch();
 const a=await browser.page(base+'/app/customer.html?customer=customer-A',1440,1100);
 const b=await browser.page(base+'/app/customer.html?customer=customer-B',390,844,true);
 const director=await browser.page(base+'/app/director.html',1440,1100);
 await Promise.all([boot(a),boot(b)]);await director.wait('document.body.dataset.connection==="online"');
 await open(a);
 check('Default private profile preserves the prepared 66 recommendation',await a.evaluate('document.querySelector("#recommended-size").dataset.recommendedSize==="66"&&document.querySelector("#size-profile-height").value===""&&document.querySelector("#size-profile-garment").value===""'));
 check('Sizing form labels garment width separately from body circumference',await a.evaluate('document.querySelector("#size-profile-form").innerText.includes("신체 가슴둘레를 입력하지")&&document.querySelector("#size-profile-usual").value==="66"'));
 check('Review evidence remains overall product aggregate without fabricated review portraits',await a.evaluate('document.querySelector(".size-review-evidence").innerText.includes("87%")&&document.querySelector(".size-review-evidence").innerText.includes("1,202")&&document.querySelector(".size-review-evidence").innerText.includes("비슷한 체형 고객의 만족률이 아니")&&!document.querySelector(".size-review-evidence img")'));
 await a.fill('#size-profile-height','177.7');await save(a,'66');
 check('Height alone is saved as context and never changes recommended size',(await state('customer-A')).customer.profile.height_cm===177.7&&await a.evaluate('document.querySelector("#size-recommendation-reasons").innerText.includes("177.7")&&document.querySelector("#size-recommendation-reasons").innerText.includes("추정하지")'));
 await a.fill('#size-profile-height','139');await a.click('#size-profile-save');await delay(350);
 check('Invalid height is blocked by actual form validity and never saved',await a.evaluate('!document.querySelector("#size-profile-height").validity.valid')&&(await state('customer-A')).customer.profile.height_cm===177.7);
 await a.fill('#size-profile-height','177.7');await a.click('#size-profile-half');await save(a,'77');
 check('Half-size preference changes the displayed recommendation and recommended option badge',await a.evaluate('document.querySelector(".size-result-options [data-size=\\"77\\"] small")?.textContent==="추천"&&gsApp.getState().state.customer.profile.half_size'));
 check('Saving a new recommendation does not change the selected purchase size',await a.evaluate('gsApp.getState().ui.size==="66"&&document.querySelector("#size-result-selection").textContent.includes("66")'));
 await a.click('#size-profile-half');await a.fill('#size-profile-usual','55');await a.fill('#size-profile-garment','46.8');
 await a.click('.size-result-options [data-size="55"]');
 check('Manual option selection preserves unsaved profile edits',await a.evaluate('document.querySelector("#size-profile-garment").value==="46.8"&&document.querySelector("#size-profile-usual").value==="55"&&gsApp.getState().ui.size==="55"'));
 await save(a,'77');
 check('Owned garment width compares against real product 47.5 cm option',await a.evaluate('document.querySelector("#size-recommendation-reasons").innerText.includes("46.8")&&document.querySelector("#size-recommendation-reasons").innerText.includes("47.5")&&document.querySelector(".size-measurement-card").innerText.includes("47.5 cm")'));
 await a.fill('#size-profile-fit','relaxed');await save(a,'88');
 check('Relaxed fit uses the saved garment measurement to suggest the next option',await a.evaluate('gsApp.getState().state.customer.profile.fit==="relaxed"&&document.querySelector("#size-recommendation-reasons").innerText.includes("여유 있는 핏")&&gsApp.getState().ui.size==="55"'));
 await a.fill('#size-profile-fit','regular');await save(a,'77');
 const privateA=(await state('customer-A')).customer.profile;
 const publicState=JSON.stringify(await state()),other=await state('customer-B');
 check('Director public payload and another customer never receive A profile fields',!publicState.includes('"height_cm"')&&!publicState.includes('"garment_chest_cm"')&&!publicState.includes('"usual_size"')&&other.customer.profile.height_cm===null&&other.customer.profile.garment_chest_cm===null&&other.customer.profile.usual_size==='66');
 check('Director DOM excludes raw private height and garment measurements',await director.evaluate('!document.body.innerText.includes("177.7")&&!document.body.innerText.includes("46.8")'));
 await a.click('#size-purchase');await a.wait('document.querySelector("#sheet-title").innerText==="구매 정보 확인"','purchase sheet');
 check('Purchase flow follows manual 55 option rather than automatic 77 recommendation',await a.evaluate('gsApp.getState().ui.size==="55"&&document.querySelector("[data-purchase-size=\\"55\\"]").getAttribute("aria-pressed")==="true"'));
 await close(a);await open(a);
 await a.fill('#size-profile-garment','80');await save(a,null);
 check('Valid but out-of-table garment width produces manual checking with no invented size',await a.evaluate('document.querySelector("#recommended-size").textContent==="—"&&!document.querySelector(".size-result-options small")&&document.querySelector("#size-recommendation-reasons").innerText.includes("최대")'));
 await a.fill('#size-profile-garment','46.8');await save(a,'77');
 await screenshot(a,'size-profile-personalized');
 await a.navigate(base+'/app/customer.html?customer=customer-A');await boot(a);await a.wait('!!document.querySelector("#size-profile-form")','refresh retains active result');
 check('Refresh preserves saved private inputs recommendation and manual option',await a.evaluate('document.querySelector("#size-profile-height").value==="177.7"&&document.querySelector("#size-profile-garment").value==="46.8"&&document.querySelector("#recommended-size").dataset.recommendedSize==="77"&&gsApp.getState().ui.size==="55"'));
 await close(a);await a.fill('#customer-select','customer-B');await a.wait('gsApp.getState().state?.customer?.id==="customer-B"','switch to B');await open(a);
 check('Customer B starts with its independent unchanged profile',await a.evaluate('document.querySelector("#size-profile-height").value===""&&document.querySelector("#size-profile-garment").value===""&&document.querySelector("#recommended-size").dataset.recommendedSize==="66"'));
 await a.fill('#size-profile-usual','55');await save(a,'55');
 check('Saving B profile does not overwrite A measurements',JSON.stringify((await state('customer-A')).customer.profile)===JSON.stringify(privateA));
 await close(a);await a.fill('#customer-select','customer-A');await a.wait('gsApp.getState().state?.customer?.id==="customer-A"','return A');await open(a);
 check('Returning to A restores its own saved recommendation',await a.evaluate('document.querySelector("#recommended-size").dataset.recommendedSize==="77"&&document.querySelector("#size-profile-height").value==="177.7"'));
 await a.viewport(390,844,true);
 check('Private profile form fits mobile without horizontal overflow',await a.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#dialog").scrollWidth<=document.querySelector("#dialog").clientWidth+1'));
 await a.evaluate('document.querySelector("#size-profile-form").scrollIntoView({block:"center",behavior:"instant"})');await screenshot(a,'size-profile-mobile');
 // Delay only the actual successful response; the server mutation still happens.
 await a.evaluate(`(()=>{const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);const body=args[1]?.body;if(body&&JSON.parse(body).action==='profile_update')await new Promise(resolve=>setTimeout(resolve,700));return r;};})()`);
 await a.fill('#size-profile-height','166.6');await a.click('#size-profile-save');await close(a);await a.fill('#customer-select','customer-B');
 await a.wait('gsApp.getState().state?.customer?.id==="customer-B"','B during delayed save');await delay(900);
 check('Delayed private save cannot reopen or overwrite another customer screen',await a.evaluate('!document.querySelector("#dialog").open&&gsApp.getState().state.customer.profile.height_cm===null')&&(await state('customer-A')).customer.profile.height_cm===166.6);
 const restarted=await reset();await a.wait(`gsApp.getState().state?.run_id===${JSON.stringify(restarted.run_id)}`,'shared reset');await open(a);
 check('Reset clears saved profiles and restores default recommendation 66',await a.evaluate('document.querySelector("#recommended-size").dataset.recommendedSize==="66"&&document.querySelector("#size-profile-usual").value==="66"&&document.querySelector("#size-profile-height").value===""')&&(await state('customer-A')).customer.profile.height_cm===null);
 check('No uncaught browser errors during sizing changes and customer transitions',[...a.errors,...b.errors,...director.errors].length===0);
 report.status='PASS';report.completed_at=new Date().toISOString();
})().catch(error=>{report.status='FAIL';report.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(async()=>{
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'size-profile-verification.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();
});
