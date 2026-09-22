(() => {
  'use strict';
  const { ASSETS, PRODUCT_URL, CANDIDATES, reviews, looks } = window.GSLiveData;
  const bus = window.GSAILiveState;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => value.toLocaleString('ko-KR') + '원';
  const benefit = window.GSLiveConfig.benefit;
  const pageId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  let askGeneration = 0;
  const state = {
    mode: 'portrait', size: '66', look: 0, busy: false, processing: '', sheet: null,
    shared: bus.read(), suggestionNotified: false, overlay: true, cart: [],
    messages: [
      { actor: 'operator', text: 'SJ와니 풀오버를 만나보세요. 상품과 코디에 대해 편하게 질문해주세요.', source: '프로토타입 운영자 예시 메시지' },
      { actor: 'customer', text: '이 니트, 출근할 때 어떻게 입으면 좋을까요?', source: '고객 대화 예시' },
      { actor: 'ai', text: '그레이 니트에 아이보리 슬랙스와 블랙 로퍼를 더해보세요. 지수님 취향에 맞춘 코디 3가지를 준비했어요.', source: '가상 고객 김지수 · 오피스 스타일 선호', action: 'styling', label: 'AI 맞춤 코디 보기' },
    ],
  };
  let toastTimer;
  const context = () => ({ pageId, size:state.size, look:state.look, mode:state.mode, cart:state.cart.map(item=>({...item})) });
  const track = (eventType, extra = {}, runId) => bus.emit('CUSTOMER_EVENT', { customerId: 'A', eventType, ...extra, context:context() }, 'customer', runId===undefined?{}:{runId});
  function toast(text) {
    $('#toast').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2800);
  }
  function setMode(mode) {
    state.mode = mode;
    document.body.classList.toggle('landscape', mode === 'landscape');
    $('#expand-button').textContent = mode === 'landscape' ? '⛶ 세로로 보기' : '⛶ 확장해서 보기';
    $('#expand-button').setAttribute('aria-pressed', String(mode === 'landscape'));
    $('#announcer').textContent = mode === 'landscape' ? '가로형 화면. 왼쪽은 영상과 상품, 오른쪽은 대화입니다.' : '세로형 화면으로 전환했습니다.';
    track('VIEW_MODE_CHANGE', { mode });
  }
  function selectSize(size) {
    if (!['55', '66', '77', '88'].includes(size)) return;
    state.size = size;
    $$('[data-size]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.size === size)));
    $('#selected-caption').textContent = `사이즈 ${size} 선택`;
    track('SIZE_OPTION_SELECT', { size });
  }
  function scrollConversation() {
    const last = $('#messages').lastElementChild;
    last?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }
  function renderMessages() {
    const names = { operator: '운영자', customer: '고객 · 지수', ai: 'ASK LIVE' };
    $('#messages').innerHTML = state.messages.map(message => `<article class="message ${message.actor}">
      <div class="message-meta"><span class="actor ${message.actor}">${names[message.actor]}</span>${message.actor === 'ai' ? '<span>AI · 데모 응답</span>' : ''}${message.runId && message.runId!==state.shared.runId?'<span>이전 방송</span>':''}</div>
      <div class="message-body">${escape(message.text)}${message.reviewKey ? `<div class="answer-chart">${reviewGroup(message.reviewKey, '구매 고객 선택형 평가')}</div>` : ''}${message.source ? `<p class="source">${escape(message.source)}</p>` : ''}${message.action ? `<button data-action="${message.action}">${escape(message.label)}</button>` : ''}</div>
    </article>`).join('') + (state.busy ? `<div class="pending" role="status">${escape(state.processing)}</div>` : '');
    $('#send-button').disabled = state.busy;
    $$('[data-question]').forEach(button => { button.disabled = state.busy; });
    $('#ask-form').setAttribute('aria-busy', String(state.busy));
    const latest = state.messages.at(-1);
    $('#video-chat').textContent = `${names[latest.actor]} · ${latest.text}`;
  }
  function answerFor(question) {
    const source = '제공 상품 데이터 · 선택형 리뷰 1,199건 기준';
    const shoeSize = /신발|발|로퍼|스니커즈|메리제인|운동화|구두/.test(question) && /사이즈|크기|\d{3}/.test(question);
    if (shoeSize || /모델|영상|아까|장면|입고|착용.*사이즈/.test(question)) return {
      text: '영상 속 모델 착용 정보와 신발 사이즈는 확인할 수 없어요. 영상 AI는 미검증이며, 참고 영상도 현재 상품과 다릅니다. 제공된 상품후기·두께감·색상·배송 예시를 안내할 수 있어요.',
      source: '미지원 질문 · 영상 분석 및 신발 사이즈 추천 없음', progress: '확인 가능한 정보를 살펴보고 있어요',
    };
    if (/두께|얇|두꺼/.test(question)) return { text: '두께감 평가에서 63%가 ‘얇아요’, 35%가 ‘적당해요’, 2%가 ‘두꺼워요’라고 답했어요. 개인에 따라 느끼는 두께감은 다를 수 있어요.', source, progress: '두께감 후기를 확인하고 있어요', action: 'reviews', label: '구매후기 자세히 보기' };
    if (/색상|색깔|컬러|화면.*비슷/.test(question)) return { text: '색상 평가에서 ‘동일해요’ 91%, ‘생각보다 어두워요’ 6%, ‘생각보다 밝아요’ 2%예요. 반올림된 원본 수치라 합계는 99%이며 화면 설정에 따라 색감이 다를 수 있어요.', source, progress: '색상 후기를 확인하고 있어요', action: 'reviews', label: '색상 후기 보기' };
    if (/배송|언제.*와|언제.*오|도착|오늘 주문/.test(question)) return { text: '배송 예시: 서울 영등포구 기준, 주문 후 영업일 2~3일 이내 도착으로 가정했어요. 실제 배송 조회 결과가 아니며 주문 시 상품 페이지의 배송 안내를 확인해주세요.', source: '시뮬레이션 배송 일정 · 무료배송은 제공 상품 정보', progress: '배송 예시 정보를 확인하고 있어요', action: 'detail', label: '상품상세 보기' };
    if (/사이즈|66|반사이즈/.test(question)) return { text: '지수님은 평소 상의 66을 선택하시네요. 사이즈 후기 87%가 ‘잘 맞아요’예요. 66 사이즈를 먼저 확인해보세요. 반사이즈에 걸치면 한 사이즈 크게 권장해요.', source: '가상 고객 프로필 + 제공 상품 안내 · 정밀 체형 추천 아님', progress: '사이즈 후기를 확인하고 있어요', action: 'size', label: '내 사이즈 확인', sizeEvent: true };
    if (/혜택|할인|가격/.test(question)) return { text: '기본가 49,900원에서 VIP 5% 2,495원과 VIP GS Pay 1,890원을 할인해요. 총 할인 4,385원, 최종 혜택가는 45,515원이에요.', source: '가상 VIP 고객 혜택 계산 · 실제 결제 연동 없음', progress: '혜택 조건을 확인하고 있어요', action: 'benefit', label: '할인 내역 확인' };
    if (/코디|스타일/.test(question)) return { text: '그레이 니트에 어울리는 오피스·데이트·데일리 코디를 준비했어요. 코디는 사전 제작된 AI 예시이며 실제 판매 상품 사진과는 구분돼요.', source: '가상 스타일 선호 + 사전 준비된 코디 3종', progress: '준비된 코디를 확인하고 있어요', action: 'styling', label: '코디 3종 보기' };
    if (/후기|리뷰/.test(question)) return { text: '평점 4.5, 리뷰 1,199건이에요. 디자인 ‘좋아요’ 68%, 사이즈 ‘잘 맞아요’ 87%, 색상 ‘동일해요’ 91%, 두께감 ‘얇아요’ 63%예요.', source, progress: '구매후기를 확인하고 있어요', action: 'reviews', label: '구매후기 자세히 보기' };
    return { text: '준비된 정보만으로는 이 질문에 정확하게 답하기 어려워요. 상품후기·두께감·색상·배송 예시를 물어보시거나 상품상세를 확인해주세요.', source: '프로토타입 지원 범위 안내 · 실시간 AI 검색 없음', progress: '확인 가능한 정보를 살펴보고 있어요', action: 'detail', label: '상품상세 보기' };
  }
  function intentFor(question, reply) {
    if (!reply.action) return 'unsupported';
    if (/두께|얇|두꺼/.test(question)) return 'thickness';
    if (/색상|색깔|컬러|화면.*비슷/.test(question)) return 'color';
    return ({ reviews: 'review', detail: 'delivery', size: 'size', benefit: 'benefit', styling: 'styling' })[reply.action] || 'unsupported';
  }
  async function ask(raw, fromInput = false) {
    const question = raw.trim().slice(0, 300);
    if (state.busy || !question) return;
    const generation=++askGeneration;
    const runId=bus.read().runId;
    const reply = answerFor(question);
    reply.intent = /정확하게 답하기 어려워요/.test(reply.text) ? 'unsupported' : intentFor(question, reply);
    reply.reviewKey = { thickness: 'thickness', color: 'color', review: 'size', size: 'size' }[reply.intent];
    state.messages.push({ actor: 'customer', text: question, runId });
    if (fromInput) $('#ask-input').value = '';
    state.busy = true;
    state.processing = reply.progress;
    track('ASK_LIVE_SUBMIT', { intent: reply.intent }, runId); // Do not persist free-text questions in telemetry.
    if (reply.sizeEvent) track('ASK_SIZE', {}, runId);
    renderMessages();
    scrollConversation();
    await new Promise(resolve => setTimeout(resolve, 1200));
    if(generation!==askGeneration || bus.read().runId!==runId)return;
    state.messages.push({ actor: 'ai', ...reply, runId });
    track('ASK_RESPONSE_READY',{intent:reply.intent},runId);
    state.busy = false;
    renderMessages();
    // A sheet or mode switch never destroys the in-flight response or draft.
    if (!$('#sheet').open) scrollConversation();
  }
  function openSheet(name, title, content, footer = '') {
    state.sheet = name;
    $('#sheet-title').textContent = title;
    $('#sheet-content').innerHTML = content;
    $('#sheet-footer').innerHTML = footer;
    if (!$('#sheet').open) $('#sheet').showModal();
    $('#sheet-content').scrollTop = 0;
    $('#close-sheet').focus({ preventScroll: true });
  }
  function closeSheet() { $('#sheet').close(); }
  function openSize() {
    track('SIZE_RESULT_VIEW');
    openSheet('size', '지수님의 내 사이즈', `<p class="notice ai-notice">가상 고객 김지수 · 평소 상의 66</p><div class="result-number">66</div><h3>66 사이즈를 먼저 확인해보세요.</h3><p>사이즈 평가에서 <strong>87%</strong>가 ‘잘 맞아요’라고 답했어요.</p><p>반사이즈에 걸치는 경우 <strong>한 사이즈 크게</strong> 권장해요.</p><p class="notice">상품 옵션: 55 / 66 / 77 / 88<br>실측값과 모델 착용 사이즈는 제공되지 않았어요. 정밀 체형 추천이 아닌, 평소 사이즈와 후기 기준 안내입니다.</p>`, '<button data-detail="size">사이즈 상세정보</button><button class="ai-button" data-action="size-purchase">66 선택하고 구매</button>');
    $('#sheet-content').insertAdjacentHTML('beforeend', `<section class="size-evidence"><h3>추천 근거와 옵션 선택</h3><dl class="ledger"><div><dt>평소 상의</dt><dd>66 · 가상 프로필</dd></div><div><dt>상품 사이즈</dt><dd>55 / 66 / 77 / 88</dd></div></dl>${reviewGroup('size', '상품 전체의 사이즈 평가')}<p class="notice">키·체형별 유사 고객 통계와 개별 후기 원문은 제공되지 않았어요. 위 87%는 유사 체형 집단이 아닌 상품 전체의 선택형 평가입니다.</p><div class="size-options" role="group" aria-label="추천 결과에서 옵션 선택">${['55','66','77','88'].map(size => `<button data-size="${size}" aria-pressed="${state.size===size}">${size}</button>`).join('')}</div><button data-action="purchase" class="external-link">선택한 옵션으로 구매 체험</button><button data-action="size-reviews">전체 사이즈 리뷰 보기</button></section>`);
  }
  function ledger() {
    return `<dl class="ledger"><div><dt>기본 가격</dt><dd>${money(benefit.base)}</dd></div><div class="discount"><dt>VIP 5% 할인</dt><dd>−${money(benefit.vip)}</dd></div><div class="discount"><dt>VIP GS Pay 할인</dt><dd>−${money(benefit.pay)}</dd></div><div class="discount"><dt>총 할인</dt><dd>−${money(benefit.saving)}</dd></div><div><dt>최종 혜택가</dt><dd>${money(benefit.final)}</dd></div></dl>`;
  }
  function openBenefit() {
    track('BENEFIT_RESULT_VIEW');
    openSheet('benefit', '지수님의 내 혜택', '<p class="notice">가상 VIP 고객 · GS Pay 결제 기준</p><div class="result-number benefit-number">45,515원</div>' + ledger() + '<p class="notice">제공된 데모 할인 조건입니다. 실제 회원 등급·쿠폰·결제 시스템과 연결되지 않았습니다.</p>', '<button data-action="purchase">혜택가로 구매 체험</button>');
    $('#sheet-content').insertAdjacentHTML('beforeend', '<p class="saving-summary">제공 조건으로 <strong>총 4,385원 절약</strong></p><section class="extra-benefits"><h3>추가 혜택과 확인할 조건</h3><ul><li><strong>무료배송</strong><span>제공 상품 정보 · 적용 조건은 공식 상세 확인</span></li><li><strong>GS Pay 추가 적립 · 확인 필요</strong><span>적립률/한도 데이터 미제공 · 할인 계산에 포함하지 않음</span></li><li><strong>카드 무이자 할부 · 확인 필요</strong><span>카드사별 조건 미연동 · 임의 적용하지 않음</span></li><li><strong>빠른 배송 · 확인 필요</strong><span>실제 도착 예정일 미연동 · 배송 예시와 구분</span></li></ul><a class="external-link" href="' + PRODUCT_URL + '" target="_blank" rel="noopener noreferrer" data-product-link>공식 상품에서 혜택 조건 확인 ↗</a></section>');
  }
  function productCard(name, image, url, label, detail = '') {
    return `<article class="item-card"><img src="${image}" alt="${escape(name)} 실제 상품 이미지"><div><strong>${escape(label)}</strong><small>${escape(name)}</small>${detail ? `<small>${escape(detail)}</small>` : ''}<a href="${url}" target="_blank" rel="noopener noreferrer" data-product-link>GS SHOP 상품 보기 ↗</a></div></article>`;
  }
  function openStyling(index = state.look) {
    state.look = index;
    const look = looks[index];
    const names = ['오피스', '데이트', '데일리'];
    openSheet('styling', 'AI 맞춤형 코디 추천', `<div class="look-tabs" role="tablist" aria-label="코디 스타일">${names.map((name, i) => `<button role="tab" id="look-tab-${i}" aria-controls="look-panel" aria-selected="${index === i}" data-look="${i}">${name}</button>`).join('')}</div>
      <section id="look-panel" role="tabpanel" aria-labelledby="look-tab-${index}"><div class="look-heading">LOOK 0${index + 1} · ${look.tag}</div><h3>${escape(look.title)}</h3>
      <div class="look-gallery"><div class="look-visual" style="--look-index:${index}"><img src="${ASSETS.lookbook}" alt="${names[index]}: 그레이 니트, ${escape(look.items.map(item => item[0]).join(', '))}"><span>AI 코디 예시</span></div><div class="look-thumbs" aria-label="코디 이미지로 선택">${names.map((name,i)=>`<button data-look="${i}" aria-label="${name} 코디 이미지 보기" aria-pressed="${i===index}"><span class="look-crop" style="--look-index:${i}"><img src="${ASSETS.lookbook}" alt=""></span><span>${name}</span></button>`).join('')}</div></div>
      <p class="look-reason">${escape(look.reason)}</p><p class="notice">사전 제작된 정적 이미지입니다. 클릭 시 새로 생성하지 않으며, 실제 판매 상품과 모양·색상이 다를 수 있어요. 신발은 디자인·색상·스타일만 추천하고 사이즈는 추천하지 않아요.</p>
      <h3>구성 상품 · 실제 이미지와 링크</h3>${productCard('SJ와니 샤이니 크리즈 캐시미어 풀오버 1종', ASSETS.thumb, PRODUCT_URL, '상의 · 현재 방송 상품', '코디 예시 컬러: 그레이')}
      ${look.items.map(([label, reason, key]) => CANDIDATES[key] ? productCard(CANDIDATES[key].name, CANDIDATES[key].image, CANDIDATES[key].url, label, `${reason} · 제공 HTML에서 확인된 후보`) : `<div class="unconfirmed"><strong>${escape(label)}</strong>${escape(reason)}<br>스타일 제안만 제공 · 판매 상품 미확정으로 이미지·가격·링크를 연결하지 않았어요.</div>`).join('')}
      <p class="notice">연결 상품은 제공 HTML의 후보입니다. 현재 판매 여부·재고·선택 가능한 색상은 GS SHOP에서 확인해주세요.</p></section>`, '<button data-action="all-products" class="ai-button">전체 코디 상품 보기</button><button data-action="close">LIVE로 돌아가기</button>');
    const picture = $('.look-visual img');
    picture.addEventListener('error', () => {
      $('.look-visual').hidden = true;
      $('.look-reason').insertAdjacentHTML('beforebegin', '<p class="notice">코디 예시 이미지를 불러오지 못했어요. 아래 실제 상품 정보를 확인해주세요.</p>');
    }, { once: true });
  }
  function openAllProducts() {
    track('STYLING_CATALOG_OPEN');
    openSheet('catalog', '전체 코디 상품', `<p class="notice ai-notice">3가지 코디에서 사용한 확인된 상품 5개와 미확정 스타일 2개입니다. 이미지는 실제 상품 사진이며 최신 가격·재고는 공식 상세에서 확인해주세요.</p>${productCard('SJ와니 샤이니 크리즈 캐시미어 풀오버 1종',ASSETS.thumb,PRODUCT_URL,'공통 상의 · 그레이 니트')}${Object.entries(CANDIDATES).map(([key,item])=>productCard(item.name,item.image,item.url,key==='bottom'||key==='shoes'?'오피스 코디 후보':'데이트 코디 후보')).join('')}<div class="unconfirmed"><strong>데일리 · 블루 와이드 데님 / 아이보리 스니커즈</strong>판매 상품 미확정 · 스타일만 추천합니다. 신발 사이즈는 추천하지 않습니다.</div>`, '<button data-action="styling">선택한 코디로 돌아가기</button>');
  }
  function reviewGroup(key, title) {
    return `<section class="review-group"><h3>${title}</h3>${reviews[key].map(([name, percent]) => `<div class="review-row"><span>${name}</span><meter min="0" max="100" value="${percent}" aria-label="${name} ${percent}%"></meter><strong>${percent}%</strong></div>`).join('')}</section>`;
  }
  function openDetail(tab = 'description', record = true) {
    if (record) { track('PRODUCT_DETAIL_OPEN', { tab }); if (tab === 'size') track('SIZE_TAB_OPEN'); }
    const tabs = [['description', '상품설명'], ['size', '사이즈'], ['reviews', '리뷰'], ['inquiry', '상품문의']];
    const header = `<div class="detail-tabs" role="tablist" aria-label="상품상세">${tabs.map(([key, name]) => `<button role="tab" id="detail-tab-${key}" aria-controls="detail-panel" aria-selected="${key === tab}" data-detail="${key}">${name}</button>`).join('')}</div>`;
    const body = {
      description: `<img class="detail-photo" src="${ASSETS.product}" alt="SJ와니 풀오버 실제 상품 이미지"><h3>SJ와니 샤이니 크리즈 캐시미어 풀오버 1종</h3><p>판매가 49,900원 · 무료배송<br>평점 4.5 · 리뷰 1,199건<br>사이즈: 55 / 66 / 77 / 88</p><p class="notice">제공 문서에 없는 소재 혼용률·실측값·모델 정보는 표시하지 않습니다. 자세한 상품 정보는 공식 상품 페이지에서 확인해주세요.</p>`,
      size: `<h3>상품 사이즈 안내</h3><p>55 / 66 / 77 / 88</p><div class="size-options">${['55', '66', '77', '88'].map(size => `<button data-size="${size}" aria-pressed="${state.size === size}">${size}</button>`).join('')}</div><p style="margin-top:14px">반사이즈에 걸치는 경우 한 사이즈 크게 권장합니다.</p><p class="notice">실측값과 모델 착용 사이즈는 제공되지 않았습니다.</p><button data-action="size-reviews">사이즈 리뷰 확인</button>`,
      reviews: `<p>평점 <strong>4.5</strong> · 리뷰 1,199건</p>${reviewGroup('size', '사이즈')}${reviewGroup('design', '디자인')}${reviewGroup('color', '색상')}${reviewGroup('thickness', '두께감')}${reviewGroup('fit', '핏')}<p class="notice">제공된 선택형 리뷰 수치입니다. 반올림으로 합계가 99%인 항목은 원본 그대로 표시합니다.</p>`,
      inquiry: '<h3>상품 문의 안내</h3><p>이 프로토타입에서는 실제 상품문의를 접수하지 않아요. 공식 상품 페이지에서 문의해주세요.</p><p class="notice">ASK LIVE는 준비된 상품·리뷰 정보만 안내하며 판매자 답변을 대신하지 않습니다.</p>',
    }[tab];
    openSheet('detail', '상품상세', header + `<section id="detail-panel" role="tabpanel" aria-labelledby="detail-tab-${tab}">${body}<a class="external-link" href="${PRODUCT_URL}" target="_blank" rel="noopener noreferrer" data-product-link>GS SHOP 공식 상품상세 ↗</a></section>`, '<button data-action="purchase">선택한 옵션으로 구매 체험</button>');
  }
  function openPurchase() {
    track('PURCHASE_CLICK', { size: state.size, price: benefit.final });
    openSheet('purchase', '구매 체험 · 실제 결제 없음', `${productCard('SJ와니 샤이니 크리즈 캐시미어 풀오버 1종', ASSETS.thumb, PRODUCT_URL, `선택 옵션: ${state.size}`)}<p>가상 고객 김지수 · VIP · GS Pay<br>배송지 예시: 서울 영등포구</p>${ledger()}<p class="notice">실제 주문·결제·배송이 발생하지 않는 데모입니다. 개인정보나 결제 정보를 입력하지 않습니다.</p>`, '<button data-action="add-cart">장바구니 담기</button><button data-action="purchase-complete" class="ai-button">45,515원 구매 체험 완료</button>');
  }
  function updateCartCount() { $('#cart-count').textContent = state.cart.reduce((n,item)=>n+item.quantity,0); }
  function addCart() {
    const item = state.cart.find(item=>item.size===state.size);
    if (item && item.quantity>=9) { toast('데모에서는 옵션별 최대 9개까지 담을 수 있어요.'); return; }
    if (item) item.quantity++; else state.cart.push({ size: state.size, quantity: 1 });
    track('CART_ADD', { size: state.size }); updateCartCount(); openCart();
  }
  function openCart() {
    const total = state.cart.reduce((n,item)=>n+item.quantity*benefit.final,0);
    openSheet('cart','장바구니 · 데모', `<p class="notice">현재 탭 안에서만 보관됩니다. 실제 GS SHOP 장바구니나 재고와 연결되지 않습니다.</p>${state.cart.length?state.cart.map(item=>`<article class="cart-item"><img src="${ASSETS.thumb}" alt="현재 상품"><div><strong>SJ와니 풀오버 · ${item.size}</strong><p>${money(benefit.final)} / 1개</p><div class="quantity-controls"><button data-cart-size="${item.size}" data-cart-change="-1" aria-label="${item.size} 수량 줄이기" ${item.quantity===1?'disabled':''}>−</button><span aria-label="수량">${item.quantity}</span><button data-cart-size="${item.size}" data-cart-change="1" aria-label="${item.size} 수량 늘리기" ${item.quantity===9?'disabled':''}>+</button><button data-cart-size="${item.size}" data-cart-remove>삭제</button></div></div></article>`).join(''):'<p class="empty-cart">장바구니가 비어 있어요.<br>구매하기에서 선택한 옵션을 담아보세요.</p>'}<p class="cart-total">데모 합계 <strong>${money(total)}</strong></p>`, state.cart.length?'<button data-action="close">계속 둘러보기</button><button data-action="cart-checkout" class="ai-button">장바구니 구매 체험</button>':'<button data-action="close">LIVE로 돌아가기</button>');
  }
  function cartCheckout() {
    if (!state.cart.length) return openCart();
    const total=state.cart.reduce((n,item)=>n+item.quantity*benefit.final,0);
    track('PURCHASE_CLICK',{route:'cart',quantity:state.cart.reduce((n,item)=>n+item.quantity,0),price:total});
    openSheet('cart-checkout','장바구니 구매 체험', `<p>가상 고객 김지수 · VIP · GS Pay</p><ul>${state.cart.map(item=>`<li>사이즈 ${item.size} · ${item.quantity}개 · ${money(item.quantity*benefit.final)}</li>`).join('')}</ul><p class="cart-total">혜택가 합계 <strong>${money(total)}</strong></p><p class="notice">실제 주문·결제·배송은 발생하지 않습니다. 완료하면 데모 장바구니만 비웁니다.</p>`, '<button data-action="cart">장바구니로</button><button data-action="cart-complete" class="ai-button">구매 체험 완료</button>');
  }
  function openGuide() {
    openSheet('guide', '이 프로토타입은요', `<ul class="guide-list"><li><strong>제공 자료:</strong> 상품명·가격·사이즈·선택형 리뷰·상품 사진 및 후보 링크는 첨부 문서와 HTML을 재사용합니다.</li><li><strong>데모:</strong> 김지수 프로필, AI 답변, 코디 선택, VIP 혜택 조건, 운영자 대화와 배송 일정은 준비된 시나리오입니다. 실제 AI·회원·주문·결제·배송 API와 연결하지 않습니다.</li><li><strong>Director 연동:</strong> ${bus.storageAvailable() ? '같은 브라우저·같은 주소의 탭 사이에서 고객 행동을 공통 브라우저 저장소로 실시간 공유합니다.' : '브라우저 저장소를 사용할 수 없어 현재 탭에서만 동작합니다. Director 탭과 연동되지 않습니다.'} 서버·다른 기기 연동은 없습니다. 8→26, 대상 33명 및 결과 수치는 Simulation입니다.</li><li><strong>선제 제안:</strong> 30초 안에 사이즈표·사이즈 리뷰·사이즈 질문 중 두 행동이 발생하면 작은 제안을 표시합니다. 거절하면 같은 방송에서 다시 제안하지 않습니다. 내 사이즈 직접 조회는 언제나 가능합니다.</li><li><strong>영상:</strong> 제공 MP4는 코어어센틱 가디건 참고 영상으로 현재 판매 상품과 다릅니다. 오류 시 상품 이미지로 대체합니다. TODO: 영상 AI·장면 검색·모델 착용 사이즈 추출은 미검증입니다.</li><li><strong>코디:</strong> 정적 AI 코디 예시입니다. 실제 상품 이미지와 구분하며 미확정 상품은 링크하지 않습니다.</li></ul><a class="external-link" href="/director.html" target="_blank" rel="noopener">Director 데모 열기 ↗</a><details><summary>시연 초기화</summary><p class="notice">현재 브라우저의 공통 방송 상태만 초기화합니다. 대화·선택 옵션·입력 중인 질문은 유지됩니다.</p><button data-action="reset">새 방송 시작 · 공통 Reset</button></details>`, '<button data-action="close">확인</button>');
    $('#sheet-content').insertAdjacentHTML('afterbegin','<section id="mobile-sync-details" class="sync-details" aria-live="polite"></section>');
    $('#sheet-content > details').id='demo-reset-options';
    renderSyncDetails();
  }
  function renderSyncDetails() {
    const target=$('#mobile-sync-details');if(!target)return;
    const shared=state.shared, detail=shared.actionDetails || {};
    const active=bus.isHighlightActive(shared);
    const signature=JSON.stringify([shared.runId,shared.approvals,shared.customer.dismissed,shared.customer.accepted,shared.result.visible,active,detail.hostMessage,bus.storageAvailable(),bus.serializedWrites()]);
    if(target.dataset.signature===signature)return;
    const expanded=target.querySelector('details')?.open;
    target.dataset.signature=signature;
    target.innerHTML=`<h3>Director와 연결된 방송 ${shared.runId}</h3><p>${bus.storageAvailable()?'같은 브라우저·같은 주소에서 공유 중':'저장소 사용 불가 · 현재 탭 전용'}${bus.serializedWrites()?' · 동시 쓰기 순서 보장':' · 동시 탭 쓰기 보장은 지원되지 않음'}</p><dl><div><dt>쇼호스트 안내 승인</dt><dd>${shared.approvals.host?'승인됨 · 외부 전달 데모':'대기'}</dd></div><div><dt>APP 개인화</dt><dd>${shared.customer.dismissed?'거절하여 제외':shared.customer.accepted?'제안 수락 완료':shared.approvals.app?'PD 승인됨':'승인 대기'}</dd></div><div><dt>Simulation 결과</dt><dd>${shared.result.visible?active?'확인됨 · 강조 중':'확인됨 · 강조 만료':'아직 확인 전'}</dd></div></dl>${shared.approvals.host?`<details><summary>PD가 승인한 안내 요청 · 데모</summary><p>${escape(detail.hostMessage||'이전 버전의 안내문 기록 없음')}</p><small>쇼호스트에게 요청하는 문구입니다. 실제 방송 발화·고객 공지로 전송된 것이 아닙니다.</small></details>`:''}<p class="notice">운영 결과 수치는 Simulation이며 실제 구매 효과가 아닙니다. 이 화면은 운영 연결 상태를 확인하는 데모 안내입니다.</p>`;
    if(expanded&&target.querySelector('details'))target.querySelector('details').open=true;
  }
  const actions = {
    size: openSize, benefit: openBenefit, styling: () => { track('STYLING_OPEN'); openStyling(); },
    reviews: () => openDetail('reviews'), detail: () => openDetail(), guide: openGuide, purchase: openPurchase,
    'size-purchase': () => { selectSize('66'); openPurchase(); },
    'size-reviews': () => { track('REVIEW_SIZE_VIEW'); openDetail('reviews'); },
    'all-products': openAllProducts, cart: openCart, 'add-cart': addCart, 'cart-checkout': cartCheckout,
    'cart-complete': () => { const quantity=state.cart.reduce((n,item)=>n+item.quantity,0);state.cart=[];track('CART_DEMO_COMPLETE', { quantity });updateCartCount();openSheet('complete','구매 체험 완료','<p>장바구니 구매 흐름을 체험했어요. 실제 주문이나 결제는 발생하지 않았습니다.</p>','<button data-action="close">LIVE로 돌아가기</button>'); },
    'toggle-overlay': () => { state.overlay=!state.overlay;$('#video-chat').hidden=!state.overlay;const b=$('[data-action="toggle-overlay"]');b.setAttribute('aria-pressed',String(state.overlay));b.textContent=state.overlay?'영상 위 대화 숨기기':'영상 위 대화 보기'; },
    leave: () => openSheet('leave','라이브를 나갈까요?','<p>나가면 영상이 정지하고 시작 화면으로 이동합니다. 대화·입력 중인 질문·데모 장바구니는 저장되지 않습니다.</p>','<button data-action="close">계속 시청</button><button data-action="confirm-leave">나가기</button>'),
    'confirm-leave': async () => { $('#gs-reference-video').pause(); await track('LIVE_EXIT'); location.href='/'; },
    'purchase-complete': () => {
      track('PURCHASE_DEMO_COMPLETE', { size: state.size });
      openSheet('complete', '구매 체험 완료', '<div class="purchase-success"><div class="result-number">✓</div><h3>구매 흐름을 체험했어요.</h3><p>실제 주문이나 결제는 발생하지 않았습니다.</p></div>', '<button data-action="close">LIVE로 돌아가기</button>');
    },
    reset: async () => { await bus.emit('RESET', {}, 'customer-demo'); closeSheet(); },
    close: closeSheet,
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button, a[data-product-link]');
    if (!button || button.disabled) return;
    if (button.dataset.size) selectSize(button.dataset.size);
    if (button.dataset.action && actions[button.dataset.action]) { track('QUICK_ACTION_CLICK', { action: button.dataset.action }); actions[button.dataset.action](); }
    if (button.dataset.detail) openDetail(button.dataset.detail);
    if (button.dataset.question) ask(button.dataset.question);
    if (button.dataset.look !== undefined) { openStyling(Number(button.dataset.look));track('STYLING_LOOK_CHANGE', { look: Number(button.dataset.look) }); }
    if (button.dataset.cartSize) {
      if (button.hasAttribute('data-cart-remove')) state.cart=state.cart.filter(item=>item.size!==button.dataset.cartSize);
      else { const item=state.cart.find(item=>item.size===button.dataset.cartSize); if(item)item.quantity=Math.max(1,Math.min(9,item.quantity+Number(button.dataset.cartChange))); }
      track(button.hasAttribute('data-cart-remove')?'CART_REMOVE':'CART_QUANTITY_CHANGE',{size:button.dataset.cartSize});
      updateCartCount(); openCart();
    }
    if (button.hasAttribute('data-product-link')) track(['styling','catalog'].includes(state.sheet)?'STYLING_PRODUCT_CLICK':'PRODUCT_LINK_CLICK', { productUrl: button.href });
  });
  $('#ask-form').addEventListener('submit', event => { event.preventDefault(); ask($('#ask-input').value, true); });
  $('#expand-button').addEventListener('click', () => setMode(state.mode === 'portrait' ? 'landscape' : 'portrait'));
  $('#purchase-button').addEventListener('click', openPurchase);
  $('#close-sheet').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('close', () => {
    state.sheet = null;
    track('LIVE_RETURN');
    if (state.shared.customer.suggestionVisible && !state.shared.customer.dismissed && !state.shared.customer.accepted) $('#suggestion').scrollIntoView({ block: 'nearest' });
  });
  $('#accept-suggestion').addEventListener('click', () => { bus.emit('ACCEPT_SUGGESTION', {}, 'customer'); track('AI_SUGGESTION_ACCEPT'); openSize(); });
  $('#dismiss-suggestion').addEventListener('click', async () => { const result=await bus.emit('DISMISS_SUGGESTION', {}, 'customer'); if(!result.customer.dismissed)return;track('AI_SUGGESTION_DISMISS');toast('이번 방송에서는 같은 제안을 다시 보여드리지 않을게요.'); });
  bus.subscribe(shared => {
    const reset=shared.runId !== state.shared.runId;
    if (reset) { state.suggestionNotified = false;askGeneration++;state.busy=false; }
    state.shared = shared;
    if(reset){renderMessages();track('CLIENT_SNAPSHOT');reportVideo('broadcast-reset');toast('새 방송으로 초기화됐어요. 이전 방송의 준비 중 답변은 취소했어요.');}
    const visible = shared.customer.suggestionVisible && !shared.customer.dismissed && !shared.customer.accepted;
    $('#suggestion').hidden = !visible;
    $('#approval-label').textContent = shared.approvals.app ? '· PD 승인' : '· 행동 기반 데모';
    if (visible && !state.suggestionNotified) {
      state.suggestionNotified = true;
      $('#announcer').textContent = '사이즈가 고민되시나요? LIVE 대화에 맞춤 제안이 도착했어요.';
      // Not a result redirect: the customer chooses whether to accept.
      if (!$('#sheet').open) toast('LIVE 대화에 사이즈 맞춤 제안이 도착했어요.');
    }
    updateHighlight();
    renderSyncDetails();
  });
  function updateHighlight() {
    const shared = state.shared;
    const active = shared.approvals.app && !shared.customer.dismissed && !shared.customer.accepted && (!shared.result.visible || bus.isHighlightActive(shared));
    $('.secondary-actions [data-action="size"]').classList.toggle('highlighted', active);
  }
  setInterval(()=>{if(state.shared.result.highlighted && state.shared.result.highlightExpiresAt<=Date.now())bus.emit('EXPIRE_HIGHLIGHT',{},'timer');updateHighlight();renderSyncDetails();}, 1000);

  const video = $('#gs-reference-video');
  function reportVideo(action) { const media=$('#gs-reference-video');return bus.emit('VIDEO_EVENT',{action,status:media.error?'error':media.ended?'ended':media.paused?'paused':'playing',currentTime:media.currentTime,duration:Number.isFinite(media.duration)?media.duration:0,context:context()},'customer'); }
  function videoStatus() {
    $('#gs-video-status').textContent = video.error ? '이미지 미리보기' : video.ended ? '재생 완료' : video.paused ? '일시정지' : '재생 중';
    $('[data-video-action="seek"]').value = Number.isFinite(video.duration) && video.duration ? String(video.currentTime / video.duration * 100) : '0';
  }
  for (const type of ['play', 'pause', 'seeked', 'ended', 'timeupdate', 'loadedmetadata']) video.addEventListener(type, videoStatus);
  for(const type of ['play','pause','seeked','ended','loadeddata'])video.addEventListener(type,()=>reportVideo(type));
  let lastVideoReport=0;
  video.addEventListener('timeupdate',()=>{if(!video.paused&&Date.now()-lastVideoReport>=5000){lastVideoReport=Date.now();reportVideo('progress');}});
  video.addEventListener('error', () => {
    video.hidden = true; $('.video-image').hidden = false; $('#gs-video-error').hidden = false; videoStatus();
    reportVideo('error-fallback');
  });
  video.addEventListener('loadeddata', () => { video.hidden = false; $('.video-image').hidden = true; $('#gs-video-error').hidden = true; });
  $$('[data-video-action]').forEach(control => {
    const action = control.dataset.videoAction;
    control.addEventListener(action === 'seek' ? 'input' : 'click', async () => {
      try {
        if (action === 'retry') { video.src = '/assets/reference-video.mp4'; video.load(); }
        if (action === 'play') await video.play();
        if (action === 'pause') video.pause();
        if (['back', 'forward', 'seek'].includes(action) && Number.isFinite(video.duration)) video.currentTime = action === 'seek' ? video.duration * Number(control.value) / 100 : Math.max(0, Math.min(video.duration, video.currentTime + (action === 'back' ? -5 : 5)));
        if (action === 'retry') reportVideo('retry');
      } catch { toast('영상 재생을 시작하지 못했어요. 재생 버튼을 다시 눌러주세요.'); }
    });
  });
  function fitViewport() {
    const viewport = window.visualViewport;
    // Keep both input and purchase inside the visible viewport when a keyboard opens.
    if (viewport && viewport.scale === 1) document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
    document.body.classList.toggle('keyboard-open', Boolean(viewport && innerHeight - viewport.height > 100));
  }
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.addEventListener('resize', fitViewport);
  fitViewport();
  renderMessages();
  track('LIVE_ENTER');
})();
