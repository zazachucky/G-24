(() => {
  'use strict';

  const STORAGE_KEY = 'gs-ai-live:shared-state:v1';
  const SCHEMA_VERSION = 1;
  const config = window.GSLiveConfig;
  const NEED_EVENTS = new Set(['ASK_SIZE', 'SIZE_TAB_OPEN', 'REVIEW_SIZE_VIEW']);
  const INTENTS = Object.freeze({ review: '상품후기 알려줘', thickness: '두께감 어때?', color: '색상이 화면과 비슷해?', delivery: '오늘 주문하면 언제 와?', size: '사이즈 선택이 궁금해요', benefit: '내 혜택은 얼마인가요?', styling: '어떻게 코디하면 좋을까요?', unsupported: '준비된 정보 밖의 질문' });
  const HOST_MESSAGE = '사이즈 문의가 많습니다. 평소 사이즈 기준과 반사이즈 선택 방법을 한 번 더 안내해주세요.';
  const listeners = new Set();
  let memoryState = null;
  let storageWorks = true;
  let pending = Promise.resolve();
  const canLock = Boolean(window.navigator?.locks?.request);
  let databasePromise, durableWorks=false, canonicalCache=false;
  const channel=window.BroadcastChannel?new window.BroadcastChannel(`${STORAGE_KEY}:updates`):null;
  const counters = () => ({ questionCount:0, questionsByIntent:{}, eventCounts:{}, topics:{size:0,benefit:0,styling:0,product:0,delivery:0}, demoPurchases:0, demoUnits:0, demoTotal:0 });
  const actualMetrics = state => ({ size:state.activity?.eventCounts?.SIZE_RESULT_VIEW||0, benefit:state.activity?.eventCounts?.BENEFIT_RESULT_VIEW||0, styling:state.activity?.eventCounts?.STYLING_OPEN||0, cartAdds:state.activity?.eventCounts?.CART_ADD||0, purchaseClicks:state.activity?.eventCounts?.PURCHASE_CLICK||0, completed:state.activity?.demoPurchases||0 });

  const now = () => Date.now();
  const id = () => `${now()}-${Math.random().toString(36).slice(2, 9)}`;

  function initialState(previousRunId = 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      runId: previousRunId + 1,
      stage: 'NORMAL',
      signals: {
        size: 8,
        baseline: 8,
        detectedAt: null,
      },
      need: {
        id: 'SIZE_SELECTION',
        label: '사이즈 선택 Need',
        detected: false,
        evidence: [],
      },
      target: {
        approvalCount: 33,
        included: [],
        excluded: ['B', 'C'],
        status: { A: 'pending', B: 'excluded', C: 'excluded' },
      },
      approvals: { host: false, app: false },
      actionDetails: { hostMessage: '', hostApprovedAt: null, appApprovedAt: null },
      activity: counters(),
      customer: {
        id: 'A',
        needEvents: [],
        suggestionVisible: false,
        dismissed: false,
        accepted: false,
        lastEvent: null,
        selectedSize: config.product.usualSize, look: 0, mode:'portrait', cart:[], lastSeenAt:null, latestPageId:null, latestFeature:null,
        video: { status:'unknown', currentTime:0, duration:0, updatedAt:null },
      },
      result: {
        visible: false,
        highlighted: false,
        highlightExpiresAt: null,
      },
      events: [],
      revision: 0,
      updatedAt: now(),
    };
  }

  function normalize(state) {
    const initial=initialState(state.runId-1);
    return { ...initial,...state, activity:{...counters(),...state.activity}, customer:{...initial.customer,...state.customer} };
  }

  function read() {
    if(canonicalCache && memoryState)return memoryState;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return memoryState || initialState();
      const parsed = JSON.parse(raw);
      return parsed && parsed.schemaVersion === SCHEMA_VERSION ? normalize(parsed) : initialState();
    } catch (_) {
      storageWorks = false;
      return memoryState || initialState();
    }
  }

  function write(state, canonical=false) {
    const next = canonical?state:{ ...state, revision: (state.revision||0)+1, updatedAt: now() };
    if(canonical && canonicalCache && memoryState && memoryState.revision>next.revision)return memoryState;
    if(canonical)canonicalCache=true;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      storageWorks = true;
    } catch (_) {
      storageWorks = false;
      // The UI remains usable in browsers where storage is disabled.
    }
    notify(next);
    channel?.postMessage({state:next,canonical});
    return next;
  }

  function database() {
    if(databasePromise)return databasePromise;
    databasePromise=new Promise((resolve,reject)=>{
      const request=window.indexedDB.open('gs-ai-live-shared',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('state');
      request.onsuccess=()=>{durableWorks=true;resolve(request.result);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Shared database upgrade blocked'));
    });
    return databasePromise;
  }
  function receive(state, canonical=false) {
    if(!state || state.schemaVersion!==SCHEMA_VERSION)return;
    if(canonicalCache && !canonical)return;
    if(!memoryState || state.revision>memoryState.revision || (canonical && !canonicalCache)) {
      if(canonical)canonicalCache=true;
      notify(normalize(state));
    }
  }
  if(channel)channel.onmessage=event=>receive(event.data?.state,event.data?.canonical);

  async function durableCommit(type,payload,source,runId) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('state','readwrite');
      const store=transaction.objectStore('state');
      const request=store.get('current');let next;
      request.onsuccess=()=>{
        const current=request.result?normalize(request.result):read();
        const applied=type!=='RESET'&&current.runId!==runId?current:apply(current,type,payload,source);
        next=applied===current?current:{...applied,revision:(current.revision||0)+1,updatedAt:now(),backend:'indexeddb'};
        if(applied!==current || !request.result)store.put(next,'current');
      };
      transaction.oncomplete=()=>resolve(write(next,true));
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error||new Error('Shared transaction aborted'));
    });
  }

  function notify(next) { memoryState=next;listeners.forEach(listener=>listener(next)); }
  function contextFor(customer, context) {
    if (!context) return customer;
    const cart=Array.isArray(context.cart)?context.cart.filter(item=>config.product.sizes.includes(item.size)&&Number.isInteger(item.quantity)&&item.quantity>=1&&item.quantity<=9).slice(0,4).map(item=>({size:item.size,quantity:item.quantity})):customer.cart;
    return {...customer, selectedSize:config.product.sizes.includes(context.size)?context.size:customer.selectedSize, look:[0,1,2].includes(context.look)?context.look:customer.look, mode:['portrait','landscape'].includes(context.mode)?context.mode:customer.mode, cart, latestPageId:typeof context.pageId==='string'?context.pageId.slice(0,80):customer.latestPageId, lastSeenAt:now()};
  }

  function logEvent(state, type, payload = {}, source = 'system') {
    const event = { id: id(), type, source, payload, at: now() };
    return {
      ...state,
      events: [...state.events, event].slice(-120),
      updatedAt: event.at,
    };
  }

  function detect(state, source = 'director') {
    const detected = {
      ...state,
      stage: 'ALERT',
      signals: { ...state.signals, size: 26, detectedAt: now() },
      need: {
        ...state.need,
        detected: true,
        evidence: state.customer.needEvents.slice(-4),
      },
      customer: {
        ...state.customer,
        suggestionVisible: !state.customer.dismissed && !state.customer.accepted,
      },
      target: {
        ...state.target,
        included: state.customer.dismissed ? [] : ['A'],
        status: {
          ...state.target.status,
          A: state.customer.dismissed ? 'dismissed' : 'eligible',
        },
      },
    };
    return logEvent(detected, 'NEED_DETECTED', {
      signal: 'SIZE_SELECTION',
      from: 8,
      to: 26,
    }, source === 'customer' ? 'need-engine' : source);
  }

  function apply(state, type, payload = {}, source = 'system') {
    if (type === 'RESET') {
      const next = { ...initialState(state.runId), revision:state.revision||0 };
      return logEvent(next, 'RESET', { runId: next.runId }, source);
    }

    if (type === 'CUSTOMER_EVENT') {
      const customerId = payload.customerId || 'A';
      const eventType = payload.eventType || 'UNKNOWN';
      const isNeedEvent = customerId === 'A' && NEED_EVENTS.has(eventType);
      const needEvents = isNeedEvent
        ? [...state.customer.needEvents.filter(event => now() - event.at <= 30_000 && now() >= event.at), { type: eventType, at: now() }].slice(-20)
        : state.customer.needEvents;
      const customer = {
        ...contextFor(state.customer, payload.context),
        needEvents,
        lastEvent: { type: eventType, at: now() },
      };
      let activity = { ...counters(), ...state.activity };
      activity.eventCounts={...activity.eventCounts,[eventType]:(activity.eventCounts[eventType]||0)+1};
      const topics={SIZE_TAB_OPEN:'size',REVIEW_SIZE_VIEW:'size',SIZE_RESULT_VIEW:'size',BENEFIT_RESULT_VIEW:'benefit',STYLING_OPEN:'styling',STYLING_LOOK_CHANGE:'styling',STYLING_CATALOG_OPEN:'styling',STYLING_PRODUCT_CLICK:'styling',PRODUCT_LINK_CLICK:'product'};
      let topic=topics[eventType];
      if(eventType==='PRODUCT_DETAIL_OPEN' && payload.tab!=='size')topic='product';
      if(eventType.endsWith('_VIEW')||eventType==='STYLING_OPEN'||eventType==='STYLING_CATALOG_OPEN')customer.latestFeature=eventType;
      if (eventType === 'ASK_LIVE_SUBMIT') {
        const intent = Object.hasOwn(INTENTS, payload.intent) ? payload.intent : 'unsupported';
        activity = { ...activity, questionCount: activity.questionCount + 1, questionsByIntent: { ...activity.questionsByIntent, [intent]: (activity.questionsByIntent[intent] || 0) + 1 } };
        topic={review:'product',thickness:'product',color:'product',size:'size',benefit:'benefit',styling:'styling',delivery:'delivery'}[intent];
        payload = { customerId, eventType, intent }; // Aggregate normalized intents, never raw free-text questions.
      }
      if(topic)activity.topics={...activity.topics,[topic]:(activity.topics[topic]||0)+1};
      if(eventType==='PURCHASE_DEMO_COMPLETE'||eventType==='CART_DEMO_COMPLETE') {
        const units=eventType==='CART_DEMO_COMPLETE'?Math.min(36,Math.max(1,Math.floor(Number(payload.quantity)||1))):1;
        activity.demoPurchases++;activity.demoUnits+=units;activity.demoTotal+=units*config.benefit.final;
        payload={...payload,quantity:units,total:units*config.benefit.final,demo:true};
      }
      if(eventType==='LIVE_EXIT'||eventType==='LIVE_ENTER')customer.latestFeature=eventType;
      let next = logEvent({ ...state, customer, activity }, eventType, payload, source);
      if (isNeedEvent && needEvents.length >= 2 && !state.need.detected) next = detect(next, 'customer');
      return next;
    }

    if (type === 'SCENARIO_DETECT') return state.need.detected ? state : detect(state, source);

    if (type === 'REVIEW_ACTIONS') {
      if (state.stage !== 'ALERT') return state;
      return logEvent({ ...state, stage: 'ACTION' }, type, {}, source);
    }

    if (type === 'APPROVE_HOST') {
      if (!state.need.detected || state.approvals.host) return state;
      const message = payload.message === undefined ? HOST_MESSAGE : String(payload.message).trim().slice(0, 500);
      if (!message) return state;
      return logEvent({ ...state, stage: 'ACTION', approvals: { ...state.approvals, host: true }, actionDetails: { ...state.actionDetails, hostMessage: message, hostApprovedAt: now() } }, type, { message, delivery: 'demo-only' }, source);
    }

    if (type === 'APPROVE_APP') {
      if (!state.need.detected || state.customer.dismissed || state.approvals.app) return state;
      const next = {
        ...state,
        stage: 'ACTION',
        approvals: { ...state.approvals, app: true },
        actionDetails: { ...state.actionDetails, appApprovedAt: now(), appBaseline:actualMetrics(state) },
        target: {
          ...state.target,
          included: ['A'],
          status: { ...state.target.status, A: 'approved', B: 'excluded', C: 'excluded' },
        },
        customer: { ...state.customer, suggestionVisible: !state.customer.accepted },
      };
      return logEvent(next, type, { targetCount: 33, included: ['A'], excluded: ['B', 'C'] }, source);
    }

    if (type === 'DISMISS_SUGGESTION') {
      if (state.customer.dismissed) return state;
      const next = {
        ...state,
        target: { ...state.target, included: [], status: { ...state.target.status, A: 'dismissed' } },
        customer: { ...state.customer, suggestionVisible: false, dismissed: true },
      };
      return logEvent(next, type, { customerId: 'A', noRepeat: true }, source);
    }

    if (type === 'ACCEPT_SUGGESTION') {
      if (state.customer.dismissed || state.customer.accepted || !state.customer.suggestionVisible) return state;
      const next = {
        ...state,
        customer: { ...state.customer, suggestionVisible: false, accepted: true },
      };
      return logEvent(next, type, { customerId: 'A' }, source);
    }

    if (type === 'SHOW_RESULT') {
      if (!state.approvals.host || !state.approvals.app || state.result.visible) return state;
      const expiresAt = now() + 30_000;
      const next = {
        ...state,
        stage: 'RESULT',
        result: { visible: true, highlighted: true, highlightExpiresAt: expiresAt },
      };
      return logEvent(next, type, { highlightExpiresAt: expiresAt }, source);
    }

    if (type === 'EXPIRE_HIGHLIGHT') {
      if(!state.result.highlighted)return state;
      return logEvent({ ...state, result: { ...state.result, highlighted: false, highlightExpiresAt: null } }, type, {}, source);
    }

    if (type === 'VIDEO_EVENT') {
      const status=['playing','paused','ended','error','ready'].includes(payload.status)?payload.status:state.customer.video?.status||'unknown';
      const video={status,currentTime:Math.max(0,Number(payload.currentTime)||0),duration:Math.max(0,Number(payload.duration)||0),updatedAt:now()};
      const activity={...counters(),...state.activity};activity.eventCounts={...activity.eventCounts,VIDEO_EVENT:(activity.eventCounts.VIDEO_EVENT||0)+1};
      return logEvent({...state,activity,customer:{...contextFor(state.customer,payload.context),video}},type,{action:payload.action,...video},source);
    }
    return state;
  }

  function emit(type, payload = {}, source = 'browser', options = {}) {
    const runId=options.runId ?? read().runId;
    const frozen=JSON.parse(JSON.stringify(payload));
    const commit=()=>{
      const current=read();
      // Do not apply queued events from a previous broadcast after Reset.
      if(type!=='RESET' && current.runId!==runId)return current;
      const next=apply(current,type,frozen,source);
      return next===current?current:write(next);
    };
    if(!window.indexedDB && !canLock)return commit();
    const operation=()=>window.indexedDB?durableCommit(type,frozen,source,runId).catch(()=>{durableWorks=false;return commit();}):commit();
    pending=pending.catch(()=>{}).then(()=>canLock?window.navigator.locks.request(STORAGE_KEY,operation):operation());
    return pending;
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(read());
    return () => listeners.delete(listener);
  }

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      // Revisions reject late notifications instead of rolling the view backwards.
      const next = JSON.parse(event.newValue);
      receive(next,next.backend==='indexeddb');
    } catch (_) {
      // Ignore malformed external storage values.
    }
  });

  window.GSAILiveState = {
    STORAGE_KEY,
    NEED_EVENTS: [...NEED_EVENTS],
    INTENTS,
    HOST_MESSAGE,
    initial: initialState,
    read,
    emit,
    apply,
    subscribe,
    storageAvailable: () => storageWorks || (durableWorks && Boolean(channel)),
    serializedWrites: () => durableWorks,
    whenIdle: () => pending,
    actualMetrics,
    isHighlightActive(state = read()) {
      return Boolean(state.result.highlighted && state.result.highlightExpiresAt && state.result.highlightExpiresAt > now());
    },
  };
  // Bootstrap existing sessions from the transactional source, without resetting user data.
  if(window.indexedDB)database().then(db=>{
    const request=db.transaction('state','readonly').objectStore('state').get('current');
    request.onsuccess=()=>{if(request.result)receive(request.result,true);};
  }).catch(()=>{durableWorks=false;});
})();
