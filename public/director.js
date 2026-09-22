(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const bus = window.GSAILiveState;
  const fixture = window.GSLiveConfig;
  const money=value=>value.toLocaleString('ko-KR')+'원';
  const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const emit = (type, payload = {}) => bus.emit(type, payload, 'director');
  const time = value => value ? new Date(value).toLocaleTimeString('ko-KR', { hour12:false }) : '시각 기록 없음';
  let shared = bus.read();
  let view = 'monitor';
  let range = 10;
  let seconds = 1472;
  let toastTimer;
  const text = (selector, value) => { $(selector).textContent = value; };

  // The only approval/need writer is the shared reducer. Local state is layout-only.
  $('.main').insertAdjacentHTML('afterbegin', `<details class="shared-diagnostics card"><summary>공통 상태 · 시연 컨트롤 <span id="gs-d-stage">MONITORING</span></summary><div class="diagnostic-grid"><div>사이즈 관심<strong id="gs-d-signal">8건</strong></div><div>Need<strong id="gs-d-need">대기</strong></div><div>승인 대상<strong id="gs-d-target">대기</strong></div><div>PD 승인<strong id="gs-d-approvals">0/2</strong></div><div>고객 이벤트<strong id="gs-d-events">0</strong></div><div>강조<strong id="gs-d-highlight">대기</strong><small id="gs-d-expiry"></small></div></div><p class="diagnostic-targets"><span id="gs-target-a">A 대기</span> · B 제외 · C 제외 · 집단 수치 8→26 / 33명은 Simulation</p><div class="diagnostic-actions"><button data-gs-action="detect">8 → 26 감지 재현</button><button data-gs-action="host">호스트 승인</button><button data-gs-action="app">APP 33명 승인</button><button data-gs-action="result">Simulation 결과</button><button data-gs-action="expire">강조 만료 검수</button><button data-gs-action="reset">공통 Reset</button></div><p class="label muted">위 버튼은 발표용 단축 조작입니다. 본문에서 추천 대응안 확인 → 메시지/대상 검토 → PD 승인 흐름을 체험할 수 있습니다.</p></details>`);
  $('.kpi-grid').setAttribute('aria-label', '방송 현황: 기존 운영 지표는 Simulation, 실제 질문 카드는 현재 로컬 세션 집계');
  $('.kpi-grid').insertAdjacentHTML('beforeend', '<div class="kpi card actual-kpi"><div class="kpi-head">실시간 질문</div><div class="kpi-number mono" id="actual-question-count">0<span class="unit">건</span></div><div class="kpi-note">이번 로컬 방송 · 실제 ASK 입력</div></div>');
  $('#monitor-view').insertAdjacentHTML('afterbegin',`<section class="card actual-activity"><div class="between"><div><h2>실제 고객 반응 · Mobile 연동</h2><p class="label muted">아래 값은 이번 방송의 로컬 UI 이벤트입니다. 위 운영 KPI와 집단 수치는 Simulation입니다.</p></div><span class="badge purple" id="actual-run"></span></div><div id="actual-metrics" class="actual-metrics"></div><div class="actual-split"><div><h3>관심 행동 집계</h3><div id="actual-topics"></div></div><div><h3>고객 A · 최근 이벤트를 보낸 탭</h3><div id="actual-customer"></div></div></div><details><summary>최근 고객 이벤트 확인</summary><ol id="actual-events"></ol></details></section>`);
  $('.result-grid').insertAdjacentHTML('afterend','<section class="card actual-activity"><h2>승인 후 실제 로컬 행동</h2><p class="label muted">APP 승인 시점을 기준으로 집계한 증분입니다. 위 고정 Simulation 결과와 별개이며 효과의 인과관계나 실주문을 뜻하지 않습니다.</p><div id="actual-after-approval" class="actual-metrics"></div></section>');
  $('#need-overview').insertAdjacentHTML('beforebegin', `<section class="card question-panel"><div class="panel-head between"><div><h2>현재 주요 고객 질문 TOP 5</h2><p>이번 방송 · 실제 ASK LIVE 질문 유형 집계</p></div><span class="badge purple" id="question-total">0건</span></div><ol id="question-ranking"></ol><p class="question-note">자유 질문 원문은 저장하지 않고 지원 질문 유형으로 묶습니다. 같은 유형의 질문은 함께 집계합니다.</p></section>`);
  // Add the two existing topic fixtures to the trend view, clearly marked Simulation.
  for (const [id,color,label] of [['product','#ce8fa1','상품후기'],['styling','#8c94c9','코디']]) {
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.id=`${id}-line`;path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','2');$('#size-line').before(path);
    $('.chart-legend').insertAdjacentHTML('beforeend',`<span><i class="legend-mark" style="background:${color}"></i>${label}</span>`);
  }
  $('.recommendation').insertAdjacentHTML('afterend', '<section id="live-action-receipt" class="card action-receipts" hidden aria-label="액션 적용 현황"></section>');
  $('.result-grid').insertAdjacentHTML('beforebegin', '<section id="result-action-receipt" class="card action-receipts" aria-label="액션 적용 결과"></section>');
  $('.target-line').textContent = '대상 33명은 고정 시나리오 · 실제 연결 고객 A / B·C 제외 예시';
  $('.result-context .callout').textContent = '결과 수치는 실제 측정값이나 검증된 매출·전환 개선 효과가 아닙니다. 실제 로컬 질문·행동 집계와 승인 기록은 따로 표시하며, 집단 대상 33명과 효과 지표는 고정 Simulation입니다.';
  $('#sources-dialog .dialog-body').innerHTML = '<h3>데이터와 연결 범위</h3><ul class="source-list"><li>상품·리뷰·확정 결과값: 제공 개발 명세와 원본 HTML</li><li>현재 로컬 질문 수 / 질문 TOP 5 / 행동 근거: 실제 고객 UI 이벤트</li><li>집단 관심 8→26 / 대상 33명 / 운영 KPI / 추이 중간값 / 효과 결과: 고정 Simulation</li><li>고객 A: 실제 Mobile 탭 공유 상태. B/C: 비대상 판정 예시</li></ul><div class="callout">같은 브라우저·같은 origin의 공통 브라우저 저장소로 공유합니다. 새로고침 후에도 승인·거절은 유지하며 공통 Reset으로 초기화합니다. 쇼호스트 전송·서버 고객 관리·실제 방송/AI/주문 서비스는 연결하지 않았습니다.</div>';

  function toast(message) { clearTimeout(toastTimer); text('#toast', message); $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
  function switchView(next) {
    view = next;
    const names = { monitor:'실시간 모니터링', history:'액션 기록', analytics:'효과 분석' };
    Object.keys(names).forEach(key => { $(`#${key}-view`).hidden = key !== view; });
    $$('[data-view]').forEach(button => { const active=button.dataset.view===view;button.classList.toggle('active',active); if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
    text('#breadcrumb-current',names[view]); text('#page-title',view==='monitor'?'AI 디렉터':names[view]);
    text('#page-subtitle', { monitor:'고객의 관심을 읽고, 지금 필요한 액션을 결정하세요.', history:'실제 로컬 고객 행동과 PD 승인 기록을 확인하세요.', analytics:'승인한 액션과 시뮬레이션 결과를 구분해 확인하세요.' }[view]);
  }
  function closeDemo() { $('#demo-controls').hidden=true; $('#demo-toggle').setAttribute('aria-expanded','false'); }
  function openDialog(id) { closeDemo(); $(id).showModal(); }
  function showActions() { emit('REVIEW_ACTIONS'); }
  function renderChart() {
    const spike=shared.need.detected;
    const base=range===10?[6,7,5,8,6,7,6,8,7,8,8]:[3,5,4,7,6,5,7,6,8,8,8];
    const sizes=spike?[...base.slice(0,8),13,20,26]:base;
    const benefits=range===10?[10,9,10,11,9,10,11,10,10,11,11]:[5,7,8,7,9,10,8,11,10,10,11];
    const deliveries=[4,5,4,4,6,5,6,5,6,5,6];
    const line=values=>values.map((v,i)=>(i?'L':'M')+(40+i*52.5)+' '+(180-v*5)).join(' ');
    $('#size-line').setAttribute('d',line(sizes)); $('#benefit-line').setAttribute('d',line(benefits)); $('#delivery-line').setAttribute('d',line(deliveries));
    $('#product-line').setAttribute('d',line([2,2,3,2,3,4,3,4,3,4,4]));$('#styling-line').setAttribute('d',line([3,4,3,4,4,3,4,5,4,5,5]));
    $('#size-area').setAttribute('d',line(sizes)+' L565 180 L40 180 Z'); $('#latest-dot').setAttribute('cy',180-sizes[10]*5);
    $('#spike-label').style.display=spike?'':'none'; $('#spike-label').removeAttribute('hidden');
    text('#signal-number',shared.signals.size); $('#signal-change').hidden=!spike;
    text('#chart-description',`최근 ${range}분 · Prototype Simulation${shared.result.visible?' · 대응 직전 기록':''}`);
    text('#chart-desc',spike?'Simulation: 사이즈 8→26, 혜택 11, 배송 6, 상품후기 4, 코디 5. 실제 고객 행동 근거는 별도 카드에 표시합니다.':'Simulation: 사이즈8, 혜택11, 배송6, 상품후기4, 코디5.');
    (range===10?['14:14','14:16','14:18','14:20','14:22','14:24']:['13:54','14:00','14:06','14:12','14:18','14:24']).forEach((value,i)=>text(`#tick-${i}`,value));
    $$('[data-range]').forEach(button=>{const active=Number(button.dataset.range)===range;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  }
  function renderQuestions() {
    const activity=shared.activity || { questionCount:0,questionsByIntent:{} };
    $('#actual-question-count').innerHTML=`${activity.questionCount}<span class="unit">건</span>`;
    text('#question-total',`${activity.questionCount}건`);
    const ranked=Object.entries(bus.INTENTS).map(([key,label])=>({ key,label,count:activity.questionsByIntent[key]||0 })).sort((a,b)=>b.count-a.count).slice(0,5);
    $('#question-ranking').innerHTML=ranked.map((item,i)=>`<li data-intent="${item.key}"><span class="rank-number">${i+1}</span><span>${escape(item.label)}</span><strong>${item.count}건</strong></li>`).join('');
    $('.question-note').textContent=activity.questionCount?'자유 질문 원문은 저장하지 않고 지원 질문 유형으로 묶습니다. 같은 유형의 질문은 함께 집계합니다.':'아직 실제 질문이 없습니다. 고객 Mobile에서 질문하면 이 목록에 집계됩니다. 아래 항목은 지원 질문 예시입니다.';
    const evidence=shared.need.evidence;
    const labels=[['SIZE_TAB_OPEN','사이즈표 조회'],['REVIEW_SIZE_VIEW','사이즈 리뷰 탐색'],['ASK_SIZE','사이즈 질문']];
    $('#evidence-panel .between .badge').textContent=`실제 감지 근거 ${evidence.length}건`;
    $('#evidence-panel .evidence-grid').innerHTML=labels.map(([key,label])=>`<div class="evidence-item"><span>${label}</span><strong class="mono">${evidence.filter(event=>event.type===key).length}</strong><small>로컬 UI 이벤트</small></div>`).join('');
    $('#evidence-panel .questions-title').textContent=evidence.length?'대표 질문 예시 · 원문 수집 아님 / 집단 26건은 Simulation':'수동 감지 시나리오 · 실제 행동 근거 없음 / 아래는 질문 예시';
  }
  function renderActivity() {
    const metrics=bus.actualMetrics(shared);
    const labels={size:'내 사이즈 이용',benefit:'내 혜택 이용',styling:'코디 추천 이용',cartAdds:'장바구니 담기',purchaseClicks:'구매 흐름 진입',completed:'구매 체험 완료'};
    $('#actual-metrics').innerHTML=Object.entries(labels).map(([key,label])=>`<div><span>${label}</span><strong id="actual-${key}">${metrics[key]}</strong></div>`).join('');
    const baseline=shared.actionDetails?.appBaseline;
    $('#actual-after-approval').innerHTML=Object.entries(labels).map(([key,label])=>`<div><span>${label}</span><strong id="after-${key}">${baseline?'+'+Math.max(0,metrics[key]-(baseline[key]||0)):'—'}</strong></div>`).join('');
    const topics=shared.activity.topics, maximum=Math.max(1,...Object.values(topics));
    $('#actual-topics').innerHTML=Object.entries({size:'사이즈',benefit:'혜택',styling:'코디',product:'상품·후기',delivery:'배송 질문'}).map(([key,label])=>`<div class="actual-topic" data-topic="${key}"><span>${label}</span><meter min="0" max="${maximum}" value="${topics[key]||0}" aria-label="${label} ${topics[key]||0}건"></meter><b>${topics[key]||0}건</b></div>`).join('');
    const customer=shared.customer, video=customer.video, count=customer.cart.reduce((n,item)=>n+item.quantity,0);
    const status={unknown:'미확인',ready:'준비',playing:'재생 중',paused:'일시정지',ended:'종료',error:'오류 · 이미지 대체'}[video.status];
    $('#actual-customer').innerHTML=customer.lastSeenAt?`<dl><div><dt>선택 옵션 / 코디</dt><dd id="actual-selection">${escape(customer.selectedSize)} / ${fixture.lookNames[customer.look]}</dd></div><div><dt>화면</dt><dd>${customer.mode==='landscape'?'가로':'세로'}</dd></div><div><dt>장바구니 · 데모</dt><dd id="actual-cart">${count}개 · ${money(count*fixture.benefit.final)}<small>${customer.cart.map(item=>`${item.size} × ${item.quantity}`).join(', ')||'비어 있음'}</small></dd></div><div><dt>참고 영상 상태</dt><dd id="actual-video">${status} · ${Math.floor(video.currentTime)} / ${Math.floor(video.duration)}초</dd></div><div><dt>마지막 수신</dt><dd>${time(customer.lastSeenAt)}${customer.latestFeature==='LIVE_EXIT'?' · 나가기 기록':''}</dd></div><div><dt>완료한 구매 체험</dt><dd id="actual-demo-total">${shared.activity.demoUnits}개 · ${money(shared.activity.demoTotal)}<small>실제 결제 아님</small></dd></div></dl>`:'<p class="label muted">아직 Mobile 이벤트가 없습니다. 같은 주소의 고객 화면을 열어주세요.</p>';
    const eventNames={SIZE_OPTION_SELECT:'사이즈 선택',SIZE_TAB_OPEN:'사이즈표 조회',REVIEW_SIZE_VIEW:'사이즈 리뷰',SIZE_RESULT_VIEW:'내 사이즈',BENEFIT_RESULT_VIEW:'내 혜택',STYLING_OPEN:'코디 추천',STYLING_LOOK_CHANGE:'코디 변경',STYLING_CATALOG_OPEN:'전체 코디 상품',STYLING_PRODUCT_CLICK:'코디 상품 링크',PRODUCT_LINK_CLICK:'상품 링크',PRODUCT_DETAIL_OPEN:'상품상세',ASK_LIVE_SUBMIT:'ASK 질문',ASK_RESPONSE_READY:'ASK 답변 준비 완료',CART_ADD:'장바구니 담기',CART_QUANTITY_CHANGE:'장바구니 수량 변경',CART_REMOVE:'장바구니 삭제',PURCHASE_CLICK:'구매 흐름 진입',PURCHASE_DEMO_COMPLETE:'단품 구매 체험 완료',CART_DEMO_COMPLETE:'장바구니 구매 체험 완료',VIEW_MODE_CHANGE:'방향 전환',LIVE_ENTER:'고객 화면 진입',LIVE_EXIT:'고객 화면 나가기',VIDEO_EVENT:'참고 영상 상태'};
    $('#actual-events').innerHTML=shared.events.filter(event=>eventNames[event.type]).slice(-12).toReversed().map(event=>`<li><time>${time(event.at)}</time><span>${eventNames[event.type]}</span><small>${escape(event.payload.intent?bus.INTENTS[event.payload.intent]:event.payload.size||event.payload.action||'')}</small></li>`).join('');
    text('#actual-run',`방송 ${shared.runId} · ${bus.serializedWrites()?'동시 쓰기 보호':'동시 쓰기 미지원'}`);
    text('.page-meta strong',`LIVE SESSION ${String(shared.runId).padStart(3,'0')}`);
  }
  function receiptMarkup() {
    const detail=shared.actionDetails || {};
    return `<h2>액션 적용 ${shared.result.visible?'결과':'현황'}</h2><p class="receipt-note">승인 기록은 실제 로컬 상태 · 외부 전송은 데모</p><article><strong>${shared.approvals.host?'✓ 쇼호스트 전달 완료 · 데모':'쇼호스트 전달 대기'}</strong><small>${shared.approvals.host?time(detail.hostApprovedAt):'PD 승인 후 기록'}</small>${shared.approvals.host?`<blockquote>${escape(detail.hostMessage || '이전 버전 승인 · 안내문 기록 없음')}</blockquote><p>실제 메시징 시스템에는 전송하지 않았습니다.</p>`:''}</article><article><strong>${shared.approvals.app?'✓ APP 개인화 적용 승인':'APP 개인화 승인 대기'}</strong><small>${shared.approvals.app?time(detail.appApprovedAt):'관련 행동 고객만 대상'}</small><p>${shared.customer.dismissed?'A 고객은 거절하여 제외 · 동일 방송 재노출 없음':shared.customer.accepted?'A 고객이 제안을 확인함 · 중복 제안 없음':shared.approvals.app?'A 고객에게 승인 표시와 내 사이즈 강조 반영':'A 고객 행동 조건 확인 후 적용'}<br>집단 33명은 Simulation · B/C는 비대상 예시</p></article>`;
  }
  function renderHistory() {
    const labels={ RESET:['방송 초기화','공통 상태를 새 방송으로 초기화했습니다.'], NEED_DETECTED:['사이즈 Need 감지','실제 행동 근거 또는 명시적 감지 시나리오 · 집단 8→26은 Simulation'], REVIEW_ACTIONS:['AI 추천 대응안 검토','쇼호스트 안내와 APP 개인화 검토'], APPROVE_HOST:['쇼호스트 안내 승인',''], APPROVE_APP:['APP 개인화 승인','33명 집단은 Simulation · 실제 연결 A / B·C 제외'], ACCEPT_SUGGESTION:['고객 제안 수락','A 고객이 내 사이즈 결과를 확인했습니다.'], DISMISS_SUGGESTION:['고객 제안 거절','A 고객에게 같은 방송 재노출 금지'], SHOW_RESULT:['Simulation 결과 확인','26→11, 14→43, 82→95 · 실제 측정 효과 아님'], EXPIRE_HIGHLIGHT:['결과 강조 종료','강조 기간이 종료되었습니다.'] };
    const records=shared.events.filter(event=>labels[event.type]);
    $('#history-list').innerHTML=records.length?records.toReversed().map(event=>`<div class="history-row"><span class="time mono">${time(event.at)}</span><div><strong>${labels[event.type][0]}</strong><p>${escape(event.type==='APPROVE_HOST'?(event.payload.message || '이전 버전 승인 · 안내문 기록 없음'):labels[event.type][1])}</p></div><span class="badge ${event.type.startsWith('APPROVE')?'mint':'neutral'}">${event.type.startsWith('APPROVE')?'PD 승인':'로컬 기록'}</span></div>`).join(''):'<p class="callout">아직 감지·승인 기록이 없습니다.</p>';
  }
  function renderCustomer() {
    const id=$('#preview-customer').value || 'A';
    let description;
    if(id!=='A')description=`${id} 고객은 ${id==='B'?'혜택만':'배송만'} 조회한 비대상 예시입니다. 별도 실제 고객 세션이 연결된 것은 아닙니다.`;
    else if(shared.customer.dismissed)description='A 고객이 제안을 거절했습니다. 같은 방송에서 다시 노출하지 않으며, 내 사이즈 직접 조회는 허용됩니다.';
    else if(shared.customer.accepted)description='A 고객이 제안을 수락했습니다. 66 사이즈를 먼저 확인해보세요. 상품 사이즈 평가 87%가 잘 맞아요입니다.';
    else if(shared.approvals.app)description='A 고객에게 PD 승인 표시와 내 사이즈 강조가 적용되었습니다. 수락/거절은 실제 고객 Mobile에서 수행하세요.';
    else description='A 고객은 사이즈 관련 행동이 감지되면 작은 제안을 봅니다. 아직 APP 개인화 PD 승인은 적용하지 않았습니다.';
    $('#customer-preview').innerHTML=`<div class="preview-empty"><strong>${id} ${id==='A'?'· 실제 연결 고객':'· 비대상 fixture'}</strong><p>${description}</p>${id==='A'?`<p>최근 선택: ${escape(shared.customer.selectedSize)} · ${fixture.lookNames[shared.customer.look]} 코디<br>추천 기준인 평소 사이즈 66과 현재 선택 옵션은 별개입니다.</p><a class="btn outline" href="/mobile.html" target="_blank" rel="noopener">실제 고객 화면 열기 ↗</a>`:''}</div>`;
  }
  function renderSegment() {
    const dismissed=shared.customer.dismissed;
    text('#segment-badge',dismissed?'A 거절 제외 · 승인 불가':'Simulation 대상 33명 · 실제 연결 A / B·C 제외');
    text('#app-dialog-subtitle','현재 공통 상태의 대상 판정입니다. 별도의 가상 고객 상태를 만들지 않습니다.');
    $('#segment-body').innerHTML=`<tr><td>A</td><td>${shared.need.evidence.map(event=>({SIZE_TAB_OPEN:'사이즈표',REVIEW_SIZE_VIEW:'사이즈 리뷰',ASK_SIZE:'사이즈 질문'})[event.type]).join(' + ') || '수동 감지 시나리오'}</td><td><span class="badge ${dismissed?'neutral':'mint'}">${dismissed?'거절 제외':shared.customer.accepted?'수락 완료':shared.approvals.app?'승인':'포함'}</span></td></tr><tr><td>B</td><td>혜택 조회만 · 예시</td><td>제외</td></tr><tr><td>C</td><td>배송 조회만 · 예시</td><td>제외</td></tr>`;
    $('#approve-app').hidden=shared.approvals.app;
    $('#approve-app').disabled=dismissed || !shared.need.detected;
    text('#approve-app',dismissed?'거절한 고객은 적용하지 않음':'승인하고 33명 시나리오에 적용');
    text('#app-cancel',shared.approvals.app?'닫기':'취소');
    renderCustomer();
  }
  function updateExpiry() {
    const active=bus.isHighlightActive(shared);
    text('#gs-d-highlight',active?'강조 중':shared.result.visible?'만료':'대기');
    text('#gs-d-expiry',active?`${Math.max(0,Math.ceil((shared.result.highlightExpiresAt-Date.now())/1000))}초 남음`:'');
    $('[data-gs-action="expire"]').disabled=!active;
  }
  function render(next) {
    const first=!render.initialized;
    const reset=next.runId!==shared.runId;
    const newResult=next.result.visible && (!shared.result.visible || first);
    shared=next;
    render.initialized=true;
    if(reset){seconds=1472;range=10;$$('dialog[open]').forEach(dialog=>dialog.close());switchView('monitor');}
    if(newResult)switchView('analytics');
    const { stage, approvals:{host,app} }=shared;
    const steps=['NORMAL','ALERT','ACTION','RESULT']; const index=steps.indexOf(stage);
    $$('[data-step]').forEach((element,i)=>{element.classList.toggle('active',i===index);element.classList.toggle('done',i<index);element.querySelector('.step-number').textContent=i<index?'✓':String(i+1).padStart(2,'0');if(i===index)element.setAttribute('aria-current','step');else element.removeAttribute('aria-current');});
    const config={ NORMAL:['모니터링 중','분석 중','현재 특이사항이 없습니다.','고객의 실제 로컬 질문과 탐색 행동을 수집합니다. 의미 있는 사이즈 관심 변화가 생기면 알려드릴게요.','shield','사이즈 급증 재현'], ALERT:['관심 급증 감지','HIGH · 확인 필요','사이즈 관련 고객 관심이 빠르게 증가하고 있어요.','30초 안의 사이즈 관련 행동을 근거로 제안합니다. 집단 관심 8→26은 고정 Simulation입니다.','alert','추천 대응안 확인'], ACTION:['PD 승인 대기','HIGH · 대응 권장','사이즈 선택을 도와줄 타이밍입니다.','쇼호스트 안내문과 고객 대상을 확인한 후 필요한 대응안을 승인해주세요.','spark',''], RESULT:['대응 완료','적용 완료','승인한 액션과 결과를 확인하세요.','승인 기록과 실제 고객 반응은 로컬 상태이며 아래 효과 지표는 Simulation입니다.','check','전체 결과 확인'] }[stage];
    text('#status-pill',stage==='ACTION'&&host&&app?'결과 확인 준비':config[0]);text('#ai-badge',config[1]);text('#ai-title',config[2]);text('#ai-description',config[3]);$('#ai-icon').setAttribute('href','#i-'+config[4]);text('#insight-cta-text',config[5]);$('#insight-cta').hidden=stage==='ACTION';$('#ai-panel').classList.toggle('alert',stage==='ALERT');
    text('#ai-note','AI는 대응안을 제안하고 최종 결정은 PD가 합니다. 실제 방송/메시징 전송은 없습니다.');
    $('#need-overview').hidden=shared.need.detected;$('#evidence-panel').hidden=!shared.need.detected;$('#action-empty').hidden=index>=2;$('#action-options').hidden=index<2;
    text('#empty-action-title',stage==='ALERT'?'고객 관심에 맞는 대응안을 준비했어요':'관심 변화가 감지되면 제안합니다');
    text('#empty-action-text',stage==='ALERT'?'추천 대응안 확인을 눌러 검토하세요.':'쇼호스트 안내와 관련 고객 개인화를 준비합니다.');
    text('#approval-badge',index>=2?`${Number(host)+Number(app)} / 2 승인`:stage==='ALERT'?'2개 제안':'대기 중');
    $('#host-card').classList.toggle('approved',host);$('#app-card').classList.toggle('approved',app);
    $('#host-action').disabled=host;$('#host-action').innerHTML=host?icon('check')+'쇼호스트 전달 완료 · 데모':'쇼호스트에게 전달'+icon('arrow');
    $('#app-action').disabled=app;$('#app-action').innerHTML=app?icon('check')+'33명 시나리오 승인 · A 반영':'대상 확인 및 적용'+icon('arrow');
    $('#preview-action').hidden=!app;$('#result-action').disabled=!(host&&app);$('#result-ready').hidden=shared.result.visible;$('#result-summary').hidden=!shared.result.visible;
    text('#result-instruction',host&&app?'두 대응안이 승인되었습니다. 예시 결과를 확인하세요.':'두 대응안을 승인하면 결과를 확인할 수 있습니다.');
    $('#analytics-empty').hidden=shared.result.visible;$('#analytics-content').hidden=!shared.result.visible;text('#action-count',Number(host)+Number(app));$('#demo-trigger').disabled=shared.need.detected;
    text('#gs-d-stage',stage);text('#gs-d-signal',`${shared.signals.size}건`);text('#gs-d-need',shared.need.detected?'감지':'대기');text('#gs-d-target',shared.need.detected?'33명':'대기');text('#gs-d-approvals',`${Number(host)+Number(app)}/2`);text('#gs-d-events',shared.events.filter(event=>event.source==='customer').length);
    text('#gs-target-a',shared.customer.dismissed?'A 거절 제외':app?'A 승인':shared.need.detected?'A 포함':'A 대기');
    $('[data-gs-action="detect"]').disabled=shared.need.detected;$('[data-gs-action="host"]').disabled=host||!shared.need.detected;$('[data-gs-action="app"]').disabled=app||!shared.need.detected||shared.customer.dismissed;$('[data-gs-action="result"]').disabled=!(host&&app)||shared.result.visible;
    $('#live-action-receipt').hidden=!(host||app);$('#live-action-receipt').innerHTML=receiptMarkup();$('#result-action-receipt').innerHTML=receiptMarkup();
    renderChart();renderQuestions();renderHistory();renderActivity();updateExpiry();
    if($('#app-dialog').open)renderSegment();
    $('.connection').innerHTML=`<span class="dot" style="color:#58b29b"></span>${bus.storageAvailable()?'로컬 고객 이벤트 연결':'저장소 불가 · 현재 탭만 동작'}`;
  }

  $$('[data-view],[data-go]').forEach(button=>button.onclick=()=>switchView(button.dataset.view||button.dataset.go));
  $$('[data-range]').forEach(button=>button.onclick=()=>{range=Number(button.dataset.range);renderChart();});
  $('#demo-toggle').onclick=()=>{const open=$('#demo-controls').hidden;$('#demo-controls').hidden=!open;$('#demo-toggle').setAttribute('aria-expanded',String(open));};
  document.addEventListener('click',event=>{if(!event.target.closest('.demo-wrap'))closeDemo();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDemo();});
  $('#demo-trigger').onclick=()=>{closeDemo();emit('SCENARIO_DETECT');};
  $('#insight-cta').onclick=()=>{if(shared.stage==='NORMAL')emit('SCENARIO_DETECT');else if(shared.stage==='ALERT')showActions();else if(shared.stage==='RESULT')switchView('analytics');};
  $('#host-action').onclick=()=>{if(shared.stage!=='ACTION'||shared.approvals.host)return;$('#host-message').value=bus.HOST_MESSAGE;$('#approve-host').disabled=false;openDialog('#host-dialog');};
  $('#host-message').oninput=()=>{$('#approve-host').disabled=!$('#host-message').value.trim();};
  $('#approve-host').onclick=async()=>{const message=$('#host-message').value.trim();if(!message)return;const result=await emit('APPROVE_HOST',{message});$('#host-dialog').close();toast(result.approvals.host?'안내문 승인을 기록했습니다. 실제 쇼호스트 전송은 데모입니다.':'방송 상태가 변경되어 승인하지 않았습니다.');};
  $('#preview-customer').innerHTML='<option value="A">A · 실제 연결 고객</option><option value="B">B · 비대상 예시</option><option value="C">C · 비대상 예시</option>';
  $('#preview-customer').onchange=renderCustomer;
  $('#app-action').onclick=()=>{if(shared.stage!=='ACTION'||shared.approvals.app)return;renderSegment();openDialog('#app-dialog');};
  $('#preview-action').onclick=()=>{renderSegment();openDialog('#app-dialog');};
  $('#approve-app').onclick=async()=>{if(shared.customer.dismissed)return;const result=await emit('APPROVE_APP');$('#app-dialog').close();toast(result.approvals.app?'A 고객 화면에 승인을 반영했습니다. 33명 집단은 Simulation입니다.':'고객 상태가 변경되어 승인하지 않았습니다.');};
  $('#result-action').onclick=()=>emit('SHOW_RESULT');
  $('#sources-button').onclick=()=>openDialog('#sources-dialog');$('#reset-btn').onclick=()=>openDialog('#reset-dialog');$('#confirm-reset').onclick=async()=>{await emit('RESET');$('#reset-dialog').close();toast('새 방송으로 초기화했습니다.');};
  $$('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
  $$('[data-gs-action]').forEach(button=>button.onclick=()=>emit({detect:'SCENARIO_DETECT',host:'APPROVE_HOST',app:'APPROVE_APP',result:'SHOW_RESULT',expire:'EXPIRE_HIGHLIGHT',reset:'RESET'}[button.dataset.gsAction]));
  bus.subscribe(render);
  setInterval(()=>{seconds++;text('#live-clock',[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(value=>String(value).padStart(2,'0')).join(':'));if(shared.result.highlighted&&shared.result.highlightExpiresAt<=Date.now())emit('EXPIRE_HIGHLIGHT');updateExpiry();},1000);
})();
