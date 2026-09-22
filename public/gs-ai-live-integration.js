(() => {
  'use strict';

  const page = document.currentScript?.dataset.page || (location.pathname.includes('director') ? 'director' : 'mobile');
  const bridge = window.GSAILiveState;
  if (!bridge) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const emit = (type, payload = {}, source = page) => bridge.emit(type, payload, source);
  const formatRemaining = expiresAt => expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0;

  const style = document.createElement('style');
  style.textContent = `
    .gs-sync-card{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;letter-spacing:-.03em}
    .gs-sync-card *{box-sizing:border-box}.gs-sync-card button{cursor:pointer;border:0;font:inherit}
    .gs-sync-card .gs-mint{color:#087b64;background:#e7f7f1}.gs-sync-card .gs-amber{color:#9a6418;background:#fff1dd}
    .gs-sync-card .gs-muted{color:#738093;background:#f0f3f6}.gs-sync-card .gs-dark{color:#dffcf2;background:#203b39}
    .gs-director-card{margin:0 34px 18px;padding:15px 18px;background:#162536;color:#fff;border:1px solid #2c4055;border-radius:14px;box-shadow:0 8px 24px #14243812}
    .gs-director-head,.gs-director-grid,.gs-director-actions,.gs-mobile-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.gs-director-head{justify-content:space-between;margin-bottom:11px}
    .gs-director-head strong{font-size:14px}.gs-director-head small{color:#93a7ba}.gs-sync-badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:700;white-space:nowrap}
    .gs-director-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.gs-kpi{padding:10px 11px;border-radius:9px;background:#213448;border:1px solid #2d455b}.gs-kpi span{display:block;color:#9cb0c2;font-size:10px}.gs-kpi strong{display:block;margin-top:2px;font-size:16px}.gs-kpi small{display:block;color:#8aa2b2;font-size:10px}
    .gs-targets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;color:#abc0ce;font-size:11px}.gs-targets b{font-weight:700}.gs-target{border-radius:999px;padding:3px 8px;font-weight:700}.gs-target.in{color:#123c31;background:#80e5c6}.gs-target.out{color:#bdcad6;background:#33485b}.gs-director-actions{margin-top:11px}.gs-director-actions button{padding:7px 10px;border-radius:7px;color:#18352d;background:#6ce1bf;font-size:11px;font-weight:750}.gs-director-actions button.secondary{color:#cbd8e4;background:#30465a}.gs-director-actions button:disabled{opacity:.45;cursor:not-allowed}.gs-director-note{margin-left:auto;color:#91a6b8;font-size:10px}
    .gs-mobile-card{width:min(100%,560px);margin:10px auto 6px;padding:9px 12px;border:1px solid #bddfd1;border-radius:10px;background:#f4fbf8;color:#315d50;box-shadow:0 4px 12px #163c3510}.gs-mobile-head{justify-content:space-between}.gs-mobile-head strong{font-size:11px}.gs-mobile-head small{font-size:10px;color:#729184}.gs-mobile-metrics{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.gs-mobile-metrics span{padding:3px 6px;border-radius:5px;font-size:10px;background:#e1f3ec;color:#447368}.gs-mobile-metrics .gs-mobile-result{background:#fff1dd;color:#9a6418}.gs-customer-approval{width:min(100%,560px);margin:8px auto 0;padding:12px 14px;border:1px solid #a8ddca;border-radius:11px;background:#e9faf4;color:#245d4d;box-shadow:0 7px 24px #163c3518}.gs-customer-approval[hidden]{display:none}.gs-customer-approval strong{display:block;font-size:13px}.gs-customer-approval p{margin:4px 0 9px;font-size:11px;line-height:1.6}.gs-customer-approval button{border-radius:7px;padding:7px 10px;font-size:11px;font-weight:700;color:#fff;background:#1e765e}.gs-customer-approval button+button{margin-left:5px;color:#48675f;background:#d9eee7}
    .video-frame.gs-video-mounted{background:#111}.video-frame.gs-video-mounted::after{display:none}
    .gs-video-mounted #gs-reference-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#111}
    .gs-video-mounted .video-caption,.gs-video-mounted .video-bottom{display:none}
    .gs-video-mounted .video-top{pointer-events:none;gap:8px}.gs-video-mounted .video-kicker{background:#162820cf;letter-spacing:0;white-space:nowrap}
    .gs-video-details{padding:10px 14px;background:#f5f9f6;border-bottom:1px solid #e0e9e3;color:#486154}
    .gs-video-details p{margin:0;font-size:10px;line-height:1.6;color:#607668}
    .gs-video-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px}
    .gs-video-controls button,body.landscape .gs-video-controls .expand-button{padding:5px 8px;border:1px solid #d8e3db;border-radius:6px;background:#fff;color:#486154;font-size:10px;min-height:30px}
    .gs-video-controls input{flex:1;min-width:70px;width:80px;accent-color:#21825e}
    .gs-video-status{margin-left:auto;font-size:10px;color:#607668}
    .gs-video-error{position:absolute;inset:auto 12px 14px;z-index:2;padding:10px 12px;border-radius:8px;background:#182d26e8;color:#fff;font-size:12px;line-height:1.6}
    @media(max-width:800px){.gs-director-card{margin:0 15px 16px}.gs-director-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.gs-director-note{width:100%;margin-left:0}.gs-mobile-card,.gs-customer-approval{width:calc(100% - 24px)}}
  `;
  document.head.appendChild(style);

  function directorMarkup() {
    return `<section class="gs-sync-card gs-director-card" aria-label="GS AI LIVE 공통 상태">
      <div class="gs-director-head"><div><strong>GS AI LIVE · Shared Event Bus</strong><small> 고객 행동 → Need → Director → PD → 고객 화면</small></div><span id="gs-d-stage" class="gs-sync-badge gs-muted">MONITORING</span></div>
      <div class="gs-director-grid">
        <div class="gs-kpi"><span>사이즈 관심</span><strong id="gs-d-signal">8건</strong><small id="gs-d-signal-note">기준 상태</small></div>
        <div class="gs-kpi"><span>Need 감지</span><strong id="gs-d-need">대기</strong><small id="gs-d-evidence">고객 행동 수집 중</small></div>
        <div class="gs-kpi"><span>승인 대상</span><strong id="gs-d-target">33명</strong><small>A 포함 · B/C 제외</small></div>
        <div class="gs-kpi"><span>PD 승인</span><strong id="gs-d-approvals">0/2</strong><small>호스트 · APP</small></div>
        <div class="gs-kpi"><span>고객 이벤트</span><strong id="gs-d-events">0</strong><small id="gs-d-last">아직 없음</small></div>
        <div class="gs-kpi"><span>강조</span><strong id="gs-d-highlight">대기</strong><small id="gs-d-expiry">결과 확인 후 30초</small></div>
      </div>
      <div class="gs-targets"><b>대상 판정</b><span id="gs-target-a" class="gs-target out">A 대기</span><span class="gs-target out">B 제외</span><span class="gs-target out">C 제외</span><span class="gs-director-note">중복 방지: A 거절 시 같은 방송 재노출 없음</span></div>
      <div class="gs-director-actions"><button data-gs-action="detect">8 → 26 감지 재현</button><button data-gs-action="host" class="secondary">호스트 승인</button><button data-gs-action="app" class="secondary">APP 33명 승인</button><button data-gs-action="result" class="secondary">Simulation 결과</button><button data-gs-action="expire" class="secondary">강조 만료 검수</button><button data-gs-action="reset" class="secondary">공통 Reset</button></div>
    </section>`;
  }

  function mobileMarkup() {
    return `<section class="gs-sync-card gs-mobile-card" aria-label="고객과 Director 공통 상태"><div class="gs-mobile-head"><strong>GS AI LIVE · A 고객 / 공통 상태 연결</strong><small id="gs-m-stage">Director 대기</small></div><div class="gs-mobile-metrics"><span id="gs-m-signal">사이즈 관심 8건</span><span id="gs-m-need">Need 감지 대기</span><span id="gs-m-event">고객 이벤트 0</span><span id="gs-m-result" class="gs-mobile-result" hidden>결과 강조 대기</span></div></section>
      <section id="gs-customer-approval" class="gs-customer-approval" hidden><strong>PD 승인 완료 · A 고객에게 내 사이즈 제안</strong><p>Director가 승인한 33명 대상 중 A 고객에게만 표시됩니다. B/C는 행동 조건을 충족하지 않아 제외되었습니다.</p><button data-gs-action="accept-suggestion">내 사이즈 확인</button><button data-gs-action="dismiss-suggestion">괜찮아요</button></section>`;
  }

  function mountVideo() {
    const frame = $('.device .video-frame');
    if (!frame) return;
    frame.classList.add('gs-video-mounted');
    frame.setAttribute('aria-label', 'LIVE 플레이어 · 다른 상품 참고 영상');
    frame.querySelector('.video-image').hidden = true;
    frame.querySelector('.video-kicker').textContent = '다른 상품 참고 영상';
    frame.insertAdjacentHTML('afterbegin', `<video id="gs-reference-video" preload="metadata" playsinline controls src="/assets/reference-video.mp4" aria-label="코어어센틱 캐시니트 가디건 참고 영상"></video>`);
    frame.insertAdjacentHTML('beforeend', `<div id="gs-video-error" class="gs-video-error" role="status" hidden>영상을 불러오지 못해 상품 이미지로 표시합니다. 아래 ‘다시 시도’를 눌러주세요.</div>`);
    frame.insertAdjacentHTML('afterend', `<div class="gs-video-details">
      <p>참고 영상: 코어어센틱 캐시니트 가디건 · 현재 SJ와니 상품과 다른 상품입니다.</p>
      <div class="gs-video-controls"><button data-video-action="play">재생</button><button data-video-action="pause">정지</button><button data-video-action="back">−5초</button><button data-video-action="forward">+5초</button><input data-video-action="seek" type="range" min="0" max="100" value="0" step="1" aria-label="영상 탐색"><button data-video-action="retry" hidden>다시 시도</button><span id="gs-video-status" class="gs-video-status">준비 중</span></div>
    </div>`);
    // Keep the existing orientation handler and the same video node across modes.
    $('.gs-video-controls').append($('#expand-button'));
  }

  function insertUi() {
    if (page === 'director') {
      const main = $('.main');
      if (main) main.insertAdjacentHTML('afterbegin', directorMarkup());
    } else {
      const anchor = $('.workbar') || $('.device-scroll') || document.body.firstElementChild;
      if (anchor) anchor.insertAdjacentHTML(anchor.classList.contains('workbar') ? 'afterend' : 'afterbegin', mobileMarkup());
      else document.body.insertAdjacentHTML('afterbegin', mobileMarkup());
      mountVideo();
    }
  }

  function directorState(state) {
    const detected = state.need.detected;
    const approvals = Number(state.approvals.host) + Number(state.approvals.app);
    const highlight = bridge.isHighlightActive(state);
    if (detected && typeof window.setStage === 'function' && state.stage !== 'RESULT') window.setStage(approvals ? 'ACTION' : 'ALERT');
    if (state.result.visible && typeof window.setStage === 'function') {
      window.setStage('RESULT');
      if (typeof window.switchView === 'function') window.switchView('analytics');
    }
    const stage = state.stage === 'RESULT' ? 'RESULT READY' : state.stage === 'ACTION' ? 'PD APPROVAL' : detected ? 'NEED DETECTED' : 'MONITORING';
    const set = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
    set('#gs-d-stage', stage); set('#gs-d-signal', `${state.signals.size}건`); set('#gs-d-signal-note', detected ? '8 → 26 (+225%)' : '기준 상태');
    set('#gs-d-need', detected ? '감지' : '대기'); set('#gs-d-evidence', detected ? `${state.need.evidence.length || state.customer.needEvents.length}건 근거` : '고객 행동 수집 중');
    set('#gs-d-target', detected ? `${state.target.approvalCount}명` : '대기'); set('#gs-d-approvals', `${approvals}/2`); set('#gs-d-events', state.events.filter(event => event.source === 'customer').length);
    const last = state.events[state.events.length - 1]; set('#gs-d-last', last ? `${last.type} · ${last.source}` : '아직 없음');
    set('#gs-d-highlight', highlight ? '강조 중' : state.result.visible ? '만료' : '대기'); set('#gs-d-expiry', highlight ? `${formatRemaining(state.result.highlightExpiresAt)}초 남음` : state.result.visible ? '강조 종료' : '결과 확인 후 30초');
    const target = $('#gs-target-a'); if (target) { const status = state.target.status.A; target.className = `gs-target ${status === 'approved' || status === 'eligible' ? 'in' : 'out'}`; target.textContent = `A ${status === 'approved' ? '승인' : status === 'eligible' ? '포함' : status === 'dismissed' ? '거절 제외' : '대기'}`; }
    ['host','app'].forEach(kind => { const button = $(`[data-gs-action="${kind}"]`); if (button) button.disabled = state.approvals[kind] || !detected; });
    const resultButton = $('[data-gs-action="result"]'); if (resultButton) resultButton.disabled = !(state.approvals.host && state.approvals.app);
    const expireButton = $('[data-gs-action="expire"]'); if (expireButton) expireButton.disabled = !state.result.visible || !highlight;
    const appAction = $('#app-action'); if (appAction && state.approvals.app) appAction.innerHTML = '✓ 승인 대상 33명에 적용했습니다';
    const hostAction = $('#host-action'); if (hostAction && state.approvals.host) { hostAction.disabled = true; hostAction.classList.add('approved'); hostAction.innerHTML = '✓ 쇼호스트에게 전달했습니다'; }
    const appDialogBadge = $('#segment-badge'); if (appDialogBadge && detected) appDialogBadge.textContent = `승인 대상 33명 · A 포함 / B·C 제외`;
    const appApprove = $('#approve-app'); if (appApprove && detected) appApprove.textContent = '승인하고 33명 대상에 적용';
    const appSubtitle = $('#app-dialog-subtitle'); if (appSubtitle && detected) appSubtitle.textContent = 'A 고객은 포함하고, B/C 고객은 제외합니다.';
    const segment = $('#segment-body'); if (segment && detected) segment.innerHTML = `<tr><td>A</td><td>사이즈 질문 + 사이즈표</td><td><span class="badge mint">${state.approvals.app ? '노출 중' : '포함'}</span></td></tr><tr><td>B</td><td>혜택만 조회</td><td><span class="badge neutral">제외</span></td></tr><tr><td>C</td><td>배송만 조회</td><td><span class="badge neutral">제외</span></td></tr>`;
  }

  function mobileState(state) {
    const detected = state.need.detected;
    const set = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
    set('#gs-m-stage', state.approvals.app ? 'PD 승인 · A에게 적용' : detected ? 'Need 감지 · Director 확인' : 'Director 대기');
    set('#gs-m-signal', `사이즈 관심 ${state.signals.size}건`); set('#gs-m-need', detected ? '사이즈 Need 감지' : 'Need 감지 대기'); set('#gs-m-event', `공통 이벤트 ${state.events.filter(event => event.source === 'customer').length}`);
    const result = $('#gs-m-result'); if (result) { result.hidden = !state.result.visible; result.textContent = bridge.isHighlightActive(state) ? `결과 강조 ${formatRemaining(state.result.highlightExpiresAt)}초` : '결과 강조 만료'; }
    const approval = $('#gs-customer-approval'); if (approval) approval.hidden = !(state.approvals.app && state.customer.suggestionVisible && !state.customer.dismissed);
  }

  function sync(state) { if (page === 'director') directorState(state); else mobileState(state); }

  function customerEvent(eventType, extra = {}) {
    emit('CUSTOMER_EVENT', { customerId: 'A', eventType, ...extra }, 'customer');
  }

  function bindCustomerTelemetry() {
    document.addEventListener('click', event => {
      const target = event.target.closest('button,[data-action],[data-question],[data-detail],[data-size]');
      if (!target) return;
      if (target.matches('[data-question]')) {
        const question = target.dataset.question || '';
        customerEvent(/사이즈|핏|66|55|77|88/.test(question) ? 'ASK_SIZE' : 'ASK_LIVE_SUBMIT', { question });
      } else if (target.matches('[data-size]')) customerEvent('SIZE_OPTION_SELECT', { size: target.dataset.size });
      else if (target.matches('[data-detail="size"]')) customerEvent('SIZE_TAB_OPEN');
      else if (target.id === 'size-reviews') customerEvent('REVIEW_SIZE_VIEW');
      else if (target.dataset.action === 'size') customerEvent('SIZE_TAB_OPEN');
      else if (target.dataset.action === 'benefit') customerEvent('BENEFIT_RESULT_VIEW');
      else if (target.dataset.action === 'styling') customerEvent('STYLING_OPEN');
      else if (target.id === 'purchase-button') customerEvent('PURCHASE_CLICK');
    }, true);
    const form = $('#ask-form'); if (form) form.addEventListener('submit', () => { const question = $('#ask-input')?.value || ''; customerEvent(/사이즈|핏|66|55|77|88/.test(question) ? 'ASK_SIZE' : 'ASK_LIVE_SUBMIT', { question }); }, true);
  }

  function bindDirectorTelemetry() {
    const map = { '#demo-trigger': 'SCENARIO_DETECT', '#approve-host': 'APPROVE_HOST', '#approve-app': 'APPROVE_APP', '#result-action': 'SHOW_RESULT', '#confirm-reset': 'RESET' };
    Object.entries(map).forEach(([selector, type]) => { const node = $(selector); if (node) node.addEventListener('click', () => emit(type, {}, 'director'), true); });
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-gs-action]'); if (!target) return;
      const action = target.dataset.gsAction;
      if (action === 'detect') { if (typeof window.triggerSpike === 'function') window.triggerSpike(); emit('SCENARIO_DETECT', {}, 'director'); }
      if (action === 'host') { if (typeof window.showActions === 'function' && bridge.read().stage === 'ALERT') window.showActions(); emit('APPROVE_HOST', {}, 'director-control'); }
      if (action === 'app') { emit('APPROVE_APP', {}, 'director-control'); }
      if (action === 'result') { emit('SHOW_RESULT', {}, 'director-control'); }
      if (action === 'expire') { emit('EXPIRE_HIGHLIGHT', {}, 'director-control'); }
      if (action === 'reset') { emit('RESET', {}, 'director-control'); if (typeof window.reset === 'function') window.reset(); }
    });
  }

  function bindCustomerApproval() {
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-gs-action]'); if (!target) return;
      if (target.dataset.gsAction === 'accept-suggestion') { emit('ACCEPT_SUGGESTION', {}, 'customer'); if (typeof window.openSize === 'function') window.openSize(); }
      if (target.dataset.gsAction === 'dismiss-suggestion') { emit('DISMISS_SUGGESTION', {}, 'customer'); if (typeof window.toast === 'function') window.toast('같은 방송에서 같은 제안을 다시 표시하지 않아요.'); }
    });
  }

  function bindVideo() {
    const video = $('#gs-reference-video'); if (!video) return;
    const frame = video.closest('.video-frame');
    const fallback = frame.querySelector('.video-image');
    const error = $('#gs-video-error');
    const retry = $('[data-video-action="retry"]');
    const status = $('#gs-video-status'); const seek = $('[data-video-action="seek"]');
    const setStatus = text => { if (status) status.textContent = text; };
    const setFailed = failed => {
      video.hidden = failed;
      fallback.hidden = !failed;
      error.hidden = !failed;
      retry.hidden = !failed;
      document.querySelectorAll('.gs-video-controls [data-video-action]:not([data-video-action="retry"])').forEach(control => { control.disabled = failed; });
    };
    video.addEventListener('loadstart', () => { setFailed(false); setStatus('준비 중'); });
    video.addEventListener('loadedmetadata', () => { if (seek) seek.value = '0'; setStatus('준비됨'); });
    video.addEventListener('timeupdate', () => { if (video.error) return; if (seek && video.duration) seek.value = String(Math.round(video.currentTime / video.duration * 100)); setStatus(`${Math.floor(video.currentTime)}초 / ${Math.floor(video.duration || 0)}초`); });
    video.addEventListener('play', () => { setStatus('재생 중'); emit('VIDEO_EVENT', { action: 'play', currentTime: video.currentTime }, 'customer'); });
    video.addEventListener('pause', () => { if (!video.error) setStatus('일시정지'); emit('VIDEO_EVENT', { action: 'pause', currentTime: video.currentTime }, 'customer'); });
    video.addEventListener('error', () => { setFailed(true); setStatus('영상 오류 · 상품 이미지 대체'); });
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-video-action]')?.dataset.videoAction; if (!action) return;
      if (action === 'play') video.play().catch(() => { if (!video.error) setStatus('재생 버튼을 다시 눌러주세요'); });
      if (action === 'pause') video.pause();
      if (action === 'back' && Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime - 5);
      if (action === 'forward' && Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 5);
      if (action === 'retry') { video.src = '/assets/reference-video.mp4'; video.load(); }
    });
    if (seek) seek.addEventListener('input', () => { if (video.duration) video.currentTime = Number(seek.value) / 100 * video.duration; });
  }

  insertUi();
  bridge.subscribe(sync);
  if (page === 'director') bindDirectorTelemetry(); else { bindCustomerTelemetry(); bindCustomerApproval(); bindVideo(); }
  setInterval(() => {
    const state = bridge.read();
    if (state.result.highlighted && state.result.highlightExpiresAt && state.result.highlightExpiresAt <= Date.now()) emit('EXPIRE_HIGHLIGHT', {}, 'timer');
    sync(bridge.read());
  }, 1000);
})();
