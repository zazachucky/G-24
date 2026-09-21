import {videoAnswerCard, setupVideoKnowledge} from './video_experience.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => Number(n).toLocaleString('ko-KR') + '원';
const asset = p => '/' + String(p || '').replace(/^\//, '');
const icon = n => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const uid = () => crypto.randomUUID();
let data, state, videoKnowledge, customerId = new URLSearchParams(location.search).get('customer') || 'customer-A';
if (!['customer-A', 'customer-B', 'customer-C'].includes(customerId)) customerId = 'customer-A';
let ui = {color:'그레이', size:'66', look:'LOOK_01', orientation:'portrait', active_result:null, image_index:0, media_mode:'image'};
let dialogView = null, dialogTab = 'description', returnFocus = null, messageSignature = '', polling = false, writes = 0, initialized = false;
let queue = Promise.resolve(), toastTimer, lastVideoSave = 0, videoFailed = false, restoringVideo = false;
let videoRestoreGeneration = 0, lastVideoSnapshot = '';
const handledResultMessages = new Set(), pendingUI = new Map();
const mediaFailures=[];
let uiSequence=0;
let customerEpoch=0, suppressDialogClose=false;
// A browser tab owns one presence lease. Domain time never controls this timer.
const presenceSession = uid(), seenNotices = new Set(), pendingNotices = new Set(), shownSuggestions = new Set();
let presenceBusy = false, presenceContext = '', lastPresenceAt = 0, pageHidden = false, exposureScheduled = false;
let booting = false, bootRetry;
const joinedKey = customer => `gs-ai-live:1084192893:${customer}:joined`;
function readJoined(customer) {try{return sessionStorage.getItem(joinedKey(customer))!=='false';}catch{return true;}}
let joined = readJoined(customerId), publicCommentSignature = '', cartSignature = '';
let commentBusy = false, pendingComment = null, cartBusy = false;
let sizeProfileDraft = null, sizeProfileContext = null, sizeProfileDirty = false, sizeProfileSaveToken = null, sizeProfileSignature = null;
const cartRequests = new Map(), shownPersonalizations = new Set();

function setupShell() {
  $('[data-action="size"]').id = 'size-button';
  $('[data-action="styling"]').id = 'styling-button';
  $('.quick-action[data-action="benefit"]').id = 'benefit-button';
  $('#send-button').id = 'ask-submit'; $('#sheet').id = 'dialog'; $('#close-sheet').id = 'dialog-close';
  $('#accept-suggestion').id = 'suggestion-accept'; $('#dismiss-suggestion').id = 'suggestion-dismiss';
  $('#expand-button').id = 'orientation-toggle';
  $('.director-link').href = '/app/director.html';
  $('.price-line span').textContent = '★ 4.5 (1,200)';
  $('.viewer-count').textContent = '로컬 데모';
  $('.profile-tag').innerHTML = '<span class="badge">VIP</span><span id="profile-name">지수님</span>';
  $('.workbar').insertAdjacentHTML('afterend', `<div class="demo-toolbar"><span class="demo-label">CUSTOMER DEMO</span><label>가상 고객 <select id="customer-select"><option value="customer-A">A · 지수</option><option value="customer-B">B · 민서</option><option value="customer-C">C · 서연</option></select></label><span id="live-clock">연결 중</span><details><summary>시연 설정</summary><label>ASK 응답 <select id="ask-fault"><option value="">기본 준비 응답</option><option value="delay">5초 지연 대체</option><option value="error">응답 오류 대체</option></select></label><button id="switch-product">다른 상품으로 전환</button><button id="simulate-media-error">영상 오류 체험</button></details><a href="/app/director.html" target="_blank" rel="noopener">Director ↗</a></div>`);
  $('#customer-select').value = customerId;
  $('.primary').insertAdjacentHTML('afterbegin', `<div class="media-toolbar"><label>방송 화면 <select id="media-mode" aria-label="방송 미디어 선택"><option value="image">상품 이미지</option><option value="video">녹화 참고 영상</option></select></label><span id="media-status">상품 이미지 기반 데모</span></div>`);
  const stage = $('.video-frame'); stage.id = 'media-stage';
  $('.video-image').id = 'gallery-image';
  stage.insertAdjacentHTML('afterbegin', `<video id="live-video" controls playsinline preload="metadata" hidden aria-label="코어어센틱 가디건 녹화 참고 영상"></video><div id="image-error" class="image-error" hidden>상품 이미지를 불러오지 못했어요.<br>아래 상품 카드와 상세 정보를 확인해주세요.</div>`);
  $('.video-bottom > span').textContent = '상품 이미지 기반 데모';
  stage.insertAdjacentHTML('afterend', `<div id="video-info" class="video-info" hidden><strong>녹화 참고 영상 · 코어어센틱 가디건 · 현재 상품과 다름</strong><div class="media-controls"><button id="video-play" aria-label="영상 재생">재생</button><button id="video-mute" aria-label="음소거">음소거</button><label>음량 <input id="video-volume" aria-label="영상 음량" type="range" min="0" max="1" step="0.1" value="1"></label></div><label class="seek-label">재생 위치 <input id="video-seek" aria-label="영상 재생 위치" type="range" min="0" max="0" step="0.1" value="0"><span id="video-time">0:00 / 0:00</span></label><p>장면 검색 · 요약 · Catch-up · 영상 ASK LIVE: 검증 전 비활성</p></div><div id="media-error" class="media-error" role="status" hidden></div><div class="gallery-controls" id="gallery-controls"><button id="gallery-prev" aria-label="이전 상품 이미지">‹</button><span id="gallery-position">1 / 8</span><span id="gallery-color">그레이 · 실제 상품 이미지</span><button id="gallery-next" aria-label="다음 상품 이미지">›</button></div>`);
  $('.product-panel').insertAdjacentHTML('beforeend', '<p class="stock-caption" id="stock-caption"></p><div class="product-extra">상품 페이지 기준 · 2026.09.21</div>');
  $('.conversation-head span').innerHTML = '<i class="green-dot"></i>나의 질문은 나에게만';
  $('.purchase-button').innerHTML = icon('bag') + '구매 체험';
  setupExperience();
  for (const id of ['size-button','benefit-button','styling-button','ask-input','ask-submit','orientation-toggle','media-mode','live-video','suggestion-accept','suggestion-dismiss','dialog','dialog-close','customer-select']) $('#'+id).dataset.testid = id;
}

function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
async function get(url) { const r = await fetch(url, {cache:'no-store'}); if (!r.ok) throw new Error('서버 연결을 확인해주세요.'); return r.json(); }
function action(action, payload = {}, options = {}) {
  const requestedRun = state?.run_id, requestedCustomer = customerId, requestedEpoch=customerEpoch;
  writes++;
  const task = queue.then(async () => {
    const response = await fetch('/api/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, run_id:requestedRun, customer_id:requestedCustomer, ...payload})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했어요.');
    if (requestedCustomer === customerId && requestedEpoch===customerEpoch && state?.run_id===requestedRun) applyState(result);
    return result;
  });
  queue = task.catch(error => { if (!options.silent) toast(error.message); }).finally(() => { writes--; });
  return task;
}
function track(event_type, extra={}) {
  if(!state || state.ended)return Promise.resolve(null);
  return action('event', {event_type, event_id:uid(), ...extra}).catch(() => {});
}
function presence(force = false) {
  if (!state || !initialized || !joined || pageHidden || presenceBusy) return;
  const context = `${state.run_id}:${customerId}`;
  if (!force && context === presenceContext && Date.now()-lastPresenceAt < 5000) return;
  presenceBusy = true; lastPresenceAt = Date.now();
  action('presence', {session_id:presenceSession, status:'active'}, {silent:true})
    .then(() => { presenceContext = context; })
    .catch(() => { presenceContext = ''; })
    .finally(() => { presenceBusy = false; });
}
function leavePresence() {
  if (!state) return;
  const payload = JSON.stringify({action:'presence',run_id:state.run_id,customer_id:customerId,session_id:presenceSession,status:'leave'});
  // keepalive also works when pagehide unloads this document; a missed leave expires in 15 seconds.
  fetch('/api/action', {method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(()=>{});
  presenceContext = '';
}
function visibleOnScreen(element) {
  if (!joined || !element || element.hidden || document.visibilityState !== 'visible' || pageHidden || $('#dialog').open) return false;
  let r = element.getBoundingClientRect();
  let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
  for (let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement) {
    const style=getComputedStyle(ancestor);
    if(style.display==='none'||style.visibility==='hidden')return false;
    const clip=ancestor.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
  }
  return right>left && bottom>top;
}
function recordVisibleContent() {
  if (!state || !initialized || document.visibilityState !== 'visible') return;
  for (const element of $$('[data-notice-id]', $('#messages'))) {
    const notice_id=element.dataset.noticeId, key=`${state.run_id}:${customerId}:${notice_id}`;
    if (seenNotices.has(key)||pendingNotices.has(key)||!visibleOnScreen(element))continue;
    pendingNotices.add(key);
    action('notice_seen',{notice_id},{silent:true}).then(()=>seenNotices.add(key)).catch(()=>{}).finally(()=>pendingNotices.delete(key));
  }
  const product=state.customers.find(c=>c.id===customerId)?.current_product || data.product.product_id;
  const key=`suggestion:${state.run_id}:${customerId}:${product}`;
  if(!state.ended && state.customer.suggestion_visible && !shownSuggestions.has(key) && visibleOnScreen($('#suggestion'))) {
    shownSuggestions.add(key);
    // Stable identity lets the server deduplicate exposure across refreshes and multiple tabs.
    action('event',{event_type:'AI_SUGGESTION_SHOWN',event_id:key,need:'SIZE'},{silent:true})
      .catch(()=>shownSuggestions.delete(key));
  }
  const approval=state.campaign?.approval;
  const exposure=`personalization:${state.run_id}:${approval?.approval_id}:${customerId}`;
  if(approval && state.customer.highlight && !shownPersonalizations.has(exposure) && visibleOnScreen($('#size-button'))){
    shownPersonalizations.add(exposure);
    action('event',{event_type:'PERSONALIZATION_SHOWN',event_id:exposure,metadata:{approval_id:approval.approval_id}},{silent:true})
      .catch(()=>shownPersonalizations.delete(exposure));
  }
}
function scheduleExposure() {
  if(exposureScheduled)return;
  exposureScheduled=true;
  requestAnimationFrame(()=>{exposureScheduled=false;recordVisibleContent();});
}
function patch(patch) {
  const sequence=++uiSequence;
  for(const [key,value] of Object.entries(patch))pendingUI.set(key,{value,sequence});
  Object.assign(ui, patch); renderUI();
  return action('ui_state', {patch}).catch(() => {}).finally(()=>{for(const key of Object.keys(patch))if(pendingUI.get(key)?.sequence===sequence)pendingUI.delete(key);});
}
function applyState(next) {
  if (!next?.customer) return;
  if(next.customer.id!==customerId)return;
  const sameContext=state?.customer?.id===next.customer.id && state?.customers.find(c=>c.id===customerId)?.current_product===next.customers.find(c=>c.id===customerId)?.current_product;
  const reset = state && state.run_id !== next.run_id;
  state = next;
  if (reset) { pendingUI.clear();handledResultMessages.clear();seenNotices.clear();pendingNotices.clear();shownSuggestions.clear();shownPersonalizations.clear();cartRequests.clear();pendingComment=null;presenceContext='';if ($('#dialog').open) $('#dialog').close();if($('#share-dialog').open)$('#share-dialog').close();dialogView = null; messageSignature = '';cartSignature='';publicCommentSignature='';$('#public-comment-input').value='';$('#ask-input').value = ''; video.pause(); video.currentTime = 0; videoFailed = false; $('#media-error').hidden = true; }
  Object.assign(ui, next.customer.ui || {});
  for(const [key,item] of pendingUI)ui[key]=item.value;
  if (reset) restoreVideo();
  renderUI(); renderMessages(); renderPublicComments();
  if (dialogView === 'size' && !sizeProfileSaveToken && sizeProfileSignature !== JSON.stringify([state.customer.profile, state.customer.size_recommendation])) renderSize();
  const nextCart=JSON.stringify(next.customer.cart || []);
  if(nextCart!==cartSignature){cartSignature=nextCart;if(joined&&dialogView==='cart')renderCart();}
  if(initialized) {presence();scheduleExposure();}
  for(const message of next.customer.messages || []) {
    if(message.status==='pending'||message.actor!=='ASK_LIVE'||!['size','benefit','styling'].includes(message.route)||handledResultMessages.has(message.message_id))continue;
    handledResultMessages.add(message.message_id);
    if(joined&&initialized&&!reset&&sameContext){
      const selected=message.route;
      if(selected==='size')renderSize();else if(selected==='benefit')renderBenefit();else renderStyling();
      track(({size:'SIZE_RESULT_VIEW',benefit:'BENEFIT_RESULT_VIEW',styling:'STYLING_RESULT_VIEW'})[selected]);
    }
  }
}
function renderUI() {
  if (!data || !state) return;
  document.body.classList.toggle('landscape', ui.orientation === 'landscape');
  document.body.dataset.runId=state.run_id;
  document.body.dataset.currentCustomer=customerId;
  $$('[data-mode]').forEach(b => { const yes = b.dataset.mode === ui.orientation; b.classList.toggle('active', yes); b.setAttribute('aria-pressed', yes); });
  $('#expand-label').textContent = ui.orientation === 'landscape' ? '세로로 보기' : '확장해서 보기';
  $('#mode-description').textContent = ui.orientation === 'landscape' ? 'LANDSCAPE · 가로형 모바일' : 'PORTRAIT · 세로형 모바일';
  $('#profile-name').textContent = ({'customer-A':'지수님','customer-B':'민서님','customer-C':'서연님'})[customerId];
  $('.benefit-link span').innerHTML = '가상 VIP · GS Pay 데모 혜택가 <strong>45,515원</strong>';
  $('#live-clock').textContent = `${state.ended ? '방송 종료' : 'LIVE'} · 시연 ${Number(state.now || 0).toFixed(0)}초`;
  $('.live-tag').innerHTML = state.ended ? '방송 종료' : '<i></i>LIVE DEMO';
  $('.viewer-count').textContent = state.integration ? `가상 고객 ${state.integration.presence.online_customers}명 접속` : '로컬 데모';
  const switched = (state.customers.find(c=>c.id===customerId)?.current_product || data.product.product_id) !== data.product.product_id;
  $('#switch-product').textContent = switched ? '원래 상품으로 돌아오기' : '다른 상품으로 전환';
  $('#suggestion').hidden = !state.customer.suggestion_visible || Boolean(dialogView);
  const highlighted = Boolean(state.customer.highlight?.active ?? state.customer.highlight);
  $('#size-button').classList.toggle('recommended', highlighted);
  $('#size-button').dataset.highlight=String(highlighted);
  $('#size-button').setAttribute('aria-label', highlighted ? '내 사이즈 · PD 추천' : '내 사이즈');
  $('#size-button').innerHTML = icon('size') + '내 사이즈' + (highlighted ? '<span class="recommend-tag">추천</span>' : '');
  $$('[data-size]').forEach(b => { b.classList.toggle('active', b.dataset.size === ui.size); b.setAttribute('aria-pressed', b.dataset.size === ui.size); });
  $('#selected-caption').textContent = `${ui.color} ${ui.size} · 데모 혜택 예시`;
  const opt = selectedOption();
  $('#stock-caption').textContent = `${ui.color} ${ui.size} · ${stockLabel(opt)}`;
  const index = ((Number(ui.image_index) || 0) % data.product.images.length + data.product.images.length) % data.product.images.length;
  const img = data.product.images[index];
  if ($('#gallery-image').getAttribute('src') !== asset(img.local_path)) { $('#gallery-image').hidden = false; $('#image-error').hidden = true; $('#gallery-image').src = asset(img.local_path); $('#gallery-image').alt = img.alt; }
  $('#gallery-position').textContent = `${index+1} / ${data.product.images.length}`;
  $('#gallery-color').textContent = `${img.color_label} · 실제 상품 이미지`;
  const mode = ui.media_mode === 'video' && !videoFailed;
  $('#media-mode').value = mode ? 'video' : 'image';
  $('#media-stage').classList.toggle('playing-video', mode);
  video.hidden = !mode; $('#gallery-image').hidden = mode || !$('#image-error').hidden;
  $('#gallery-controls').hidden = mode; $('#video-info').hidden = !mode;
  $('#media-status').textContent = mode ? (video.ended?'재생 종료 · 다시 재생 가능':'9:16 · 비율 유지') : '상품 이미지 기반 데모';
  $('#ask-input').disabled = Boolean(state.ended);
  $('#ask-submit').disabled = Boolean(state.ended);
  renderExperienceUI();
  videoKnowledge?.render();
  scheduleExposure();
}
function sourceFor(m) {
  const labels = [m.label, m.fallback ? '준비 답변으로 대체' : ''].filter(Boolean);
  return labels.length ? `<p class="source-note">${esc(labels.join(' · '))}</p>` : '';
}
function inlineReviewCards(message) {
  const ids=Array.isArray(message.review_group_ids)?message.review_group_ids:[];
  const groups=ids.map(id=>data.product.review_summary.groups.find(group=>group.group_id===id)).filter(Boolean);
  return groups.length?`<div class="answer-review-cards" aria-label="구매자 선택형 리뷰 근거">${groups.map(group=>`<section class="answer-review-card" data-review-group="${esc(group.group_id)}"><h4>${esc(group.label)} · 구매자 선택형 평가</h4>${group.responses.map(response=>`<div class="review-line"><span>${esc(response.label)}</span><div class="bar"><i style="width:${response.percentage}%"></i></div><b>${response.percentage}%</b></div>`).join('')}<p class="fine-print">문항 응답 ${group.response_count_sum.toLocaleString('ko-KR')}건 · 원본 합계 ${group.percentage_sum}%</p></section>`).join('')}</div>`:'';
}
function renderMessages() {
  const messages = state.customer.messages || [];
  const signature = JSON.stringify(messages);
  if (signature === messageSignature) return;
  messageSignature = signature;
  const box = $('#messages'), nearBottom = box.scrollHeight-box.scrollTop-box.clientHeight < 70;
  box.innerHTML = messages.map(m => {
    const actor = m.actor || m.role || 'SYSTEM';
    const cls = ({CUSTOMER:'customer', OPERATOR:'op', ASK_LIVE:'ai', SYSTEM:'system'})[actor] || 'system';
    const title = ({CUSTOMER:'CUSTOMER · 나',OPERATOR:'OPERATOR · 운영자',ASK_LIVE:'ASK LIVE',SYSTEM:'SYSTEM'})[actor] || actor;
    const route = m.action?.route || (typeof m.route === 'object' ? m.route.route : m.route);
    return `<article class="message ${cls}" data-message-id="${esc(m.message_id)}"${m.notice_id?` data-notice-id="${esc(m.notice_id)}"`:''}><div class="message-label"><strong>${esc(title)}</strong>${actor==='OPERATOR'?'<span>공용</span>':actor!=='SYSTEM'?'<span>나에게만</span>':''}</div><p>${esc(m.text).replace(/\n/g,'<br>')}</p>${m.status==='pending'?'<span class="processing">준비된 정보를 확인하고 있어요…</span>':''}${m.status!=='pending'&&actor==='ASK_LIVE'?inlineReviewCards(m):''}${sourceFor(m)}${videoAnswerCard(m)}${route?`<button class="message-action" data-route="${esc(route)}">${esc(m.action?.label || '관련 정보 보기')} ${icon('chevron')}</button>`:''}</article>`;
  }).join('');
  if (nearBottom || messages.length < 4) box.scrollTop = box.scrollHeight;
  scheduleExposure();
}
function selectedOption() { return data.product.options.find(o => o.color === ui.color && o.size === ui.size); }
function stockLabel(opt) { return !opt ? '현재 옵션 응답에 없음' : opt.page_sold_out ? '확인 당시 일시품절' : '확인 당시 품절 표시 없음'; }
function sheet(title, body, footer, view) {
  if(!joined)return;
  const dialog = $('#dialog');
  if (!dialog.open) returnFocus = document.activeElement;
  dialogView = view;
  $('#sheet-title').textContent = title; $('#sheet-content').innerHTML = body; $('#sheet-footer').innerHTML = footer;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  $('#suggestion').hidden = true;
  wireImageFallbacks();
}
function closeSheet() {
  if(!$('#dialog').open)return;
  dialogView=null;$('#dialog').close();
  if(state)patch({active_result:null});
  returnFocus?.isConnected&&returnFocus.focus();renderUI();
}
function result(type, trackView = true) {
  if (!data) return;
  if (trackView) track(({size:'SIZE_RESULT_VIEW',benefit:'BENEFIT_RESULT_VIEW',styling:'STYLING_RESULT_VIEW'})[type]);
  patch({active_result:type});
  if (type === 'size') renderSize(); else if (type === 'benefit') renderBenefit(); else renderStyling();
}
const returnButton = '<button class="btn primary full" data-close>LIVE로 돌아가기</button>';
const source = () => `<a class="source" href="${esc(data.product.source_url)}" target="_blank" rel="noopener noreferrer">GS SHOP 실제 상품 보기 ↗</a>`;
function sizeContext() {
  const product = state?.customers.find(customer=>customer.id===customerId)?.current_product || data?.product.product_id;
  return `${state?.run_id}:${customerId}:${product}`;
}
function currentSizeProfile() {
  const context=sizeContext();
  if (sizeProfileContext !== context) {
    sizeProfileContext=context;sizeProfileDraft=null;sizeProfileDirty=false;sizeProfileSaveToken=null;
  }
  const saved=state?.customer?.profile || {height_cm:null,usual_size:'66',half_size:false,fit:'regular',garment_chest_cm:null};
  if (!sizeProfileDirty || !sizeProfileDraft) sizeProfileDraft={...saved};
  return sizeProfileDraft;
}
function readSizeProfile(form) {
  const optional = name => form.elements[name].value === '' ? null : Number(form.elements[name].value);
  return {height_cm:optional('height_cm'),usual_size:form.elements.usual_size.value,
    half_size:form.elements.half_size.checked,fit:form.elements.fit.value,garment_chest_cm:optional('garment_chest_cm')};
}
async function saveSizeProfile(event) {
  event.preventDefault();
  const form=event.currentTarget;
  if(!form.reportValidity() || sizeProfileSaveToken)return;
  const context=sizeContext(), epoch=customerEpoch, token=uid(), profile=readSizeProfile(form);
  sizeProfileSaveToken=token;sizeProfileDraft=profile;sizeProfileDirty=true;
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  form.querySelectorAll('input,select').forEach(input=>input.disabled=true);
  $('#size-profile-status').textContent='입력한 기준으로 사이즈를 확인하고 있어요.';
  try {
    await action('profile_update',{patch:profile});
    if(sizeContext()===context && customerEpoch===epoch && sizeProfileSaveToken===token){
      sizeProfileDirty=false;sizeProfileDraft={...state.customer.profile};
      if(dialogView==='size'){
        renderSize();
        $('#size-profile-status').textContent='내 기준을 저장했어요. 추천을 확인한 뒤 구매 옵션을 직접 선택해주세요.';
        $('#recommended-size').scrollIntoView({block:'center',behavior:'smooth'});
      }
    }
  } catch(error) {
    if(sizeContext()===context && customerEpoch===epoch && dialogView==='size')$('#size-profile-status').textContent=error.message;
  } finally {
    if(sizeProfileSaveToken===token){sizeProfileSaveToken=null;if(dialogView==='size'&&$('#size-profile-save')){$('#size-profile-save').disabled=Boolean(state.ended);$('#size-profile-form').querySelectorAll('input,select').forEach(input=>input.disabled=false);}}
  }
}
function renderSize() {
  const s = data.demo.size_result, profile=currentSizeProfile();
  const recommendation=state.customer.size_recommendation || {recommended_size:s.recommended_size,label:'평소 사이즈 기준 안내',reasons:['평소 사이즈를 기준으로 실제 의류 실측을 함께 확인해주세요.'],measurements:{}};
  const recommended=recommendation.recommended_size;
  const name=({'customer-A':'지수','customer-B':'민서','customer-C':'서연'})[customerId];
  const group=data.product.review_summary.groups.find(g=>g.group_id==='size');
  const fit=group.responses.find(r=>r.label==='잘 맞아요');
  const measurements=Object.entries(recommendation.measurements || {});
  sizeProfileSignature=JSON.stringify([state.customer.profile,state.customer.size_recommendation]);
  sheet('내 사이즈', `<div class="sheet-body"><div class="sheet-kicker">${icon('size')}입력한 기준 · 실제 상품 실측 비교</div><h2>${esc(name)}님의<br>사이즈 선택을 도와드려요.</h2><p class="sheet-intro">${esc(recommendation.label)}</p><div class="size-hero"><span id="recommended-size" class="size-num" data-recommended-size="${esc(recommended || '')}">${esc(recommended || '—')}</span><p><strong>${recommended?'먼저 확인할 사이즈':'실측 확인이 필요해요'}</strong>추천과 현재 구매 옵션은 별개예요.<br>저장만으로 구매 옵션을 바꾸지 않아요.</p></div><ul class="size-recommendation-reasons" id="size-recommendation-reasons">${(recommendation.reasons || []).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>${recommendation.unavailable_reason?`<p class="stock-notice">${esc(recommendation.unavailable_reason)}</p>`:''}<fieldset class="option-field size-result-options"><legend>구매할 사이즈 선택${recommended?' · 추천은 '+esc(recommended):' · 실측을 비교해주세요'}</legend>${data.product.sizes.map(size=>`<button class="option-button ${ui.size===size?'active':''}" data-size="${esc(size)}" aria-pressed="${ui.size===size}">${esc(size)}${size===recommended?'<small>추천</small>':''}</button>`).join('')}</fieldset><p id="size-result-selection" class="fine-print">현재 선택 ${esc(ui.color)} ${esc(ui.size)} · ${stockLabel(selectedOption())}</p>
  <section class="prepared-profile" aria-label="내 사이즈 선택 기준"><h3>내 기준을 입력해주세요</h3><p class="fine-print">입력값과 추천은 내 고객 화면에만 표시돼요. 키만으로 사이즈를 결정하지 않아요.</p><form id="size-profile-form" class="size-profile-form"><label>키 (선택, cm)<input id="size-profile-height" name="height_cm" type="number" inputmode="decimal" min="140" max="200" step="0.1" value="${esc(profile.height_cm ?? '')}" placeholder="예: 165"></label><label>평소 상의 사이즈<select id="size-profile-usual" name="usual_size">${data.product.sizes.map(size=>`<option value="${esc(size)}" ${profile.usual_size===size?'selected':''}>${esc(size)}</option>`).join('')}</select></label><label class="size-profile-half"><input id="size-profile-half" name="half_size" type="checkbox" ${profile.half_size?'checked':''}>평소 반사이즈에 걸쳐 입어요</label><label>선호하는 여유감<select id="size-profile-fit" name="fit"><option value="regular" ${profile.fit==='regular'?'selected':''}>기본 핏</option><option value="relaxed" ${profile.fit==='relaxed'?'selected':''}>여유 있는 핏</option></select></label><label class="size-profile-garment">잘 맞는 보유 상의 가슴단면 (선택, cm)<input id="size-profile-garment" name="garment_chest_cm" type="number" inputmode="decimal" min="30" max="80" step="0.1" value="${esc(profile.garment_chest_cm ?? '')}" placeholder="예: 45"><span class="fine-print">옷을 평평하게 놓고 잰 한쪽 가슴 너비예요. 신체 가슴둘레를 입력하지 마세요.</span></label><button id="size-profile-save" class="btn primary full" type="submit" ${sizeProfileSaveToken||state.ended?'disabled':''}>내 기준 저장 · 추천 확인</button><p id="size-profile-status" class="fine-print" role="status"></p></form></section>
  ${measurements.length?`<section class="size-measurement-card"><h3>${esc(recommended)} 사이즈 실제 의류 실측</h3><dl>${measurements.map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(value)} cm</dd></div>`).join('')}</dl><p class="fine-print">상품 페이지 실측표 기준 · 신체 치수가 아니에요.</p></section>`:''}
  <section class="size-review-evidence" data-provenance="actual_snapshot"><div class="between"><h3>구매자들이 남긴 사이즈 평가</h3><span class="badge mint">리뷰 집계</span></div><div class="data-row"><span>구매후기 ‘잘 맞아요’</span><strong>${fit.percentage}%</strong></div><div class="review-meter"><i style="width:${fit.percentage}%"></i></div><p>${fit.response_count.toLocaleString('ko-KR')}개 응답이 ‘잘 맞아요’를 선택했어요.</p><p class="fine-print">상품 전체 사이즈 리뷰 · 문항 응답 ${group.response_count_sum.toLocaleString('ko-KR')}건</p><p class="fine-print">전체 상품 리뷰 집계이며 비슷한 체형 고객의 만족률이 아니에요.</p><button class="message-action" data-detail="reviews">전체 리뷰 보기 ${icon('chevron')}</button></section><div class="note">${esc(s.guidance_text)}</div><div class="stock-notice">${esc(s.stock_note)}</div><p class="fine-print">실측과 선택 기준을 비교하는 규칙 기반 안내예요. 착용감이나 구매 가능한 재고를 보장하지 않아요.</p></div>`, `<button class="btn primary full" data-detail="size">실제 사이즈표 확인하기</button><button class="btn outline full" id="size-purchase">${esc(ui.size)} 선택 · 구매 시뮬레이션</button>`, 'size');
  const form=$('#size-profile-form');
  form.onsubmit=saveSizeProfile;
  const remember=()=>{sizeProfileDraft=readSizeProfile(form);sizeProfileDirty=true;};
  form.addEventListener('input',remember);form.addEventListener('change',remember);
}

function renderBenefit() {
  const b = data.demo.benefit_result;
  const conditions=data.experience?.benefit_conditions || [];
  sheet('내 혜택', `<div class="sheet-body"><div class="sheet-kicker">${icon('ticket')}${esc(b.label)} · 가상 VIP / GS Pay</div><h2>혜택까지,<br>꼼꼼하게 챙겼어요.</h2><div class="benefit-hero"><p>예시 최종 혜택가</p><strong>${Number(b.final_price_krw).toLocaleString('ko-KR')}<small>원</small></strong><span class="savings">총 ${won(b.total_discount_krw)} 할인</span></div><div class="data-row"><span>판매가</span><strong>${won(b.base_price_krw)}</strong></div>${b.discounts.map(d=>`<div class="data-row discount"><span>${esc(d.label)}</span><strong>−${won(d.amount_krw)}</strong></div>`).join('')}<div class="data-row"><span>배송비</span><strong>무료배송</strong></div><div class="data-row total"><span>예시 최종 혜택가</span><strong>${won(b.final_price_krw)}</strong></div><p class="calculation">49,900 − 2,495 − 1,890 = 45,515원</p><div class="note">${esc(b.note)}</div><section class="benefit-conditions"><h3>추가 혜택 · 적용 조건</h3><p class="fine-print">아래 안내를 새로운 할인이나 적립으로 합산하지 않아요.</p>${conditions.map(item=>`<article class="benefit-condition" data-benefit-condition="${esc(item.id)}">${icon(item.icon)}<div><h4>${esc(item.title)}</h4><span class="benefit-condition-label">${esc(item.label)}</span><p>${esc(item.description)}</p>${item.route==='product'?source():`<button class="message-action" data-route="${esc(item.route)}">배송 안내 보기 ${icon('chevron')}</button>`}</div></article>`).join('')}</section></div>`, '<button class="btn primary full" data-purchase>옵션 확인 · 구매 시뮬레이션</button>', 'benefit');
}
function renderStyling() {
  const looks = data.looks.looks, look = looks.find(l=>l.look_id===ui.look) || looks[0];
  const cards = [look.bottom_product_id, look.shoes_product_id].map(id=>data.candidates.products.find(p=>p.product_id===id)).filter(Boolean);
  sheet('코디 추천', `<div class="sheet-body"><div class="sheet-kicker">${icon('hanger')}가상 고객 취향으로 준비한 세 가지 코디</div><div class="look-tabs" aria-label="코디 선택">${looks.map((l,i)=>`<button data-look="${l.look_id}" aria-pressed="${l.look_id===look.look_id}" class="${l.look_id===look.look_id?'active':''}">${['오피스','데이트','편안한 일상'][i]}</button>`).join('')}</div><div class="look-gallery"><div class="look-image"><img src="${asset(look.static_lookbook_image)}" alt="${esc(look.mood_name)} AI 코디 예시"><span class="badge">AI 코디 예시</span></div><div class="look-thumbnails" aria-label="코디 이미지로 선택">${looks.map((item,i)=>`<button data-look="${item.look_id}" class="look-thumbnail ${item.look_id===look.look_id?'active':''}" aria-pressed="${item.look_id===look.look_id}" aria-label="LOOK ${i+1} ${esc(item.mood_name)} 이미지 선택"><img src="${asset(item.static_lookbook_image)}" alt="${esc(item.mood_name)} AI 코디 썸네일"><span>LOOK 0${i+1}</span></button>`).join('')}</div></div><div class="look-description"><h3>${esc(look.mood_name)}</h3><p>${esc(look.reason)}</p></div><p class="fine-print">AI 코디 이미지는 분위기 예시로 실제 상품과 다를 수 있어요.</p><h3 class="actual-products-title">실제 상품으로 살펴보기</h3><div class="look-items"><article class="look-item"><img src="${asset(data.product.images[4].local_path)}" alt="실제 SJ와니 그레이 풀오버"><div><strong>${esc(data.product.display_name)}</strong><p>그레이 · ${won(data.product.price.sale_price_krw)}</p><p>확인 당시 그레이 66 일시품절</p></div>${source()}</article>${cards.map(p=>`<article class="look-item"><img src="${asset(p.image)}" alt="${esc(p.product_name)} 실제 상품 이미지"><div><strong>${esc(p.product_name)}</strong><p>${esc(p.color)} · ${won(p.price)} · 확인 당시 가격</p><p>하의·신발 사이즈는 별도로 확인해주세요.</p></div><a href="${esc(p.product_url)}" target="_blank" rel="noopener noreferrer" data-product-link="${esc(p.product_id)}">상품 상세 보기 ↗</a></article>`).join('')}</div><div class="note">스타일 설명은 데모 편집 정보입니다. 재고와 적용 혜택은 각 상품 페이지에서 확인해주세요. 메인 상의 사이즈를 하의·신발에 적용하지 않습니다.</div></div>`, '<button class="btn primary full" id="styling-all-button">전체 코디 상품 보기 '+icon('chevron')+'</button>'+returnButton, 'styling');
}
function reviewGroup(g) { return `<section class="review-group" id="review-${g.group_id}"><strong>${esc(g.label)}</strong>${g.responses.map(r=>`<div class="review-line"><span>${esc(r.label)}</span><div class="bar"><i style="width:${r.percentage}%"></i></div><b>${r.percentage}%</b></div>`).join('')}<p class="fine-print">문항 응답 ${g.response_count_sum.toLocaleString('ko-KR')}건 · 원본 비율 합계 ${g.percentage_sum}%</p></section>`; }
function detail(tab = 'description', emit = true) {
  if (tab === 'questions') tab = 'inquiry';
  dialogTab = tab; patch({active_result:'detail'});
  if (emit) { track('PRODUCT_DETAIL_OPEN', {metadata:{tab}}); if (tab==='size') track('SIZE_TAB_OPEN'); if (tab==='reviews') {track('REVIEW_VIEW');track('REVIEW_SIZE_VIEW');} if(tab==='inquiry')track('PRODUCT_INQUIRY_CLICK'); }
  const p = data.product;
  let content;
  if (tab === 'size') content = `<h3>실제 상품 실측표</h3><p>의류 치수 · 단위 cm · 신체 치수가 아닙니다.</p><div class="table-wrap"><table class="detail-table size-table"><thead><tr><th>실측 항목</th>${p.size_guide.sizes.map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>${p.size_guide.rows.map(r=>`<tr><th>${esc(r.measurement)}</th>${r.values.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="note">${esc(p.size_guide.half_size_guidance)}</div><button class="btn soft full" id="size-reviews">사이즈 리뷰 확인하기 ${icon('chevron')}</button><p class="fine-print">상품 상세 실측표 기준 · 2026.09.21</p><a class="source" href="${p.links.size_chart_image}" target="_blank" rel="noopener">원본 실측표 이미지 ↗</a>`;
  else if (tab === 'reviews') content = `<div class="between"><h3>구매 고객의 이야기</h3><span class="badge mint">★ 4.5 · 리뷰 1,200건</span></div>${[...p.review_summary.groups].sort((a,b)=>(a.group_id==='size'?-1:b.group_id==='size'?1:0)).map(reviewGroup).join('')}<div class="note">전체 리뷰는 1,200건, 각 선택형 문항의 응답 합계는 1,202건입니다. 원본 비율 합계가 99%인 문항도 그대로 표시합니다. 별도 이전 조회의 1,199건은 이번 채택 스냅샷과 구분합니다.</div><p class="fine-print">${p.review_summary.display_label}</p>`;
  else if (tab === 'inquiry') content = `<h3>상품에 대해 궁금하신가요?</h3><p>상품후기·두께·색상·배송을 ASK LIVE에서 물어보세요.</p><div class="note">실제 상품문의 등록은 GS SHOP 상품 페이지에서 진행해주세요. 영상은 확인한 화면 자막·장면만 안내하며, 착용 사이즈나 미확인 발화는 추측하지 않습니다.</div><button id="return-ask" class="btn soft full">ASK LIVE로 질문하기</button>${source()}`;
  else if (tab === 'delivery') content = `<span class="badge mint">배송 시뮬레이션</span><h3>준비된 배송 안내</h3><p>${esc(data.demo.delivery_result.answer)}</p><div class="note">실제 도착일은 확인되지 않았어요. 상품 페이지의 무료배송 표시와 데모 도착 예상을 구분해주세요.</div>${source()}`;
  else content = `<img class="detail-image" src="${asset(p.images[Number(ui.image_index)||0].local_path)}" alt="${esc(p.display_name)} 실제 상품 이미지"><h3>${esc(p.display_name)}</h3><table class="detail-table"><tr><th>상품번호</th><td>${p.product_id}</td></tr><tr><th>판매가</th><td>${won(p.price.sale_price_krw)}</td></tr><tr><th>소재</th><td>${p.material.composition.map(c=>`${esc(c.fiber)} ${c.percentage}%`).join(' · ')}</td></tr><tr><th>세탁</th><td>${esc(p.material.care)}</td></tr><tr><th>사이즈</th><td>${p.sizes.join(' / ')}</td></tr><tr><th>배송</th><td>무료배송 · 도착일 주문 단계 확인</td></tr></table><div class="note">제조사 두께 가이드는 ‘약간 두꺼움’, 구매자 리뷰의 63%는 ‘얇아요’입니다. 서로 다른 근거로 구분해 확인해주세요.</div><p class="fine-print">${esc(p.snapshot_label)} · 실행 중 가격·재고를 조회하지 않습니다.</p>${source()}`;
  sheet('상품상세', `<nav class="detail-tabs" aria-label="상품상세 탭">${[['description','상세설명'],['size','사이즈'],['reviews','리뷰'],['inquiry','상품문의']].map(([t,l])=>`<button data-detail="${t}" class="${t===tab?'active':''}" aria-current="${t===tab?'page':'false'}">${l}</button>`).join('')}</nav><div class="sheet-body detail-panel">${content}</div>`, returnButton, 'detail');
}
function optionControls() { return `<fieldset class="option-field"><legend>색상</legend>${data.product.colors.map(c=>`<button data-color="${esc(c.label)}" class="option-button ${ui.color===c.label?'active':''}" aria-pressed="${ui.color===c.label}">${esc(c.label)}${!c.present_in_current_option_response?'<small>옵션 없음</small>':''}</button>`).join('')}</fieldset><fieldset class="option-field"><legend>사이즈</legend>${data.product.sizes.map(s=>`<button data-purchase-size="${s}" class="option-button ${ui.size===s?'active':''}" aria-pressed="${ui.size===s}">${s}</button>`).join('')}</fieldset>`; }
function purchase(emit = true) {
  if (emit) track('PURCHASE_CLICK');
  patch({active_result:'purchase',...(emit?{purchase_quantity:1}:{})});
  const opt = selectedOption();
  const quantity=Number(ui.purchase_quantity)||1,price=data.demo.benefit_result.final_price_krw;
  sheet('구매 정보 확인', `<div class="sheet-body"><span class="badge mint">구매 시뮬레이션 · 실제 주문 없음</span><div class="purchase-summary"><img src="${asset(data.product.images[4].local_path)}" alt="SJ와니 풀오버"><div><strong>${esc(data.product.display_name)}</strong><p>${esc(ui.color)} / ${esc(ui.size)} · ${quantity}개</p></div></div>${optionControls()}<div class="stock-notice">${esc(ui.color)} ${esc(ui.size)}: ${stockLabel(opt)}<br><small>2026.09.21 상품 페이지 스냅샷 · 현재 주문 가능 여부는 실제 상품 페이지에서 확인해주세요.</small></div><div class="data-row"><span>혜택 조건</span><strong>가상 VIP · GS Pay</strong></div><div class="data-row"><span>체험 수량</span><strong>${quantity}개</strong></div><div class="data-row total"><span>데모 혜택 예시${quantity>1?' 합계':''}</span><strong>${won(price*quantity)}</strong></div><p class="fine-print">개당 49,900 − 2,495 − 1,890 = 45,515원${quantity>1?` · ${quantity}개 ${won(price*quantity)}`:''}</p><div class="note">이 화면은 옵션 선택 체험입니다. 실제 주문·결제·배송은 발생하지 않습니다.${!opt?' 현재 옵션 응답에 없는 색상은 구매 가능한 옵션이 아닙니다.':''}</div>${source()}</div>`, `<button class="btn primary full" id="demo-order">선택 체험 완료 · 실제 주문 없음</button><button class="btn outline full" id="purchase-cart-add" ${!opt||opt.page_sold_out||state.ended?'disabled':''}>${quantity}개 장바구니에 담기</button>${!opt||opt.page_sold_out?'<p class="fine-print">확인 당시 일시품절 또는 없는 옵션은 장바구니에 담을 수 없어요.</p>':''}<button class="btn text full" data-close>LIVE로 돌아가기</button>`, 'purchase');
}
function renderComplete() {
  const quantity=Number(ui.purchase_quantity)||1;
  sheet('구매 체험 완료','<div class="sheet-body order-complete"><div class="success-icon">'+icon('check')+'</div><h2>상품 선택을 체험했어요.</h2><p>'+esc(ui.color)+' / '+esc(ui.size)+' · '+quantity+'개 · 데모 혜택가 '+won(data.demo.benefit_result.final_price_krw*quantity)+'<br>실제 주문·결제·배송은 발생하지 않았습니다.</p></div>',returnButton,'complete');
}
async function completePurchase(button) {
  const context={run:state?.run_id,customer:customerId,epoch:customerEpoch};
  button.disabled=true;
  try {
    await action('event',{event_type:'PURCHASE_DEMO_COMPLETE',event_id:uid()});
    if(state?.run_id===context.run&&customerId===context.customer&&customerEpoch===context.epoch&&dialogView==='purchase') {
      patch({active_result:'complete'});renderComplete();
    }
  }catch{}finally{if(button.isConnected)button.disabled=false;}
}
function guide(persist = true) { if(persist)patch({active_result:'guide'});sheet('GS AI LIVE 체험 안내', '<div class="sheet-body"><span class="badge mint">Prototype Simulation</span><h2>LIVE 안에서,<br>나에게 필요한 답을 찾아요.</h2><ol class="help-list"><li><strong>ASK LIVE와 빠른 결과</strong><br>후기·두께·색상·배송을 질문하고 내 사이즈·코디·혜택을 확인하세요.</li><li><strong>개인 사이즈 제안</strong><br>30초 안에 사이즈표와 사이즈 리뷰를 확인하면 제안이 나타납니다. 확인하기를 누르기 전에는 결과가 열리지 않아요.</li><li><strong>Director와 같은 방송</strong><br>PD가 APP 제안을 승인하면 관련 고객의 기존 내 사이즈 버튼에 추천 표시가 나타납니다.</li><li><strong>녹화 참고 영상</strong><br>코어어센틱 가디건 영상은 현재 SJ와니 상품과 다릅니다. 확인한 화면 자막과 장면을 질문하고 해당 위치로 이동할 수 있어요. 상품 설명 샘플은 제작 대본 기반으로 따로 표시합니다.</li></ol><div class="note">실제 상품·리뷰는 2026.09.21 스냅샷입니다. 고객 프로필·혜택·배송·성과는 데모 예시입니다. 위 시연 도구와 Director에서 고객 전환·초기화·시나리오를 제어할 수 있어요.</div></div>', returnButton, 'guide'); }
function route(value) {
  const r = String(value || '');
  if(r==='styling_all')openStylingAll();
  else if(r==='cart')openCart();
  else if (r==='detail')detail();
  else if (r.includes('product_detail.')) detail(r.split('.').pop());
  else if(r==='product_inquiry')detail('inquiry');
  else if (r.includes('size')) result('size'); else if (r.includes('benefit')) result('benefit'); else if (r.includes('styling')) result('styling'); else if (r.includes('purchase')) purchase();
}

function setupExperience() {
  $('#media-stage').insertAdjacentHTML('beforeend',`<div class="live-tools" aria-label="방송 도구"><button id="share-button" aria-label="상품 링크 공유" title="상품 링크 공유"><svg class="icon" viewBox="0 0 24 24"><path d="M12 16V3m-5 5 5-5 5 5M5 12v9h14v-9"/></svg></button><button id="cart-button" aria-label="장바구니" title="장바구니">${icon('bag')}<span id="cart-count">0</span></button><button id="live-exit" aria-label="이 탭에서 LIVE 나가기" title="LIVE 나가기">${icon('close')}</button></div><div class="public-comment-overlay" id="public-comment-overlay" aria-label="방송 공개 댓글" hidden></div>`);
  $('#gallery-controls').insertAdjacentHTML('afterend',`<details class="public-comments"><summary>공개 댓글 <span id="public-comment-count">0</span><span class="public-tag">모두에게 공개</span></summary><p id="public-comment-policy">이 로컬 LIVE의 고객과 Director에게 공개됩니다. 개인 ASK 질문과 별개예요.</p><form id="public-comment-form"><label class="sr-only" for="public-comment-input">모두에게 공개할 댓글</label><input id="public-comment-input" maxlength="300" autocomplete="off" placeholder="모두에게 보이는 댓글을 남겨주세요"><button id="public-comment-submit" type="submit">게시</button></form><p id="public-comment-status" role="status"></p></details>`);
  $('.product-panel').insertAdjacentHTML('beforeend','<div class="live-cart-actions"><button id="live-cart-add" class="btn outline">선택 옵션 담기</button><button class="btn text" data-purchase>옵션 변경</button></div>');
  $('.work-stage').insertAdjacentHTML('beforeend',`<section class="live-landing" id="live-landing" hidden tabindex="-1"><span class="badge mint">GS AI LIVE</span><h1>잠시 LIVE에서 나왔어요.</h1><p>이 탭의 시청만 종료했습니다.<br>저장한 옵션과 장바구니는 그대로예요.</p><button class="btn primary full" id="live-rejoin">LIVE 다시 들어가기</button><a href="/app/director.html" target="_blank" rel="noopener">Director에서 방송 확인하기 ↗</a></section>`);
  document.body.insertAdjacentHTML('beforeend',`<dialog id="share-dialog" aria-labelledby="share-title"><header class="sheet-header"><h2 id="share-title">상품 링크 공유</h2><button class="icon-button" id="share-close" aria-label="공유 닫기">${icon('close')}</button></header><div class="sheet-body"><p>상품의 공개 링크만 복사합니다. 내 질문·선택·장바구니는 링크에 포함되지 않아요.</p><label for="share-url">GS SHOP 상품 링크</label><input id="share-url" readonly><p id="share-status" role="status">복사한 링크를 원하는 곳에 직접 붙여넣으세요.</p><p id="share-fallback" hidden>자동 복사를 사용할 수 없어요. 선택된 주소를 길게 누르거나 Ctrl/Cmd+C로 복사해주세요.</p></div><footer class="sheet-footer"><button class="btn primary full" id="share-copy">링크 복사</button></footer></dialog>`);
  $('#share-button').onclick=openShare;
  $('#share-close').onclick=()=>{$('#share-dialog').close();$('#share-button').focus();};
  $('#share-copy').onclick=copyShare;
  $('#share-url').addEventListener('copy',()=>{track('SHARE_COPY');$('#share-status').textContent='선택한 상품 링크를 복사했어요.';});
  $('#cart-button').onclick=()=>openCart();
  $('#live-cart-add').onclick=()=>addToCart(1);
  $('#live-exit').onclick=exitLive;
  $('#live-rejoin').onclick=rejoinLive;
  $('#public-comment-form').onsubmit=publishComment;
}
function renderExperienceUI() {
  document.body.dataset.joined=String(joined);
  $('.device').hidden=!joined;$('#live-landing').hidden=joined;
  $('#cart-count').textContent=(state.customer.cart || []).reduce((sum,item)=>sum+item.quantity,0);
  const option=selectedOption();
  $('#live-cart-add').disabled=cartBusy||state.ended||!option||option.page_sold_out;
  $('#live-cart-add').title=!option||option.page_sold_out?'옵션 변경에서 확인 당시 품절 표시가 없는 옵션을 선택해주세요.':'선택한 옵션을 체험 장바구니에 담기';
  $('#public-comment-input').disabled=state.ended||commentBusy||!joined;
  $('#public-comment-submit').disabled=state.ended||commentBusy||!joined;
  if($('#size-result-selection'))$('#size-result-selection').textContent=`현재 선택 ${ui.color} ${ui.size} · ${stockLabel(option)}`;
  if($('#size-purchase'))$('#size-purchase').textContent=`${ui.size} 선택 · 구매 시뮬레이션`;
  if(data.experience?.public_comments?.notice)$('#public-comment-policy').textContent=data.experience.public_comments.notice;
}
function openShare() {
  $('#share-url').value=data.product.source_url;
  $('#share-status').textContent='복사한 링크를 원하는 곳에 직접 붙여넣으세요.';$('#share-fallback').hidden=true;
  $('#share-dialog').showModal();
}
async function copyShare() {
  $('#share-copy').disabled=true;
  try {
    await navigator.clipboard.writeText($('#share-url').value);
    $('#share-status').textContent='상품 링크를 복사했어요.';$('#share-fallback').hidden=true;track('SHARE_COPY');
  }catch {
    $('#share-status').textContent='직접 복사할 수 있도록 주소를 선택했어요.';$('#share-fallback').hidden=false;
    $('#share-url').focus();$('#share-url').select();
  }finally{$('#share-copy').disabled=false;}
}
function exitLive() {
  joined=false;try{sessionStorage.setItem(joinedKey(customerId),'false');}catch{}
  // Queue leave after any in-flight heartbeat so it cannot renew this tab after departure.
  if(state)action('presence',{session_id:presenceSession,status:'leave'},{silent:true}).catch(()=>leavePresence());
  video.pause();if($('#dialog').open)$('#dialog').close();if($('#share-dialog').open)$('#share-dialog').close();dialogView=null;
  renderUI();$('#live-landing').focus();
}
async function rejoinLive() {
  joined=true;try{sessionStorage.removeItem(joinedKey(customerId));}catch{}
  presenceContext='';renderUI();presence(true);
  try{await refreshCustomer();}catch{}
  restoreSavedView();restoreVideo();$('#live-exit').focus();
}
async function refreshCustomer() {
  const context={customer:customerId,epoch:customerEpoch};
  const next=await get('/api/state?customer_id='+encodeURIComponent(customerId));
  if(context.customer===customerId&&context.epoch===customerEpoch)applyState(next);
}
function renderPublicComments() {
  const comments=state.integration?.comments || [],total=state.integration?.monitor?.comments?.total ?? comments.length,signature=JSON.stringify([total,comments]);
  if(signature===publicCommentSignature)return;publicCommentSignature=signature;
  $('#public-comment-count').textContent=total;
  $('#public-comment-overlay').hidden=comments.length===0;
  $('#public-comment-overlay').innerHTML='<span class="public-overlay-label">공개 댓글</span>'+comments.slice(-3).map(comment=>`<p data-public-comment-id="${esc(comment.comment_id)}"><strong>고객 ${esc(comment.customer_id?.split('-').pop() || '')}</strong> ${esc(comment.text)}</p>`).join('');
}
async function publishComment(event) {
  event.preventDefault();const input=$('#public-comment-input'),text=input.value.trim();
  if(!text||!state||state.ended||!joined||commentBusy)return;
  const context={run:state.run_id,customer:customerId,epoch:customerEpoch};
  const fingerprint=JSON.stringify([context.run,context.customer,text]);
  if(pendingComment?.fingerprint!==fingerprint)pendingComment={fingerprint,comment_id:uid()};
  const submitted=pendingComment;commentBusy=true;renderUI();$('#public-comment-status').textContent='공개 댓글을 게시하고 있어요.';
  try {
    await action('comment_publish',{comment_id:submitted.comment_id,text});
    if(sameContext(context)){input.value='';pendingComment=null;$('#public-comment-status').textContent='공개 댓글을 게시했어요. 모든 고객과 Director에 표시됩니다.';}
  }catch{if(sameContext(context))$('#public-comment-status').textContent='게시 결과를 확인하지 못했어요. 같은 댓글로 다시 시도하면 중복 게시되지 않아요.';}
  finally{commentBusy=false;renderUI();}
}
function sameContext(context) {return state?.run_id===context.run&&customerId===context.customer&&customerEpoch===context.epoch;}
async function cartMutation(kind,fields) {
  if(cartBusy||!state)return null;
  const context={run:state.run_id,customer:customerId,epoch:customerEpoch};
  const fingerprint=JSON.stringify([kind,context.run,context.customer,fields]);
  if(!cartRequests.has(fingerprint))cartRequests.set(fingerprint,uid());
  cartBusy=true;renderUI();$$('[data-cart-quantity],[data-cart-remove],[data-cart-checkout],#purchase-cart-add').forEach(button=>button.disabled=true);
  try {
    const next=await action(kind,{...fields,...(kind==='cart_checkout'?{}:{request_id:cartRequests.get(fingerprint)})});
    cartRequests.delete(fingerprint);return sameContext(context)?next:null;
  }catch{return null;}
  finally{cartBusy=false;renderUI();if(dialogView==='cart')renderCart();if($('#purchase-cart-add'))$('#purchase-cart-add').disabled=state.ended||!selectedOption()||selectedOption().page_sold_out;}
}
async function addToCart(quantity) {
  const next=await cartMutation('cart_add',{color:ui.color,size:ui.size,quantity});
  if(next)toast('선택한 옵션을 내 체험 장바구니에 담았어요.');
}
function openCart(emit=true) {if(emit)track('CART_OPEN');patch({active_result:'cart'});renderCart();}
function renderCart() {
  const items=state.customer.cart || [],total=items.reduce((sum,item)=>sum+item.quantity*item.unit_price_krw,0);
  const max=data.experience?.cart?.max_quantity || 10;
  sheet('내 장바구니',`<div class="sheet-body"><span class="badge mint">가상 고객 ${esc(customerId.slice(-1))} · 체험 장바구니</span><p class="sheet-intro">${esc(data.experience?.cart?.note || '실제 주문·결제는 발생하지 않습니다.')}</p><div class="cart-items">${items.length?items.map(item=>`<article class="cart-item" data-cart-item="${esc(item.item_id)}"><img src="${asset(data.product.images[4].local_path)}" alt="실제 방송 상품"><div class="cart-item-detail"><strong>${esc(data.product.display_name)}</strong><p>${esc(item.color)} / ${esc(item.size)}</p><p>${won(item.unit_price_krw)} · 개당 상품가</p><div class="cart-quantity"><button data-cart-quantity="${item.quantity-1}" data-cart-item-id="${esc(item.item_id)}" aria-label="${esc(item.color)} ${esc(item.size)} 수량 줄이기" ${cartBusy||state.ended||item.quantity<=1?'disabled':''}>−</button><output aria-label="수량">${item.quantity}</output><button data-cart-quantity="${item.quantity+1}" data-cart-item-id="${esc(item.item_id)}" aria-label="${esc(item.color)} ${esc(item.size)} 수량 늘리기" ${cartBusy||state.ended||item.quantity>=max?'disabled':''}>+</button><button class="cart-remove" data-cart-remove="${esc(item.item_id)}" ${cartBusy||state.ended?'disabled':''}>삭제</button></div><div class="between"><strong>${won(item.quantity*item.unit_price_krw)}</strong><button class="btn soft" data-cart-checkout="${esc(item.item_id)}" ${cartBusy||state.ended?'disabled':''}>이 상품 구매 체험</button></div></div></article>`).join(''):'<div class="cart-empty"><p>아직 담은 상품이 없어요.</p><p>옵션을 선택하고 장바구니에 담아보세요.</p></div>'}</div><div class="data-row total"><span>상품가 기준 합계</span><strong id="cart-total">${won(total)}</strong></div><p class="fine-print">개인 혜택 적용 전 · 옵션당 최대 ${max}개 · 구매 체험에서 준비된 혜택가를 확인하세요.</p></div>`, '<button class="btn primary full" data-purchase>상품 옵션 선택하기</button>'+returnButton,'cart');
}
async function checkoutCart(itemId) {
  const next=await cartMutation('cart_checkout',{item_id:itemId});
  if(next){Object.assign(ui,next.customer.ui);purchase(false);}
}
function openStylingAll(emit=true) {if(emit)track('STYLING_ALL_OPEN');patch({active_result:'styling_all'});renderStylingAll();}
function renderStylingAll() {
  const ids=[...new Set(data.looks.looks.flatMap(look=>[look.top_product_id,look.bottom_product_id,look.shoes_product_id]))];
  const products=ids.map(id=>id===data.product.product_id?{product_id:id,product_name:data.product.display_name,image:data.product.images[4].local_path,price:data.product.price.sale_price_krw,product_url:data.product.source_url,category:'TOP'}:data.candidates.products.find(product=>product.product_id===id)).filter(Boolean);
  sheet('전체 코디 상품',`<div class="sheet-body"><div class="sheet-kicker">${icon('hanger')}확정 코디 3개 · 중복을 제외한 실제 상품 ${products.length}개</div><p class="sheet-intro">AI 코디 이미지와 별도로 실제 상품을 확인하세요. 가격은 확인 당시 스냅샷입니다.</p><div class="styling-all-grid">${products.map(product=>`<article class="styling-all-item" data-styling-sku="${esc(product.product_id)}"><img src="${asset(product.image)}" alt="${esc(product.product_name)} 실제 상품 이미지"><div><span class="badge mint">${{TOP:'방송 상의',BOTTOM:'하의',SHOES:'신발'}[product.category]}</span><h3>${esc(product.product_name)}</h3><p>${won(product.price)} · 확인 당시 가격</p><p class="fine-print">${data.looks.looks.filter(look=>[look.top_product_id,look.bottom_product_id,look.shoes_product_id].includes(product.product_id)).map(look=>look.look_id.replace('_',' ')).join(' · ')}</p><a class="source" href="${esc(product.product_url)}" target="_blank" rel="noopener noreferrer" ${product.category==='TOP'?'':`data-product-link="${esc(product.product_id)}"`}>실제 상품 상세 보기 ↗</a></div></article>`).join('')}</div><div class="note">확인 당시 그레이 66은 일시품절입니다. 현재 재고·혜택은 각 상품에서 확인해주세요. 상의 추천 사이즈를 하의·신발에 적용하지 않습니다.</div></div>`,'<button class="btn primary full" id="styling-back">코디 이미지로 돌아가기</button>'+returnButton,'styling_all');
}
function restoreSavedView() {
  if(!joined)return;
  const saved=ui.active_result;
  if(saved==='size')renderSize();else if(saved==='benefit')renderBenefit();else if(saved==='styling')renderStyling();
  else if(saved==='purchase')purchase(false);else if(saved==='detail')detail('description',false);else if(saved==='guide')guide(false);else if(saved==='complete')renderComplete();
  else if(saved==='cart')renderCart();else if(saved==='styling_all')renderStylingAll();
}
async function ask(text) {
  text = text.trim(); if (!text || !state || state.ended) return;
  if (ui.media_mode === 'video') saveVideo(true);
  $('#ask-input').value = '';
  const request_id = uid(), requestedRun = state.run_id, requestedCustomer = customerId;
  try { await action('ask', {text, request_id, fault:$('#ask-fault').value || undefined}); } catch {};
}
function wireImageFallbacks() { $$('#sheet-content img').forEach(img => { img.addEventListener('error', () => { const note = document.createElement('p'); note.className = 'image-fallback'; note.textContent = img.closest('.look-image') ? 'AI 코디 이미지를 불러오지 못했어요. 아래 실제 상품 카드를 확인해주세요.' : '상품 이미지 없음 · 상품 정보와 링크를 확인해주세요.'; img.replaceWith(note);track('MEDIA_ERROR',{metadata:{kind:'image'}}); }, {once:true}); }); }

setupShell();
const video = $('#live-video');
video.src = '/assets/video/reference/core-authentic-cardigan.mp4';
function clock(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'); }
function renderVideoControls() {
  $('#video-play').textContent = video.ended ? '다시 재생' : video.paused ? '재생' : '일시정지'; $('#video-play').setAttribute('aria-label', video.paused ? '영상 재생' : '영상 일시정지');
  $('#video-mute').textContent = video.muted ? '음소거 해제' : '음소거'; $('#video-mute').setAttribute('aria-label', video.muted ? '음소거 해제' : '음소거');
  $('#video-mute').setAttribute('aria-pressed',video.muted); $('#video-volume').value = video.volume;
  $('#video-seek').max = Number.isFinite(video.duration) ? video.duration : 0; $('#video-seek').value = video.currentTime;
  $('#video-time').textContent = clock(video.currentTime)+' / '+clock(video.duration);
}
function saveVideo(force = false) {
  if (!state || !joined || restoringVideo || (!force && Date.now()-lastVideoSave < 2000)) return;
  const changes=videoSnapshot(), signature=JSON.stringify(changes);
  if(signature===lastVideoSnapshot)return;
  lastVideoSnapshot=signature;lastVideoSave=Date.now();
  Object.assign(ui,changes); action('ui_state',{patch:changes}).catch(()=>{});
}
function videoSnapshot() {return {video_time:video.currentTime,video_paused:video.paused,video_muted:video.muted,video_volume:video.volume};}
function restoreVideo() {
  const generation=++videoRestoreGeneration;
  restoringVideo = true;
  video.muted = Boolean(ui.video_muted); video.volume = Number.isFinite(ui.video_volume) ? ui.video_volume : 1;
  if (Number.isFinite(video.duration)) video.currentTime = Math.min(ui.video_time || 0,video.duration);
  let playback;
  if(!joined || ui.video_paused !== false || ui.media_mode !== 'video') video.pause();
  else playback=video.play();
  // Native volume/seek/pause events are queued, so keep restoration quiet until they settle.
  Promise.resolve(playback).catch(()=>{}).finally(()=>setTimeout(()=>{
    if(generation!==videoRestoreGeneration)return;
    lastVideoSnapshot=JSON.stringify(videoSnapshot());restoringVideo=false;renderVideoControls();
  },0));
  renderVideoControls();
}
function videoInteraction() {videoRestoreGeneration++;restoringVideo=false;}
function mediaError(event) {
  const simulated=event?.type!=='error',code=simulated?0:(video.error?.code||0);
  const info={at:new Date().toISOString(),code,name:({0:'SIMULATED_MEDIA_ERROR',1:'MEDIA_ERR_ABORTED',2:'MEDIA_ERR_NETWORK',3:'MEDIA_ERR_DECODE',4:'MEDIA_ERR_SRC_NOT_SUPPORTED'})[code],message:video.error?.message||'',source:video.currentSrc||video.src,time:video.currentTime,simulated};
  mediaFailures.push(info);$('#media-error').dataset.errorCode=String(code);
  track('MEDIA_ERROR',{metadata:{kind:'video'}});
  const reason=({0:'영상 오류 체험으로 재생을 중단했어요.',1:'영상 불러오기가 중단되었어요.',2:'영상 파일을 읽는 중 연결 오류가 발생했어요.',3:'영상 데이터를 해석하지 못했어요. 파일 또는 디코더를 확인해주세요.',4:'영상 파일을 찾을 수 없거나 현재 환경에서 지원하지 않는 형식이에요.'})[code];
  videoFailed = true; video.pause(); $('#media-error').hidden=false; $('#media-error').textContent=reason+' 상품 이미지로 전환했어요. 상품 질문과 선택은 계속 이용할 수 있어요.';
  patch({media_mode:'image'});
}
video.addEventListener('error',mediaError);
video.addEventListener('loadedmetadata',restoreVideo);
['play','pause','ended','volumechange','seeked','timeupdate'].forEach(name=>video.addEventListener(name,()=>{renderVideoControls();saveVideo(name!=='timeupdate');}));
$('#video-play').onclick=()=>{videoInteraction(); if(video.paused) video.play().catch(()=>toast('재생 버튼을 다시 눌러주세요. 재생 환경에 따라 자동 재생이 제한될 수 있어요.')); else video.pause(); };
$('#video-mute').onclick=()=>{videoInteraction();video.muted=!video.muted;};
$('#video-volume').oninput=e=>{videoInteraction();video.volume=Number(e.target.value); if(video.volume)video.muted=false;};
$('#video-seek').oninput=e=>{videoInteraction();video.currentTime=Number(e.target.value);};
video.addEventListener('pointerdown',videoInteraction);
video.addEventListener('keydown',videoInteraction);
$('#gallery-image').onerror=()=>{ $('#image-error').hidden=false; $('#gallery-image').hidden=true;track('MEDIA_ERROR',{metadata:{kind:'image'}}); };
$('#media-mode').onchange=e=>{videoInteraction();const mode=e.target.value; if(mode==='video' && videoFailed){videoFailed=false;video.load();} if(mode==='image')video.pause();$('#media-error').hidden=true;patch({media_mode:mode}); };
$('#gallery-prev').onclick=()=>patch({image_index:(Number(ui.image_index)-1+data.product.images.length)%data.product.images.length});
$('#gallery-next').onclick=()=>patch({image_index:(Number(ui.image_index)+1)%data.product.images.length});
$('#orientation-toggle').onclick=()=>patch({orientation:ui.orientation==='portrait'?'landscape':'portrait'});
$('#ask-form').onsubmit=e=>{e.preventDefault();ask($('#ask-input').value);};
$('#dialog-close').onclick=closeSheet;
$('#dialog').addEventListener('cancel',e=>{e.preventDefault();closeSheet();});
$('#dialog').addEventListener('close',()=>{suppressDialogClose=false;});
$('#dialog').addEventListener('click',e=>{if(e.target!==$('#dialog'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSheet();});
$('#suggestion-accept').onclick=async()=>{
  const button=$('#suggestion-accept'),context={run:state?.run_id,customer:customerId,epoch:customerEpoch};
  button.disabled=true;
  try{
    const response=await action('event',{event_type:'AI_SUGGESTION_ACCEPT',event_id:uid(),need:'SIZE'});
    if(response.route==='size'&&state?.run_id===context.run&&customerId===context.customer&&customerEpoch===context.epoch)result('size');
  }catch{}finally{if(customerEpoch===context.epoch)button.disabled=false;}
};
$('#suggestion-dismiss').onclick=async()=>{
  const button=$('#suggestion-dismiss'),context={run:state?.run_id,customer:customerId,epoch:customerEpoch};
  button.disabled=true;
  try{
    await action('event',{event_type:'AI_SUGGESTION_DISMISS',event_id:uid(),need:'SIZE'});
    if(state?.run_id===context.run&&customerId===context.customer&&customerEpoch===context.epoch)toast('이 LIVE에서는 같은 사이즈 제안을 다시 표시하지 않아요.');
  }catch{}finally{if(customerEpoch===context.epoch)button.disabled=false;}
};
$('#purchase-button').onclick=()=>purchase();
$('#info-button').onclick=()=>guide();$('#guide-button').onclick=()=>guide();
$('#simulate-media-error').onclick=mediaError;
$('#switch-product').onclick=async()=>{const current=state.customers.find(c=>c.id===customerId)?.current_product||data.product.product_id;await action('switch_product',{product_id:current===data.product.product_id?'demo-other-product':data.product.product_id});toast('고객 상품 컨텍스트를 전환했어요. 이전 추천 강조는 자동 복구되지 않아요.');};
$('#customer-select').onchange=async e=>{
  // Queue the leave under the previous context before switching or accepting a new heartbeat.
  if(state)action('presence',{session_id:presenceSession,status:'leave'},{silent:true}).catch(()=>{});
  const selected=e.target.value, epoch=++customerEpoch;
  customerId=selected;joined=readJoined(selected);state=null;initialized=false;pendingUI.clear();messageSignature='';presenceContext='';cartSignature='';publicCommentSignature='';pendingComment=null;
  if($('#share-dialog').open)$('#share-dialog').close();$('#public-comment-input').value='';$('#public-comment-status').textContent='';
  $('#cart-count').textContent='—';
  if($('#dialog').open){suppressDialogClose=true;$('#dialog').close();}dialogView=null;
  $('#messages').replaceChildren();$('#ask-input').value='';$('#suggestion').hidden=true;
  $('#size-button').classList.remove('recommended');$('#size-button').dataset.highlight='false';
  $('#profile-name').textContent=({'customer-A':'지수님','customer-B':'민서님','customer-C':'서연님'})[selected];
  document.body.dataset.currentCustomer=selected;
  $$('.device button,.device input,.device select').forEach(el=>el.disabled=true);
  const url=new URL(location);url.searchParams.set('customer',selected);history.replaceState(null,'',url);
  try{
    await queue;if(epoch!==customerEpoch)return;
    const next=await get('/api/state?customer_id='+encodeURIComponent(selected));
    if(epoch!==customerEpoch||selected!==customerId)return;
    applyState(next);restoreVideo();
    restoreSavedView();
  }catch(error){if(epoch===customerEpoch)toast(error.message);}
  finally{if(epoch===customerEpoch){initialized=true;$$('.device button,.device input,.device select').forEach(el=>el.disabled=false);renderUI();presence(true);scheduleExposure();}}
};
document.addEventListener('click',e=>{
  const b=e.target.closest('button,a');if(!b)return;
  if(b.dataset.mode)patch({orientation:b.dataset.mode});
  if(b.dataset.action){track('QUICK_ACTION_CLICK',{metadata:{action:b.dataset.action}});result(b.dataset.action);}
  if(b.dataset.size)patch({size:b.dataset.size});
  if(b.dataset.detail)detail(b.dataset.detail);
  if(b.dataset.question)ask(b.dataset.question);
  if(b.dataset.route)route(b.dataset.route);
  if(b.hasAttribute('data-close'))closeSheet();
  if(b.hasAttribute('data-purchase'))purchase();
  if(b.dataset.look){patch({look:b.dataset.look});renderStyling();}
  if(b.dataset.color){patch({color:b.dataset.color});purchase(false);}
  if(b.dataset.purchaseSize){patch({size:b.dataset.purchaseSize});purchase(false);}
  if(b.id==='size-reviews')detail('reviews');
  if(b.id==='return-ask'){closeSheet();setTimeout(()=>$('#ask-input').focus(),0);}
  if(b.id==='size-purchase')purchase();
  if(b.id==='demo-order')completePurchase(b);
  if(b.hasAttribute('data-product-link'))track('STYLING_PRODUCT_CLICK',{metadata:{product_id:b.dataset.productLink}});
  if(b.id==='purchase-cart-add')addToCart(Number(ui.purchase_quantity)||1);
  if(b.id==='styling-all-button')openStylingAll();
  if(b.id==='styling-back'){patch({active_result:'styling'});renderStyling();}
  if(b.hasAttribute('data-cart-quantity'))cartMutation('cart_update',{item_id:b.dataset.cartItemId,quantity:Number(b.dataset.cartQuantity)});
  if(b.dataset.cartRemove)cartMutation('cart_update',{item_id:b.dataset.cartRemove,quantity:0});
  if(b.dataset.cartCheckout)checkoutCart(b.dataset.cartCheckout);
});

async function boot() {
  if(booting)return;
  booting=true;clearTimeout(bootRetry);
  try {
    data=await get('/api/bootstrap');
    $('.product-thumb').src=asset(data.product.images[4].local_path);
    $('.product-thumb').onerror=()=>{ $('.product-thumb').hidden=true;track('MEDIA_ERROR',{metadata:{kind:'image'}}); };
    applyState(await get('/api/state?customer_id='+encodeURIComponent(customerId)));
    if (!videoKnowledge) videoKnowledge = setupVideoKnowledge({data,video,getUI:()=>ui,getState:()=>state,
      patch,track,toast,restoreVideo,onInteraction:()=>{videoFailed=false;$('#media-error').hidden=true;videoInteraction();},onAsk:ask});
    restoreVideo(); initialized=true;presence(true);scheduleExposure();
    restoreSavedView();
    if(new URLSearchParams(location.search).get('mode')==='landscape')patch({orientation:'landscape'});
  } catch(error){toast(error.message);$('#live-clock').textContent='재연결 중';bootRetry=setTimeout(boot,3000);}
  finally{booting=false;}
}
setInterval(async()=>{if(!initialized||polling||writes)return;polling=true;const who=customerId,epoch=customerEpoch;try{const next=await get('/api/state?customer_id='+encodeURIComponent(who));if(who===customerId&&epoch===customerEpoch&&!writes)applyState(next);}catch{$('#live-clock').textContent='재연결 중';}finally{polling=false;}},500);
setInterval(()=>presence(),5000);
document.addEventListener('scroll',scheduleExposure,true);
window.addEventListener('resize',scheduleExposure);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){presence(true);scheduleExposure();}});
window.addEventListener('pagehide',()=>{pageHidden=true;leavePresence();});
window.addEventListener('pageshow',()=>{pageHidden=false;presence(true);scheduleExposure();});
window.addEventListener('online',()=>{if(initialized)presence(true);else boot();});
window.gsApp={getState:()=>structuredClone({state,ui,dialogView,dialogTab,customerId}),getVideo:()=>({time:video.currentTime,duration:video.duration,paused:video.paused,muted:video.muted,volume:video.volume,readyState:video.readyState}),getMediaErrors:()=>structuredClone(mediaFailures)};
boot();
