'use strict';

// The browser owns presentation only. Need, approval, audience and time come from the server.
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const stages = ['NORMAL', 'ALERT', 'ACTION', 'RESULT'];
const viewNames = {monitor: '실시간 모니터링', activity: '고객 이용 · 안내', history: '액션 기록', analytics: '효과 분석'};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const number = value => Number(value || 0).toLocaleString('ko-KR');
const seconds = value => Math.max(0, Math.floor(Number(value) || 0));
const clock = value => {const n = seconds(value); return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(v => String(v).padStart(2, '0')).join(':');};
let state = null;
let bootstrap = null;
let busy = false;
let online = false;
let mutationEpoch = 0;
let toastTimer;
let currentView = 'monitor';
let lastRendered = '';
let noticeDraftRequest = null;
const dialogTriggers = new Map();

function put(selector, value) {
  const el = $(selector);
  const next = String(value ?? '');
  if (el.textContent !== next) el.textContent = next;
}
function html(selector, content) {const element = $(selector); if (element.innerHTML !== content) element.innerHTML = content;}
function toast(message) {
  clearTimeout(toastTimer);
  put('#toast', message);
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function switchView(view) {
  if (!Object.hasOwn(viewNames, view)) return;
  const changed = currentView !== view;
  currentView = view;
  for (const name of Object.keys(viewNames)) $(`#${name}-view`).hidden = view !== name;
  $$('.nav [data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  put('#breadcrumb-current', viewNames[view]);
  put('#page-title', view === 'monitor' ? 'AI 디렉터' : viewNames[view]);
  put('#page-subtitle', {monitor: '고객의 관심을 읽고, 지금 필요한 액션을 결정하세요.', activity: '고객의 실제 이용을 살펴보고, 필요한 안내를 함께 전달하세요.', history: '감지부터 승인까지, 이번 방송의 의사결정을 확인하세요.', analytics: '실제 이용 집계와 준비된 Simulation을 각각 확인하세요.'}[view]);
  if (changed) window.scrollTo({top: 0, behavior: 'instant'});
}
function setConnection(connected, message = '') {
  const changed = online !== connected;
  online = connected;
  document.body.dataset.connection = connected ? 'online' : 'offline';
  $('#connection').classList.toggle('offline', !connected);
  put('#connection-text', connected ? '공통 상태 연결됨' : '연결 확인 필요');
  $('#connection-error').hidden = connected;
  if (!connected) put('#connection-error', (message || '서버에 연결할 수 없습니다. 자동으로 다시 연결합니다.') + ' 아래 이용 수치는 마지막으로 수신한 값이며, 현재 접속 여부는 확인 중입니다.');
  // Connection status is presentation state too: a frozen demo may return identical JSON.
  if (changed && state) {render(); lastRendered = JSON.stringify(state);}
  renderControls();
}
async function request(path, options = {}) {
  const response = await fetch(path, {cache: 'no-store', ...options, headers: {'Content-Type': 'application/json', ...options.headers}});
  let data;
  try {data = await response.json();} catch {throw new Error('서버 응답을 읽을 수 없습니다. 로컬 서버를 확인해주세요.');}
  if (!response.ok) throw new Error(data.error || data.message || `요청 처리 오류 (${response.status})`);
  return data;
}
function acceptState(next) {
  if (!next || !next.run_id || !next.campaign) throw new Error('공통 상태 형식이 올바르지 않습니다.');
  const changedRun = state && state.run_id !== next.run_id;
  const changedStage = !state || state.campaign.state !== next.campaign.state;
  if (changedRun) {
    $$('dialog[open]').forEach(dialog => dialog.close());
    $('#host-reviewed').checked = false;
    $('#host-message').value = next.campaign.host_text || '사이즈 관련 관심이 늘었습니다. 평소 사이즈 기준과 반사이즈 선택 방법을 한 번 더 안내해주세요.';
    noticeDraftRequest = null;
    $('#notice-form').reset();
    put('#notice-length', '0 / 500');
    put('#notice-form-status', '새 실행에서 공용 안내가 초기화되었습니다.');
    toast('새 실행의 공통 상태로 연결되었습니다.');
  }
  state = next;
  document.body.dataset.runId = state.run_id;
  setConnection(true);
  const serialized = JSON.stringify(state);
  if (serialized !== lastRendered) {render(); lastRendered = serialized;}
  if (changedStage || changedRun) put('#state-announcer', `${state.campaign.state} · ${$('#director-state').textContent}`);
}
async function refresh() {
  const epoch = mutationEpoch;
  try {
    const next = await request('/api/state');
    if (epoch === mutationEpoch && !busy) acceptState(next);
  } catch (error) {
    if (epoch === mutationEpoch && !busy) setConnection(false, `공통 상태 연결 실패: ${error.message}`);
  }
}
async function action(name, extra = {}) {
  if (busy || !state || !online) return null;
  busy = true;
  ++mutationEpoch;
  renderControls();
  try {
    const next = await request('/api/action', {method: 'POST', body: JSON.stringify({action: name, run_id: state.run_id, ...extra})});
    acceptState(next);
    return next;
  } catch (error) {
    toast(`요청을 적용하지 못했습니다: ${error.message}`);
    return null;
  } finally {
    busy = false;
    renderControls();
    // A competing reset can invalidate a request. Re-read without replaying that request.
    void refresh();
  }
}
function targets() {return state?.campaign.approval?.targets || state?.approval_preview?.targets || [];}
function detected(customer) {return customer.detected === true || (typeof customer.detected === 'number' && Number.isFinite(customer.detected));}
function reason(customer) {
  if (customer.dismissed) return '이 LIVE에서 SIZE 제안 거절';
  if (state.ended) return '방송 종료';
  if (customer.current_product && String(customer.current_product) !== String(state.scope.product_id)) return '다른 상품을 보고 있음';
  if (state.campaign.approval && targets().includes(customer.id) && Number(state.now) >= Number(state.campaign.approval.expires_at)) return '300초 강조 기간 만료';
  if (customer.exclusion_reason) return customer.exclusion_reason;
  const excluded = (state.approval_preview?.excluded || []).find(row => row.id === customer.id);
  if (excluded) return excluded.reason;
  if (!detected(customer)) return 'SIZE Need 감지 조건 미충족';
  if (state.campaign.approval && targets().includes(customer.id) && !customer.highlight) return '강조 해제 · 수동 접근 가능';
  return state.campaign.approval ? '승인 시 고정된 관련 고객' : '최근 120초 내 관련 Need';
}
function customerLabel(customer) {return /^customer-[ABC]$/.test(customer.id) ? `고객 ${customer.id.slice(-1)}` : customer.label || customer.id;}
function renderControls() {
  const campaign = state?.campaign;
  const blocked = busy || !online || !state;
  const ended = state?.ended;
  const approval = campaign?.approval;
  const hasAlert = campaign && campaign.state !== 'NORMAL';
  ['#demo-start', '#demo-reset'].forEach(selector => $(selector).disabled = blocked);
  $('#demo-spike').disabled = blocked || ended || Number(state?.now) >= 120;
  $('#result-show').disabled = blocked || ended || !approval || !!campaign?.result;
  $('#expire-action').disabled = blocked || !approval || Number(state?.now) >= Number(approval?.expires_at);
  $('#end-live').disabled = blocked || ended;
  $$('[data-advance]').forEach(button => button.disabled = blocked || ended);
  $('#host-review').disabled = blocked || ended || !hasAlert || campaign?.host_delivered;
  $('#app-approve').disabled = blocked || (!hasAlert && !approval) || (ended && !approval);
  $('#approval-confirm').disabled = blocked || ended || !hasAlert || !!approval || !(state?.approval_preview?.count > 0);
  $('#host-confirm').disabled = blocked || ended || !hasAlert || campaign?.host_delivered || !$('#host-reviewed').checked || !$('#host-message').value.trim();
  $('#analytics-open').disabled = blocked;
  const noticesBlocked = blocked || !state?.integration;
  $('#notice-publish').disabled = noticesBlocked || ended || !$('#notice-text').value.trim();
  $('#notice-text').disabled = busy || ended;
  $('#notice-route').disabled = busy || ended;
  $$('[data-notice-retract]').forEach(button => button.disabled = noticesBlocked);
}
function render() {
  const {campaign, counts, now} = state;
  const stage = campaign.state;
  const approval = campaign.approval;
  const index = stages.indexOf(stage);
  const status = {NORMAL: '모니터링 중', ALERT: '관심 급증 감지', ACTION: '대응안 적용 중', RESULT: 'Simulation 결과 공개'}[stage] || stage;
  put('#director-state', state.ended ? '방송 종료' : status);
  $('#director-state').dataset.state = stage;
  $('#director-state').dataset.ended = String(!!state.ended);
  put('#clock', clock(now));
  $('#clock').dataset.now = String(now);
  put('#clock-note', `서버 가상 시계 · ${number(seconds(now))}초`);
  put('#run-id', state.run_id);
  put('#session-label', state.scope?.broadcast_id || 'GS LIVE · LOCAL DEMO');
  put('#detected-count', number(counts?.detected));
  put('#event-count', number(counts?.events));
  put('#ui-count', number(counts?.ui_events));
  put('#fixture-count', number(counts?.fixture_events));
  put('#action-count', number(state.logs?.length));
  $$('[data-step]').forEach((element, position) => {
    element.classList.toggle('active', position === index);
    element.classList.toggle('done', position < index);
    element.querySelector('.step-number').textContent = position < index ? '✓' : `0${position + 1}`;
    if (position === index) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
  });
  const evidence = campaign.evidence;
  const change = evidence?.change_percent == null ? '신규 증가' : `${evidence.change_percent >= 0 ? '+' : ''}${evidence.change_percent}%`;
  const insight = {
    NORMAL: ['분석 중', '고객의 관심을 살펴보고 있어요.', '질문과 탐색 행동을 함께 확인합니다. 의미 있는 관심 변화가 생기면 대응안을 제안합니다.', 'shield'],
    ALERT: ['확인 필요', '사이즈 관련 관심이 빠르게 늘었어요.', `연속한 60초 구간에서 새로 감지된 고객이 ${evidence?.previous_customers ?? 0}명에서 ${evidence?.current_customers ?? 0}명으로 늘었습니다 (${change}). 평소 사이즈와 반사이즈 선택 기준 안내를 제안합니다.`, 'alert'],
    ACTION: ['대응 진행', '고객에게 필요한 안내를 연결합니다.', approval ? `관련 고객 ${number(approval.count ?? approval.targets.length)}명의 기존 내 사이즈 버튼에 추천 표시를 승인했습니다. 쇼호스트 안내는 별도로 검토하고 전달할 수 있습니다.` : '쇼호스트 안내가 로컬 전달되었습니다. APP 개인화는 대상과 제외 사유를 확인한 뒤 별도로 승인할 수 있습니다.', 'spark'],
    RESULT: ['Simulation', '대응 전후의 흐름을 확인해보세요.', '질문, 내 사이즈 이용, 구매하기 클릭의 고정 비교 예시가 준비되었습니다. 효과 분석에서 세 지표의 변화를 확인할 수 있습니다.', 'check']
  }[stage] || [];
  put('#ai-badge', state.ended ? '종료됨' : insight[0]);
  put('#ai-title', state.ended ? '이번 LIVE가 종료되었습니다.' : insight[1]);
  put('#ai-description', state.ended ? '고객 화면의 추천 강조는 해제되었습니다. 기록을 확인하거나 개발자 컨트롤에서 새 실행을 시작하세요.' : insight[2]);
  $('#ai-icon').setAttribute('href', `#i-${insight[3] || 'shield'}`);
  $('#ai-panel').classList.toggle('alert', stage === 'ALERT');
  $('#action-empty').hidden = stage !== 'NORMAL';
  $('#action-options').hidden = stage === 'NORMAL';
  put('#approval-badge', stage === 'NORMAL' ? '대기 중' : `${Number(!!campaign.host_delivered) + Number(!!approval)} / 2 승인`);
  $('#host-card').classList.toggle('approved', !!campaign.host_delivered);
  $('#app-card').classList.toggle('approved', !!approval);
  put('#host-review', campaign.host_delivered ? '로컬 전달 완료' : '전달 문구 검토');
  put('#host-card-description', campaign.host_delivered ? campaign.host_text : '평소 사이즈와 반사이즈 선택 기준을 한 번 더 안내해주세요.');
  put('#app-approve', approval ? '승인 대상 및 적용 상태 보기' : '대상 확인 및 승인');
  put('#target-line', approval ? `승인 대상 ${number(approval.count ?? approval.targets.length)}명 · 승인 시 고정` : `현재 승인 가능 ${number(state.approval_preview?.count)}명 · 대상과 제외 사유 확인`);
  $('#approval-timing').hidden = !approval;
  if (approval) put('#approval-timing', `승인 ${number(approval.created_at)}초 · 만료 ${number(approval.expires_at)}초${Number(now) >= Number(approval.expires_at) ? ' · 기간 만료' : ` · ${number(Math.max(0, approval.expires_at - now))}초 남음`}`);
  const resultWait = campaign.result ? '고정 Simulation이 공개되었습니다. 실제 이용은 효과 분석 위쪽에서 계속 확인할 수 있습니다.' : approval ? '실제 승인 전후 이용은 지금 확인할 수 있습니다. 고정 예시 성과는 개발자 컨트롤의 Show Result를 눌러 공개합니다.' : '실제 고객 이용은 효과 분석에 누적됩니다. 고정 예시 성과는 APP 승인 후 Show Result를 눌러 공개합니다.';
  put('#result-instruction', resultWait);
  put('#analytics-wait', resultWait);
  renderChart(evidence);
  renderCustomers();
  renderHistory();
  renderResult();
  renderIntegration();
  renderExperience();
  if ($('#app-dialog').open) renderApproval();
  renderControls();
}
function renderChart(evidence) {
  const previous = evidence?.previous_customers;
  const current = evidence?.current_customers;
  const max = Math.max(30, Math.ceil(Math.max(previous || 0, current || 0) / 30) * 30);
  put('#chart-y-max', max); put('#chart-y-mid', max * 2 / 3); put('#chart-y-min', max / 3);
  for (const [name, count] of [['previous', previous], ['current', current]]) {
    const height = Number(count || 0) / max * 150;
    $(`#${name}-bar`).setAttribute('y', 185 - height);
    $(`#${name}-bar`).setAttribute('height', Math.max(1, height));
    $(`#${name}-bar-label`).setAttribute('y', 174 - height);
    put(`#${name}-bar-label`, count == null ? '—' : `${count}명`);
  }
  put('#signal-number', current ?? '—');
  $('#signal-change').hidden = !evidence;
  put('#signal-change', evidence?.change_percent == null ? (evidence?.spike ? '신규 증가' : '비교 기준 없음') : `${evidence.change_percent >= 0 ? '+' : ''}${evidence.change_percent}%`);
  put('#chart-desc', evidence ? `분석 시각 ${evidence.as_of}초. 직전 60초 신규 감지 ${previous}명, 현재 60초 신규 감지 ${current}명.` : '아직 공개된 급증 근거가 없습니다. 누적 Need 감지 고객 수는 위 공통 상태 집계에 표시됩니다.');
  put('#chart-description', evidence?.as_of > 0 ? `${number(evidence.as_of)}초 분석 근거 · 연속한 60초 구간` : '첫 60초 분석 대기 · 신규 Need 감지 고객 수');
  put('#previous-window', evidence?.as_of >= 120 ? `(${evidence.as_of - 120}, ${evidence.as_of - 60}]초` : '직전 60초');
  put('#current-window', evidence?.as_of >= 60 ? `(${evidence.as_of - 60}, ${evidence.as_of}]초` : '현재 60초');
  put('#evidence-badge', evidence?.spike ? '급증 조건 충족' : '관찰 중');
  $('#evidence-badge').className = `badge ${evidence?.spike ? 'amber' : 'neutral'}`;
  put('#chart-note', evidence?.spike ? '급증을 감지한 시점의 고정 근거입니다. 고객 UI와 시연 행동이 같은 감지 규칙을 통과합니다.' : `60초마다 서버가 Need를 분석합니다. 다음 분석까지 ${number(Math.max(0, Math.ceil(state.next_analysis_at - state.now)))}초${state.mode === 'demo' ? ' · 시연 시계는 Demo Control에서 진행' : ''}. 클릭 건수와 감지 고객 수는 별도입니다.`);
  put('#chart-source', '서버 Need 집계 · UI/시연 공통 규칙');
}
function renderCustomers() {
  const customers = state.customers || [];
  const activity = new Map((state.integration?.customers || []).map(customer => [customer.id, customer]));
  const available = online && !!state.integration;
  const connected = available ? customers.filter(customer => activity.get(customer.id)?.online) : [];
  const approved = !!state.campaign.approval;
  put('#connected-online-count', available ? `접속 ${number(connected.length)}명 · ${number(state.integration.presence.sessions)}개 탭` : '접속 확인 중');
  $('#connected-online-count').className = `badge ${available && connected.length ? 'mint' : 'neutral'}`;
  put('#connected-summary', !available ? '서버 연결을 확인하고 있습니다. 아래 이용 정보는 마지막으로 수신한 상태입니다.' : connected.length ? `${connected.map(customerLabel).join(' · ')} 이용 중 · 고객의 조작이 이 표에 자동 반영됩니다.` : '현재 접속한 고객 화면이 없습니다. 아래 링크로 고객 화면을 열면 접속과 이용 상태가 표시됩니다.');
  put('#highlight-count', `추천 강조 ${customers.filter(customer => customer.highlight).length}명`);
  html('#customer-body', customers.map(customer => {
    const usage = activity.get(customer.id);
    const known = available && !!usage;
    const isOnline = known && usage.online;
    const currentView = usage?.active_result || 'live';
    const selection = usage?.selection;
    const view = currentView === 'live' ? 'LIVE 화면' : routeNames[currentView] || '상품 정보';
    const media = {image: '상품 이미지', video: '참고 영상', reference: '참고 영상'}[usage?.media_mode] || '—';
    const direction = {portrait: '세로', landscape: '가로'}[usage?.orientation] || '—';
    const status = !known ? '연결 확인 중' : isOnline ? `접속 중 · ${number(usage.sessions)}개 탭` : '미접속';
    const lastEvent = usage?.last_event ? activityNames[usage.last_event] || usage.last_event : '아직 이용 없음';
    const target = targets().includes(customer.id);
    return `<tr data-customer="${escapeHTML(customer.id)}" data-highlight="${!!customer.highlight}" data-detected="${detected(customer)}" data-online="${known ? !!usage.online : 'unknown'}" data-events="${usage?.events ?? ''}" data-current-view="${usage ? escapeHTML(currentView) : 'unknown'}" data-last-event="${escapeHTML(usage?.last_event || '')}"><td><strong>${escapeHTML(customerLabel(customer))}</strong><br><span class="badge ${isOnline ? 'mint' : 'neutral'}">${status}</span><br><small>${escapeHTML(customer.id)}</small></td><td class="connected-current"><strong>${escapeHTML(view)}</strong>${!isOnline && usage ? '<small>마지막 수신 상태</small>' : ''}<span>${selection ? `${escapeHTML(selection.color)} / ${escapeHTML(selection.size)}` : '선택 정보 대기'}</span><small>${escapeHTML(lookLabel(selection?.look))}</small><small>${media} · ${direction}</small></td><td class="connected-last"><strong>${escapeHTML(lastEvent)}</strong><span>${usage ? `${number(usage.events)}건 이용` : '이용 정보 대기'}</span><small>${usage?.last_at == null ? '—' : `LIVE ${clock(usage.last_at)}`}</small></td><td><span class="badge ${detected(customer) ? 'mint' : 'neutral'}">${detected(customer) ? '감지됨' : '미감지'}</span></td><td>${target ? approved ? '승인 대상' : '승인 가능' : '제외'}</td><td><span class="badge ${customer.highlight ? 'mint' : 'neutral'}">${customer.highlight ? '추천 강조 중' : '기본 표시'}</span></td><td>${escapeHTML(reason(customer))}</td></tr>`;
  }).join('') || '<tr><td colspan="7">연결된 고객이 없습니다.</td></tr>');
}
function renderApproval() {
  if (!state) return;
  const approval = state.campaign.approval;
  const selected = targets();
  put('#segment-badge', `${approval ? '승인 대상' : '승인 예정'} ${number(selected.length)}명`);
  put('#approval-asof', approval ? `${number(approval.created_at)}초에 대상 고정` : `현재 ${number(state.now)}초 기준`);
  put('#approval-confirm', approval ? '이미 승인된 액션' : `승인하고 ${number(selected.length)}명에게 적용`);
  $('#approval-confirm').hidden = !!approval;
  const customers = state.customers || [];
  const displayed = new Set(customers.map(customer => customer.id));
  const rows = customers.map(customer => `<tr><td><strong>${escapeHTML(customerLabel(customer))}</strong></td><td><span class="badge ${selected.includes(customer.id) ? 'mint' : 'neutral'}">${selected.includes(customer.id) ? '대상' : '제외'}</span></td><td>${escapeHTML(reason(customer))}</td></tr>`);
  const otherTargets = selected.filter(id => !displayed.has(id));
  if (otherTargets.length) rows.push(`<tr><td>그 외 가상 고객</td><td><span class="badge mint">${number(otherTargets.length)}명 대상</span></td><td>최근 120초 내 관련 Need · 거절 없음</td></tr>`);
  for (const excluded of state.approval_preview?.excluded || []) {
    if (!displayed.has(excluded.id)) rows.push(`<tr><td>${escapeHTML(excluded.id)}</td><td><span class="badge neutral">제외</span></td><td>${escapeHTML(excluded.reason)}</td></tr>`);
  }
  html('#segment-body', rows.join(''));
  put('#target-ids', selected.length ? selected.join(' · ') : '현재 조건을 만족하는 대상이 없습니다.');
  renderPreview();
  renderControls();
}
function renderPreview() {
  const customer = (state?.customers || []).find(row => row.id === $('#preview-customer').value);
  if (!customer) {html('#customer-preview', '<p class="preview-note">해당 고객 상태를 기다리고 있습니다.</p>'); return;}
  const approved = !!state.campaign.approval;
  const highlight = approved ? customer.highlight : targets().includes(customer.id);
  html('#customer-preview', `<div class="quick-preview"><p class="preview-caption">${escapeHTML(customerLabel(customer))} · ${approved ? '현재 적용 상태' : '승인 후 버튼 표시 예시'}</p><div class="quick-row"><div class="quick-button ${highlight ? 'recommended' : ''}" aria-label="내 사이즈${highlight ? ', 추천 강조' : ', 기본 표시'}">${highlight ? '<span class="quick-recommend">추천</span>' : ''}${icon('users')}<strong>내 사이즈</strong></div><div class="quick-button">${icon('spark')}<strong>코디 추천</strong></div><div class="quick-button">${icon('shield')}<strong>내 혜택</strong></div></div><p class="preview-note">${highlight ? '기존 내 사이즈 버튼에 테두리와 추천 표시만 적용' : escapeHTML(reason(customer)) + ' · 버튼은 기본 표시'}<br>고객이 직접 눌러 기존 사이즈 결과를 확인합니다.</p></div>`);
}
const actionNames = {
  RESET: '새 실행 초기화', reset: '새 실행 초기화', demo_start: 'Need Demo 시작', DEMO_START: 'Need Demo 시작', demo_spike: 'Director Spike 재생', DEMO_SPIKE: 'Director Spike 재생',
  NEED_DETECTED: '개인 SIZE Need 감지', ALERT: '사이즈 관심 급증 감지', approve_app: 'APP 개인화 승인', APP_APPROVED: 'APP 개인화 승인',
  host_deliver: '쇼호스트 안내 로컬 전달', HOST_DELIVERED: '쇼호스트 안내 로컬 전달', show_result: 'Simulation 결과 공개', RESULT: 'Simulation 결과 공개', advance: '가상 시계 진행', end: '방송 종료',
  notice_publish: '공용 안내 게시', NOTICE_PUBLISHED: '공용 안내 게시', notice_retract: '공용 안내 회수', NOTICE_RETRACTED: '공용 안내 회수',
  ANALYSIS: '60초 Need 분석', ADVANCE: '가상 시계 진행', PRODUCT_SWITCH: '고객 상품 전환', BROADCAST_END: '방송 종료'
};
function logDetail(detail) {
  if (detail == null) return '';
  if (typeof detail !== 'object') return String(detail);
  // Render only explicitly public fields; customer prose and arbitrary payloads stay private.
  const parts = [];
  if (detail.customer_id) parts.push(customerLabel({id: detail.customer_id}));
  if (detail.product_id) parts.push(`상품 ${detail.product_id}`);
  if (detail.from_product && detail.to_product) parts.push(`상품 ${detail.from_product} → ${detail.to_product}`);
  if (detail.intent) parts.push(`질문 유형 ${intentNames[detail.intent] || detail.intent}`);
  if (detail.metadata) {const info = activityMetadata(detail.metadata); if (info) parts.push(info);}
  const outcomes = {IGNORED: '이용 기록 완료 · SIZE 신호 아님', SIGNAL_RECORDED: 'SIZE 신호 기록', NEED_DETECTED: 'SIZE Need 감지', ALREADY_DETECTED: '이미 감지된 고객의 후속 이용', DISMISSED: 'SIZE 제안 거절', SIZE_RESULT: '제안 수락 · 사이즈 안내 연결', DUPLICATE: '중복 제외'};
  if (detail.outcome) parts.push(detail.outcome === 'IGNORED' && detail.event_type === 'AI_SUGGESTION_ACCEPT' ? '현재 수락할 제안 없음' : outcomes[detail.outcome] || detail.outcome);
  if (detail.previous_customers != null && detail.current_customers != null) parts.push(`이전 ${number(detail.previous_customers)}명 → 현재 ${number(detail.current_customers)}명`);
  if (detail.spike != null) parts.push(detail.spike ? '급증 조건 충족' : '급증 조건 미충족');
  if (detail.target_count != null) parts.push(`승인 대상 ${number(detail.target_count)}명`);
  if (detail.expires_at != null) parts.push(`강조 만료 ${number(detail.expires_at)}초`);
  if (detail.seconds != null) parts.push(`가상 시계 +${number(detail.seconds)}초`);
  if (detail.notice_id) parts.push(`안내 ${detail.notice_id}`);
  return parts.join(' · ');
}
function renderHistory() {
  // Server append order breaks ties when virtual time is frozen.
  const logs = [...(state.logs || [])].reverse();
  put('#log-count', `최근 ${number(logs.length)}건 · 최대 300건`);
  html('#event-log', logs.map(log => {
    const origin = String(log.origin || 'server');
    const originName = {ui: '고객 UI', fixture: '시연 Fixture', director: 'PD 액션', system: '시스템', server: '서버', demo: '시연 제어', control: '시연 제어'}[origin.toLowerCase()] || origin;
    return `<div class="history-row" data-sequence="${Number(log.sequence) || ''}" data-action="${escapeHTML(log.action)}" data-origin="${escapeHTML(origin)}"><span class="time mono">${clock(log.at)}<br><small>${number(log.at)}초</small></span><div><strong>${escapeHTML(actionNames[log.action] || activityNames[log.action] || log.action)}</strong><p>${escapeHTML(logDetail(log.detail))}</p><code>${escapeHTML(log.action)}</code></div><span class="badge ${origin.toLowerCase() === 'ui' ? 'mint' : origin.toLowerCase() === 'fixture' ? 'purple' : 'neutral'}">${escapeHTML(originName)}</span></div>`;
  }).join('') || '<p class="muted label">아직 기록된 액션이 없습니다. 고객 화면의 행동이 이곳에 반영됩니다.</p>');
}
function renderResult() {
  const result = state.campaign.result;
  const ready = !!result && !!state.campaign.approval && Number(state.now) >= Number(state.campaign.approval.created_at) + 30;
  $('#analytics-empty').hidden = ready;
  $('#analytics-content').hidden = !ready;
  if (!ready) return;
  const prepared = bootstrap?.demo?.director_result?.metrics || [];
  const metrics = result.metrics?.length ? result.metrics : prepared;
  html('#result-metrics', metrics.map(metric => {
    const before = Number(metric.before);
    const after = Number(metric.after);
    const change = metric.change_percent ?? metric.change_percent_rounded ?? Math.round((after / before - 1) * 100);
    const max = Math.max(before, after, 1);
    return `<article class="card result-card"><span class="badge purple">Prototype Simulation</span><h3>${escapeHTML(metric.label_ko || metric.label)}</h3><div class="result-values mono"><span class="before">${number(before)}</span>${icon('arrow')}<span class="after">${number(after)}</span></div><span class="improvement">${change < 0 ? '−' : '+'}${Math.abs(change)}% · ${escapeHTML(metric.unit_ko || '건')}</span><p>고정된 전후 60초 비교 예시</p><div class="result-bars" aria-hidden="true"><div style="width:${before / max * 100}%"></div><div style="width:${after / max * 100}%"></div></div></article>`;
  }).join(''));
}
const activityNames = {
  LIVE_ENTER: 'LIVE 입장', ASK_LIVE_SUBMIT: 'ASK LIVE 질문', SIZE_RESULT_VIEW: '내 사이즈 보기',
  BENEFIT_RESULT_VIEW: '내 혜택 보기', STYLING_RESULT_VIEW: '코디 추천 보기',
  PRODUCT_DETAIL_OPEN: '상품 상세 열기', PRODUCT_DETAIL_VIEW: '상품 상세 보기', SIZE_TAB_OPEN: '사이즈 탭 열기',
  REVIEW_SIZE_VIEW: '사이즈 리뷰 보기', REVIEW_VIEW: '리뷰 보기', PRODUCT_INQUIRY_CLICK: '상품 문의',
  OPTION_SELECT: '옵션 선택 변경', STYLING_LOOK_CHANGE: '코디 선택 변경', LOOK_SELECT: '코디 선택',
  STYLING_PRODUCT_CLICK: '코디 상품 클릭', PURCHASE_CLICK: '구매하기 클릭', PURCHASE_DEMO_COMPLETE: '구매 체험 완료',
  AI_SUGGESTION_SHOWN: 'AI 제안 표시', AI_SUGGESTION_ACCEPT: 'AI 제안 수락', AI_SUGGESTION_DISMISS: 'AI 제안 거절',
  QUICK_ACTION_CLICK: '빠른 버튼 클릭', LIVE_RETURN: 'LIVE 화면 복귀', PRODUCT_IMAGE_VIEW: '상품 이미지 넘기기',
  ORIENTATION_CHANGE: '화면 방향 변경', MEDIA_MODE_CHANGE: '이미지·영상 전환', MEDIA_PLAY: '영상 재생',
  MEDIA_PAUSE: '영상 일시 정지', MEDIA_ERROR: '미디어 오류', BENEFIT_DETAIL_OPEN: '혜택 상세 열기',
  STYLING_OPEN: '코디 열기', BENEFIT_VIEW: '혜택 보기', STYLING_VIEW: '코디 보기',
  CART_ADD: '장바구니 담기', CART_UPDATE: '장바구니 변경', CART_REMOVE: '장바구니 삭제', CART_OPEN: '장바구니 열기',
  COMMENT_PUBLISH: '공개 댓글 게시', SHARE_COPY: '공유 링크 복사', STYLING_ALL_OPEN: '전체 코디 상품 보기',
  PERSONALIZATION_SHOWN: 'APP 추천 표시 확인', VIDEO_SCENE_SEEK: '영상 장면 이동', PROFILE_UPDATE: '개인 사이즈 기준 저장'
};
const intentNames = {
  SIZE_GUIDANCE: '사이즈 안내', BENEFIT: '혜택', STYLING: '코디', PRODUCT_REVIEW: '상품 리뷰',
  PRODUCT_THICKNESS: '상품 두께', PRODUCT_COLOR: '상품 컬러', DELIVERY: '배송',
  UNSUPPORTED: '지원 범위 밖 질문', UNSUPPORTED_VIDEO: '영상 확인 질문',
  AMBIGUOUS_FOLLOWUP: '맥락 확인 필요', CLARIFICATION: '질문 선택 안내'
};
const routeNames = {size: '내 사이즈', benefit: '내 혜택', styling: '코디 추천', detail: '상품 상세', purchase: '구매 체험', guide: '체험 안내', complete: '주문 체험 완료', cart: '장바구니', styling_all: '전체 코디 상품'};
const actualMetrics = [
  ['events', '전체 이용 행동', '중복을 제외한 UI 행동', '건'],
  ['customers', '이용 고객', '행동이 기록된 고유 고객', '명'],
  ['asks', 'ASK LIVE 질문', '실제 질문 요청', '건'],
  ['size_views', '내 사이즈 보기', '사이즈 결과 이용', '건'],
  ['benefit_views', '내 혜택 보기', '혜택 결과 이용', '건'],
  ['styling_views', '코디 추천 보기', '코디 결과 이용', '건'],
  ['detail_views', '상품 상세 열기', '상품 상세 화면 진입', '건'],
  ['purchase_clicks', '구매하기 클릭', '구매 체험 화면 진입', '건'],
  ['purchase_completions', '구매 체험 완료', '실제 주문은 생성하지 않음', '건'],
  ['media_errors', '미디어 오류', '이미지·영상 오류 수신', '건']
];
function lookLabel(value) {
  const look = bootstrap?.looks?.looks?.find(item => item.look_id === value);
  return look ? `${look.mood_name} · ${value.replace('LOOK_', 'LOOK ')}` : value || '—';
}
function productLabel(value) {
  return bootstrap?.candidates?.products?.find(item => String(item.product_id) === String(value))?.product_name || `상품 ${value}`;
}
function distribution(selector, rows, label, attribute = 'value') {
  const maximum = Math.max(1, ...rows.map(row => Number(row.count) || 0));
  html(selector, rows.length ? rows.map(row => {
    const value = row[attribute];
    const count = Math.max(0, Number(row.count) || 0);
    return `<div class="distribution-row" data-${attribute}="${escapeHTML(value)}" data-count="${count}"><div><span>${escapeHTML(label(value))}</span><strong class="mono">${number(count)}<small>건</small></strong></div><div class="distribution-track" aria-hidden="true"><span style="width:${count / maximum * 100}%"></span></div></div>`;
  }).join('') : '<p class="activity-empty">아직 기록된 이용이 없습니다.</p>');
}
function activityMetadata(metadata = {}) {
  // Only display fields in the public contract; never stringify unknown customer data.
  const labels = {color: '컬러', size: '사이즈', look: '코디', image_index: '이미지', orientation: '화면', media_mode: '미디어', product_id: '상품', tab: '탭', action: '버튼', kind: '종류'};
  return Object.entries(labels).filter(([key]) => metadata[key] != null).map(([key, label]) => {
    const value = metadata[key];
    const formatted = key === 'look' ? lookLabel(value) : key === 'image_index' ? Number(value) + 1 : key === 'orientation' ? ({portrait: '세로', landscape: '가로'}[value] || value) : ['media_mode', 'kind'].includes(key) ? ({image: '이미지', video: '영상'}[value] || value) : ['tab', 'action'].includes(key) ? ({...routeNames, reviews: '리뷰', info: '상품 정보'}[value] || value) : value;
    return `${label} ${formatted}`;
  }).join(' · ');
}
function renderIntegration() {
  const integration = state.integration;
  const available = !!integration;
  const totals = integration?.totals || {};
  const presence = integration?.presence || {};
  const presenceKnown = available && online;
  const notices = integration?.notices || [];
  const active = notices.filter(notice => notice.active);
  $('#integration-unavailable').hidden = available;
  put('#presence-online', presenceKnown ? number(presence.online_customers) : '—');
  put('#presence-sessions', presenceKnown ? `${number(presence.sessions)}개 탭` : '접속 확인 중');
  $('#presence-dot').classList.toggle('active', presenceKnown && !!presence.online_customers);
  put('#integration-ask-total', available ? number(totals.asks) : '—');
  put('#integration-notice-total', available ? number(active.length) : '—');
  put('#notice-active-count', `게시 중 ${number(active.length)}건`);
  put('#integration-scope', available ? `${integration.scope?.broadcast_id || state.scope.broadcast_id} · 상품 ${integration.scope?.product_id || state.scope.product_id} · 준비된 시연 행동은 제외` : '고객 이용 데이터 연결 대기');
  put('#integration-source', available ? `${online ? '' : '마지막 수신 · '}${integration.source}` : '연결 대기');
  html('#integration-metrics', actualMetrics.map(([key, label, note, unit]) => `<article class="card activity-metric" data-metric="${key}" data-count="${available ? Number(totals[key]) || 0 : ''}"><span>${label}</span><strong class="mono">${available ? number(totals[key]) : '—'}<small>${unit}</small></strong><p>${note}</p></article>`).join(''));
  distribution('#intent-breakdown', integration?.intents || [], value => intentNames[value] || value, 'intent');
  for (const category of ['colors', 'sizes', 'looks']) distribution(`#selection-${category}`, integration?.selections?.[category] || [], value => category === 'looks' ? lookLabel(value) : value);
  distribution('#linked-products', integration?.linked_products || [], value => `${productLabel(value)} (${value})`, 'product_id');
  const response = integration?.response || {};
  html('#response-counts', [['pending', '처리 중'], ['completed', '완료'], ['fallback', '준비 답변 대체'], ['cancelled', '취소']].map(([key, label]) => `<div data-response="${key}" data-count="${available ? Number(response[key]) || 0 : ''}"><span>${label}</span><strong class="mono">${available ? number(response[key]) : '—'}<small>건</small></strong></div>`).join(''));
  put('#activity-session-count', presenceKnown ? `${number(presence.sessions)}개 탭 연결` : '접속 확인 중');
  html('#activity-customer-body', (integration?.customers || []).map(customer => {
    const selection = customer.selection || {};
    const view = customer.active_result ? routeNames[customer.active_result] || customer.active_result : 'LIVE 화면';
    const direction = {portrait: '세로', landscape: '가로'}[customer.orientation] || '—';
    return `<tr data-customer="${escapeHTML(customer.id)}" data-online="${presenceKnown ? !!customer.online : 'unknown'}" data-events="${Number(customer.events) || 0}"><td><strong>${escapeHTML(customerLabel(customer))}</strong><br><span class="badge ${presenceKnown && customer.online ? 'mint' : 'neutral'}">${!presenceKnown ? '연결 확인 중' : customer.online ? `접속 중 · ${number(customer.sessions)}개 탭` : '접속 없음'}</span></td><td>${escapeHTML(view)}<br><small>${direction}</small></td><td>${escapeHTML(selection.color || '—')} / ${escapeHTML(selection.size || '—')}</td><td>${escapeHTML(lookLabel(selection.look))}<br><small>${{image: '상품 이미지', video: '참고 영상'}[customer.media_mode] || '—'}</small></td><td>${escapeHTML(activityNames[customer.last_event] || customer.last_event || '아직 이용 없음')}<br><small>${customer.last_at == null ? '—' : `가상 ${clock(customer.last_at)}`}</small></td><td class="mono">${number(customer.events)}건</td></tr>`;
  }).join('') || '<tr><td colspan="6">고객 이용 데이터 연결을 기다리고 있습니다.</td></tr>');
  const counts = Object.entries(integration?.event_counts || {}).map(([value, count]) => ({value, count})).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  distribution('#activity-event-counts', counts, value => activityNames[value] || value);
  put('#activity-event-total', `${number(totals.events)}건`);
  const recent = integration?.recent || [];
  put('#recent-count', `${number(recent.length)}건`);
  html('#recent-activity', recent.map(row => `<div class="recent-row" data-event-type="${escapeHTML(row.event_type)}"><time class="mono">${clock(row.at)}</time><span class="badge neutral">${escapeHTML(customerLabel({id: row.customer_id}))}</span><div><strong>${escapeHTML(activityNames[row.event_type] || row.event_type)}</strong><p>${escapeHTML(activityMetadata(row.metadata))}</p></div></div>`).join('') || '<p class="activity-empty">고객 화면의 행동이 이곳에 실시간으로 반영됩니다.</p>');
  html('#notice-list', [...notices].reverse().map(notice => `<article class="notice-item ${notice.active ? '' : 'retracted'}" data-notice-id="${escapeHTML(notice.notice_id)}" data-active="${!!notice.active}" data-seen-count="${Number(notice.seen_count) || 0}"><div class="between"><span class="badge ${notice.active ? 'mint' : 'neutral'}">${notice.active ? '게시 중' : '회수됨'}</span><span class="notice-time">${clock(notice.created_at)}</span></div><p class="notice-message">${escapeHTML(notice.text)}</p>${notice.route ? `<span class="notice-route">연결 버튼 · ${escapeHTML(routeNames[notice.route] || notice.route)}</span>` : ''}<div class="notice-item-foot"><span>표시 고객 <strong>${number(notice.seen_count)}명</strong>${notice.seen_by?.length ? ` · ${notice.seen_by.map(id => escapeHTML(customerLabel({id}))).join(', ')}` : ''}</span>${notice.active ? `<button class="btn outline" type="button" data-notice-retract="${escapeHTML(notice.notice_id)}">안내 회수</button>` : '<span>고객 화면에서 제거됨</span>'}</div></article>`).join('') || '<p class="activity-empty">아직 게시한 공용 안내가 없습니다.</p>');
  const measured = integration?.measured || {};
  const approved = measured.approval_at != null;
  put('#measured-timing', available ? approved ? `APP 승인: 가상 ${clock(measured.approval_at)} · 이번 실행의 누적 행동` : '아직 APP 승인이 없습니다. 현재 행동은 승인 전 누적에 포함됩니다.' : '고객 이용 데이터 연결을 기다리고 있습니다.');
  html('#measured-body', [['asks', 'ASK LIVE 질문'], ['size_views', '내 사이즈 보기'], ['purchase_clicks', '구매하기 클릭'], ['purchase_completions', '구매 체험 완료']].map(([key, label]) => `<tr data-measured="${key}" data-before="${available ? Number(measured.before?.[key]) || 0 : ''}" data-after="${available && approved ? Number(measured.after?.[key]) || 0 : ''}"><th scope="row">${label}</th><td class="mono">${available ? `${number(measured.before?.[key])}건` : '—'}</td><td class="mono">${available && approved ? `${number(measured.after?.[key])}건` : '승인 대기'}</td></tr>`).join(''));
}
const monitorColors = {size: '#c5a0ff', benefit: '#f1a58d', delivery: '#78b5e5', product: '#76d4d5', other: '#c8b3d8'};
const hiddenMonitorCategories = new Set();
function renderExperience() {
  const monitor = state.integration?.monitor;
  const available = !!monitor;
  const viewers = monitor?.viewers || {};
  const conversion = monitor?.conversion || {};
  const insight = monitor?.insight || {};
  const categories = monitor?.trend?.categories || [];
  put('#experience-source', available ? `${online ? '' : '마지막 수신 · '}${monitor.source} · ${clock(monitor.as_of)}` : '실제 수신 데이터 연결 대기');
  put('#monitor-viewers', available && online ? `${number(viewers.online_customers)}명` : '—');
  put('#monitor-viewer-note', available && online ? `${number(viewers.sessions)}개 탭 · 누적 방문 ${number(viewers.unique_visitors)}명` : '고유 고객 · 접속 확인 중');
  put('#monitor-comments', available ? `${number(monitor.comments.total)}건` : '—');
  put('#monitor-leading-category', categories.find(item => item.id === insight.category)?.label || '질문 대기');
  put('#monitor-leading-note', available ? `최근 5분 ${number(insight.current_count)}건 · 확정 Need와 별도` : '실제 질문 분류를 집계합니다');
  put('#monitor-conversion', conversion.rate_percent == null ? '—' : `${conversion.rate_percent}%`);
  put('#monitor-conversion-note', available ? `누적 방문 ${number(conversion.visitor_customers)}명 중 체험 완료 ${number(conversion.completed_customers)}명` : '실제 결제·매출 전환율과 구분');
  $('#monitor-conversion').dataset.rate = conversion.rate_percent == null ? '' : String(conversion.rate_percent);
  const questions = monitor?.top_questions || [];
  html('#monitor-top-questions', questions.length ? questions.map((row, index) => `<li data-topic="${escapeHTML(row.topic_id)}" data-count="${Number(row.count) || 0}"><span class="question-rank">${index + 1}</span><span>${escapeHTML(row.label)}</span><strong class="mono">${number(row.count)}<small>건</small></strong></li>`).join('') : '<li class="experience-empty">아직 접수된 질문이 없습니다.</li>');
  put('#monitor-insight', insight.text || '고객의 다음 질문을 기다리고 있어요.');
  put('#monitor-insight-status', {empty: '관찰 중', new: '신규 관심', increase: '증가', decrease: '감소', steady: '유지'}[insight.status] || '관찰 중');
  $('#monitor-insight').dataset.status = insight.status || 'empty';
  const comments = (state.integration?.comments || []).slice(-5).reverse();
  put('#monitor-comment-list-count', `${number(comments.length)}건`);
  html('#monitor-public-comments', comments.map(comment => `<article data-comment-id="${escapeHTML(comment.comment_id)}"><span>${escapeHTML(customerLabel({id: comment.customer_id}))}<time>수신 ${clock(comment.received_at)}</time></span><p>${escapeHTML(comment.text)}</p></article>`).join('') || '<p class="experience-empty">아직 공개 댓글이 없습니다.</p>');
  renderMonitorTrend(monitor?.trend, monitor?.as_of || 0);
  const host = monitor?.actions?.host || {};
  const app = monitor?.actions?.app || {};
  put('#action-outcome-status', !available ? '연결 대기' : state.ended ? '방송 종료' : app.approved && host.delivered ? '두 액션 승인 완료' : app.approved || host.delivered ? '액션 적용 중' : '승인 대기');
  put('#outcome-host-status', host.delivered ? '쇼호스트 로컬 전달 완료' : '전달 대기');
  put('#outcome-host-detail', host.delivered ? `가상 LIVE ${clock(host.delivered_at)}에 전달했습니다. 외부 송출은 포함하지 않습니다.` : '전달 문구를 확인한 뒤 독립적으로 승인할 수 있습니다.');
  put('#outcome-app-status', !app.approved ? 'APP 승인 대기' : state.ended ? '방송 종료 · 강조 해제' : app.active ? 'APP 개인화 적용 중' : '적용 기간 종료');
  put('#outcome-app-detail', app.approved ? `가상 LIVE ${clock(app.approved_at)} 승인 · 대상 ${number(app.target_count)}명 · 만료 ${clock(app.expires_at)}` : '관련 고객에게 기존 내 사이즈 버튼의 추천 표시를 적용합니다.');
  put('#outcome-exposure', available ? `추천 표시를 확인한 실제 고객 ${number(app.exposed_customers)}명 · 현재 강조 중인 연결 고객 ${number(app.highlighted_customers)}명. 승인 대상에는 준비된 시연 고객이 포함될 수 있습니다.` : '승인 대상 수와 실제 고객 화면 표시 수를 따로 확인합니다.');
  $('#outcome-app').dataset.exposed = String(app.exposed_customers || 0);
  $('#outcome-app').dataset.targets = String(app.target_count || 0);
  $('#outcome-host').classList.toggle('completed', !!host.delivered);
  $('#outcome-app').classList.toggle('completed', !!app.approved);
  const outcomes = monitor?.outcomes;
  const before = outcomes?.before || {};
  const after = outcomes?.after || {};
  put('#actual-outcomes-timing', !outcomes ? '실제 고객 이용을 기다리고 있습니다.' : outcomes.approved ? `가상 LIVE ${clock(outcomes.approval_at)}의 APP 승인을 기준으로 구분한 누적 이용입니다.` : '아직 APP 승인이 없습니다. 현재 이용은 승인 전 구간에 포함됩니다.');
  html('#actual-outcomes-cards', [
    ['size_questions', '사이즈 질문', '건', 'SIZE_GUIDANCE로 분류된 실제 ASK 요청'],
    ['detail_views', '상품 상세 조회', '건', '고객이 상품 상세를 연 횟수'],
    ['completion_rate', '구매 체험 완료율', '%', '각 구간 참여 고객 중 구매 체험 완료율'],
  ].map(([metric, label, unit, note]) => {
    const key = metric === 'completion_rate' ? 'completion_rate_percent' : metric;
    const beforeValue = before[key];
    const afterValue = after[key];
    const display = (value, ready) => !ready ? '승인 대기' : value == null ? '—' : `${number(value)}${unit}`;
    const ratio = metric === 'completion_rate' ? `<div class="outcome-ratio"><span>승인 전 ${number(before.completed_customers)} / ${number(before.active_customers)}명</span><span>${outcomes?.approved ? `승인 후 ${number(after.completed_customers)} / ${number(after.active_customers)}명` : '승인 후 집계 대기'}</span></div>` : '';
    return `<article data-outcome-metric="${metric}" data-before="${beforeValue ?? ''}" data-after="${outcomes?.approved ? afterValue ?? '' : ''}"><h3>${label}</h3><div class="actual-outcome-values"><div><small>승인 전 누적</small><strong>${outcomes ? display(beforeValue, true) : '—'}</strong></div>${icon('arrow')}<div><small>승인 후 누적</small><strong>${display(afterValue, !!outcomes?.approved)}</strong></div></div><p>${note}</p>${ratio}</article>`;
  }).join(''));
}
function renderMonitorTrend(trend, now) {
  const categories = trend?.categories || [];
  const buckets = trend?.buckets || [];
  html('#monitor-legend', categories.map(item => `<button type="button" data-monitor-category="${escapeHTML(item.id)}" aria-pressed="${!hiddenMonitorCategories.has(item.id)}"><i style="background:${monitorColors[item.id] || '#fff'}"></i>${escapeHTML(item.label)}</button>`).join(''));
  const visible = categories.filter(item => !hiddenMonitorCategories.has(item.id));
  const maximum = Math.max(2, ...buckets.flatMap(bucket => visible.map(item => Number(bucket.counts[item.id]) || 0)));
  const ceiling = Math.ceil(maximum / 2) * 2;
  const x = index => 40 + (buckets.length > 1 ? index / (buckets.length - 1) * 552 : 276);
  const y = count => 195 - count / ceiling * 155;
  let plot = [0, ceiling / 2, ceiling].map(value => `<path d="M40 ${y(value)}H592" class="monitor-grid"/><text x="29" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join('');
  for (const item of visible) {
    const points = buckets.map((bucket, index) => `${x(index)},${y(bucket.counts[item.id] || 0)}`).join(' ');
    const color = monitorColors[item.id] || '#fff';
    plot += `<g data-series="${escapeHTML(item.id)}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>${buckets.map((bucket, index) => `<circle cx="${x(index)}" cy="${y(bucket.counts[item.id] || 0)}" r="3" fill="${color}"><title>${escapeHTML(item.label)} · 수신 ${clock(bucket.start)}–${clock(Math.min(bucket.end, now))} · ${number(bucket.counts[item.id])}건</title></circle>`).join('')}</g>`;
  }
  if (buckets.length) plot += `<text x="40" y="225">${clock(buckets[0].start)}</text><text x="592" y="225" text-anchor="end">${clock(now)}</text>`;
  html('#monitor-trend-plot', plot);
  put('#monitor-trend-desc', categories.map(item => `${item.label} ${number(buckets.reduce((sum, bucket) => sum + (Number(bucket.counts[item.id]) || 0), 0))}건`).join(', ') || '아직 실제 질문이 없습니다.');
}
$('#monitor-legend').addEventListener('click', event => {
  const button = event.target.closest('[data-monitor-category]');
  if (!button) return;
  const category = button.dataset.monitorCategory;
  if (hiddenMonitorCategories.has(category)) hiddenMonitorCategories.delete(category);
  else hiddenMonitorCategories.add(category);
  renderMonitorTrend(state?.integration?.monitor?.trend, state?.integration?.monitor?.as_of || 0);
});
function openDialog(selector) {
  const dialog = $(selector);
  dialogTriggers.set(dialog, document.activeElement);
  if (!dialog.open) dialog.showModal();
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('close', () => {
    const trigger = dialogTriggers.get(dialog);
    if (trigger?.isConnected && !trigger.disabled) trigger.focus({preventScroll: true});
    else $('.nav [data-view="monitor"]').focus({preventScroll: true});
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
});
$('#demo-start').addEventListener('click', async () => {if (await action('demo_start')) {switchView('monitor'); toast('새 실행에서 준비 이벤트를 68초까지 재생했습니다.');}});
$('#demo-spike').addEventListener('click', async () => {if (await action('demo_spike')) {switchView('monitor'); toast('남은 준비 이벤트를 120초까지 이어 재생했습니다.');}});
$('#demo-reset').addEventListener('click', async () => {if (await action('reset')) {switchView('monitor'); toast('이벤트·거절·승인·강조·결과·시계가 초기화되었습니다.');}});
$('#result-show').addEventListener('click', async () => {if (await action('show_result')) {switchView('analytics'); toast('가상 시계를 승인 +30초까지 진행해 고정 Simulation을 공개했습니다.');}});
$('#expire-action').addEventListener('click', async () => {
  const expires = state?.campaign.approval?.expires_at;
  if (expires == null) return;
  if (await action('advance', {seconds: Math.max(0, Number(expires) - Number(state.now))})) {switchView('monitor'); toast('가상 시계가 승인 +300초에 도달해 추천 강조가 만료되었습니다.');}
});
$$('[data-advance]').forEach(button => button.addEventListener('click', async () => {if (await action('advance', {seconds: Number(button.dataset.advance)})) toast(`가상 시계를 ${button.dataset.advance}초 진행했습니다.`);}));
$('#end-live').addEventListener('click', async () => {if (await action('end')) toast('방송이 종료되어 고객의 추천 강조가 해제되었습니다.');});
$('#app-approve').addEventListener('click', async () => {await refresh(); if (!online || !state) return; renderApproval(); openDialog('#app-dialog');});
$('#preview-customer').addEventListener('change', renderPreview);
$('#approval-confirm').addEventListener('click', async () => {
  if (!state || state.campaign.approval) return;
  const next = await action('approve_app', {approval_id: `${state.run_id}:director-size-approval`});
  if (next) {$('#app-dialog').close(); toast(`${number(next.campaign.approval?.count ?? next.campaign.approval?.targets?.length)}명을 승인 대상으로 고정했습니다. 기존 내 사이즈 버튼에 추천 강조가 적용됩니다.`);}
});
$('#host-review').addEventListener('click', () => {
  $('#host-message').value = state.campaign.host_text || $('#host-message').value;
  $('#host-reviewed').checked = false;
  renderControls();
  openDialog('#host-dialog');
});
$('#host-message').addEventListener('input', () => {$('#host-reviewed').checked = false; renderControls();});
$('#host-reviewed').addEventListener('change', renderControls);
$('#host-confirm').addEventListener('click', async () => {
  if (!$('#host-reviewed').checked) return;
  if (await action('host_deliver', {text: $('#host-message').value.trim()})) {$('#host-dialog').close(); toast('확인한 문구가 로컬 Simulation으로 전달되었습니다.');}
});
$('#notice-text').addEventListener('input', () => {
  put('#notice-length', `${$('#notice-text').value.length} / 500`);
  renderControls();
});
$('#notice-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !state || !online || state.ended || !state.integration) return;
  const text = $('#notice-text').value.trim();
  if (!text || text.length > 500) return;
  const route = $('#notice-route').value || null;
  const fingerprint = JSON.stringify([state.run_id, text, route]);
  // Keep the same identifier after an uncertain HTTP result, so retrying cannot post twice.
  if (noticeDraftRequest?.fingerprint !== fingerprint) noticeDraftRequest = {fingerprint, run_id: state.run_id, notice_id: `notice-${crypto.randomUUID()}`};
  const submitted = noticeDraftRequest;
  put('#notice-form-status', '고객 화면에 안내를 게시하고 있습니다.');
  const next = await action('notice_publish', {notice_id: submitted.notice_id, text, route});
  if (next && next.run_id === submitted.run_id) {
    noticeDraftRequest = null;
    $('#notice-form').reset();
    put('#notice-length', '0 / 500');
    put('#notice-form-status', '공용 안내를 게시했습니다. 고객 화면의 표시 현황을 아래에서 확인하세요.');
    toast('공용 안내를 게시했습니다. 연결된 고객 화면에 반영됩니다.');
  } else if (state.run_id === submitted.run_id) {
    put('#notice-form-status', '게시 결과를 확인하지 못했습니다. 목록을 확인하거나 같은 문구로 다시 시도하세요.');
  }
  renderControls();
});
$('#notice-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-notice-retract]');
  if (!button || button.disabled) return;
  if (await action('notice_retract', {notice_id: button.dataset.noticeRetract})) toast('안내를 회수했습니다. 모든 고객 화면에서 제거됩니다.');
});
$('#sources-button').addEventListener('click', () => openDialog('#sources-dialog'));
$('.topbar a[href="#developer-panel"]').addEventListener('click', () => {$('#developer-panel').open = true;});
$('#product-thumb').addEventListener('error', () => {$('#product-thumb').hidden = true;});
async function init() {
  renderControls();
  const results = await Promise.allSettled([request('/api/bootstrap'), request('/api/state')]);
  if (results[0].status === 'fulfilled') {
    bootstrap = results[0].value;
    const product = bootstrap.product;
    if (product) {
      put('#product-name', product.display_name || product.product_name);
      put('#product-id', product.product_id);
      put('#product-price', `${number(product.price?.sale_price_krw)}원`);
      put('#product-rating', `평점 ${product.rating?.average} · 리뷰 ${number(product.rating?.review_count)}건`);
      if (product.images?.[0]?.local_path) $('#product-thumb').src = '/' + product.images[0].local_path.replace(/^\/+/, '');
    }
  }
  if (results[1].status === 'fulfilled') acceptState(results[1].value);
  else setConnection(false, '공통 상태 서버에 연결하지 못했습니다. 로컬 서버를 실행하면 자동으로 다시 연결됩니다.');
  // A single sequential poll prevents overlapping or out-of-order GET responses.
  async function poll() {if (!busy) await refresh(); setTimeout(poll, 500);}
  setTimeout(poll, 500);
}
void init();
