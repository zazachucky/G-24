import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../public/gs-ai-live-state.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../public/gs-live-config.js', import.meta.url), 'utf8');

function rules({ clock = Date, denyStorage = false } = {}) {
  const listeners = [];
  const storage = new Map();
  const window = {
    localStorage: {
      getItem: key => { if (denyStorage) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (denyStorage) throw new Error('Storage unavailable'); storage.set(key, value); },
    },
    addEventListener: (type, listener) => listeners.push([type, listener]),
  };
  vm.runInNewContext(config+'\n'+source, { window, Date: clock, Math, JSON, Set, Boolean, Number, String });
  return window.GSAILiveState;
}

function runScenario(rules, current) {
  current = rules.apply(current, 'CUSTOMER_EVENT', { customerId: 'A', eventType: 'ASK_SIZE' }, 'customer');
  current = rules.apply(current, 'CUSTOMER_EVENT', { customerId: 'A', eventType: 'SIZE_TAB_OPEN' }, 'customer');
  assert.equal(current.signals.size, 26);
  assert.equal(current.need.detected, true);
  assert.deepEqual(Array.from(current.target.included), ['A']);
  assert.deepEqual(Array.from(current.target.excluded), ['B', 'C']);
  current = rules.apply(current, 'APPROVE_HOST', {}, 'director');
  current = rules.apply(current, 'APPROVE_APP', {}, 'director');
  assert.equal(JSON.stringify(current.target.status), JSON.stringify({ A: 'approved', B: 'excluded', C: 'excluded' }));
  current = rules.apply(current, 'SHOW_RESULT', {}, 'director');
  assert.equal(current.result.visible, true);
  assert.equal(current.result.highlighted, true);
  current = rules.apply(current, 'EXPIRE_HIGHLIGHT', {}, 'timer');
  assert.equal(current.result.highlighted, false);
  return current;
}

test('shared reducer reproduces 8 to 26, A-only target, approval, result, and expiry', () => {
  const state = rules();
  let current = state.initial();
  for (let run = 1; run <= 3; run += 1) {
    current = runScenario(state, current);
    current = state.apply(current, 'RESET', {}, 'test');
    assert.equal(current.runId, run + 1);
    assert.equal(current.signals.size, 8);
    assert.equal(current.approvals.host, false);
    assert.equal(current.approvals.app, false);
  }
});

test('dismissal prevents duplicate targeting in the same run', () => {
  const state = rules();
  let current = state.initial();
  current = state.apply(current, 'SCENARIO_DETECT', {}, 'director');
  current = state.apply(current, 'APPROVE_APP', {}, 'director');
  current = state.apply(current, 'DISMISS_SUGGESTION', {}, 'customer');
  assert.equal(current.customer.dismissed, true);
  assert.deepEqual(Array.from(current.target.included), []);
  const unchanged = state.apply(current, 'APPROVE_APP', {}, 'director');
  assert.deepEqual(Array.from(unchanged.target.included), []);
});

test('only two A size events within 30 seconds detect; stale events and unrelated actions do not', () => {
  let time = 1_000_000;
  const rule = rules({ clock: { now: () => time } });
  let state = rule.initial();
  const event = (type, id = 'A') => { state = rule.apply(state, 'CUSTOMER_EVENT', { customerId: id, eventType: type }, 'customer'); };
  event('SIZE_TAB_OPEN', 'B'); event('REVIEW_SIZE_VIEW', 'C'); event('BENEFIT_RESULT_VIEW');
  assert.equal(state.need.detected, false);
  assert.equal(state.customer.needEvents.length, 0);
  event('SIZE_TAB_OPEN'); time += 30_001; event('REVIEW_SIZE_VIEW');
  assert.equal(state.need.detected, false);
  assert.equal(state.customer.needEvents.length, 1);
  time += 30_000; event('SIZE_TAB_OPEN');
  assert.equal(state.need.detected, true);
  assert.equal(state.customer.suggestionVisible, true);
  assert.equal(state.need.evidence.length, 2);
});

test('acceptance and approvals are idempotent; result highlight expires with wall clock', () => {
  let time = 1_000_000;
  const rule = rules({ clock: { now: () => time } });
  let state = rule.apply(rule.initial(), 'SCENARIO_DETECT');
  state = rule.apply(state, 'ACCEPT_SUGGESTION');
  assert.equal(rule.apply(state, 'ACCEPT_SUGGESTION'), state);
  state = rule.apply(state, 'APPROVE_APP');
  assert.equal(state.customer.suggestionVisible, false);
  assert.equal(rule.apply(state, 'APPROVE_APP'), state);
  state = rule.apply(state, 'APPROVE_HOST');
  assert.equal(rule.apply(state, 'APPROVE_HOST'), state);
  state = rule.apply(state, 'SHOW_RESULT');
  assert.equal(rule.isHighlightActive(state), true);
  assert.equal(rule.apply(state, 'SHOW_RESULT'), state);
  time += 30_000;
  assert.equal(rule.isHighlightActive(state), false);
});

test('disabled storage retains same-tab state and honestly reports lack of cross-tab transport', () => {
  const rule = rules({ denyStorage: true });
  rule.emit('CUSTOMER_EVENT', { eventType: 'SIZE_TAB_OPEN' });
  rule.emit('CUSTOMER_EVENT', { eventType: 'REVIEW_SIZE_VIEW' });
  assert.equal(rule.read().need.detected, true);
  assert.equal(rule.storageAvailable(), false);
  rule.emit('DISMISS_SUGGESTION');
  rule.emit('APPROVE_APP');
  assert.equal(rule.read().customer.dismissed, true);
  assert.equal(rule.read().customer.suggestionVisible, false);
});

test('review stage, edited host receipt and app timestamp all share one persisted state', () => {
  const rule=rules();
  rule.emit('SCENARIO_DETECT');rule.emit('REVIEW_ACTIONS');
  assert.equal(rule.read().stage,'ACTION');
  const rejected=rule.apply(rule.read(),'APPROVE_HOST',{message:'  '});
  assert.equal(rejected.approvals.host,false);
  rule.emit('APPROVE_HOST',{message:'  승인한 사이즈 안내문  '});
  rule.emit('APPROVE_APP');
  assert.equal(rule.read().actionDetails.hostMessage,'승인한 사이즈 안내문');
  assert.ok(rule.read().actionDetails.hostApprovedAt>0);
  assert.ok(rule.read().actionDetails.appApprovedAt>0);
  assert.equal(rule.read().events.find(event=>event.type==='APPROVE_HOST').payload.delivery,'demo-only');
});

test('question aggregation outlives the bounded event log, omits raw text and resets', () => {
  const rule=rules();
  for(let i=0;i<125;i++)rule.emit('CUSTOMER_EVENT',{eventType:'ASK_LIVE_SUBMIT',intent:'thickness',question:'must not persist raw customer text'});
  rule.emit('CUSTOMER_EVENT',{eventType:'ASK_LIVE_SUBMIT',intent:'unknown'});
  const state=rule.read();
  assert.equal(state.activity.questionCount,126);
  assert.equal(state.activity.questionsByIntent.thickness,125);
  assert.equal(state.activity.questionsByIntent.unsupported,1);
  assert.equal(state.events.length,120);
  assert.equal(JSON.stringify(state).includes('must not persist'),false);
  rule.emit('RESET');assert.equal(rule.read().activity.questionCount,0);
});

test('customer snapshot, cart telemetry, actual commerce and approval baseline are connected', () => {
  const rule=rules();
  const context={size:'77',look:2,mode:'landscape',pageId:'test-mobile',cart:[{size:'77',quantity:2},{size:'999',quantity:1}]};
  rule.emit('CUSTOMER_EVENT',{eventType:'STYLING_LOOK_CHANGE',look:2,context});
  rule.emit('CUSTOMER_EVENT',{eventType:'SIZE_RESULT_VIEW',context});
  rule.emit('SCENARIO_DETECT');rule.emit('APPROVE_APP');
  const baseline=rule.read().actionDetails.appBaseline;
  assert.equal(baseline.size,1);
  rule.emit('CUSTOMER_EVENT',{eventType:'SIZE_RESULT_VIEW',context});
  rule.emit('CUSTOMER_EVENT',{eventType:'PURCHASE_CLICK',context});
  rule.emit('CUSTOMER_EVENT',{eventType:'CART_DEMO_COMPLETE',quantity:2,price:1,context:{...context,cart:[]}});
  rule.emit('VIDEO_EVENT',{status:'paused',currentTime:12,duration:57,context:{...context,cart:[]}});
  const state=rule.read();
  assert.equal(state.customer.selectedSize,'77');assert.equal(state.customer.look,2);assert.equal(state.customer.mode,'landscape');assert.equal(state.customer.cart.length,0);
  assert.equal(state.customer.video.currentTime,12);
  assert.equal(rule.actualMetrics(state).size,2);assert.equal(state.actionDetails.appBaseline.size,1);
  assert.equal(state.activity.demoPurchases,1);assert.equal(state.activity.demoUnits,2);assert.equal(state.activity.demoTotal,91030);
  assert.equal(state.activity.topics.styling,1);assert.equal(state.activity.topics.size,2);
});

test('late events from the previous broadcast cannot affect the next run', () => {
  const rule=rules();const previous=rule.read().runId;
  rule.emit('RESET');const revision=rule.read().revision;
  rule.emit('CUSTOMER_EVENT',{eventType:'ASK_LIVE_SUBMIT',intent:'size'},'late',{runId:previous});
  assert.equal(rule.read().activity.questionCount,0);assert.equal(rule.read().revision,revision);
  rule.emit('CUSTOMER_EVENT',{eventType:'ASK_LIVE_SUBMIT',intent:'size'});
  assert.equal(rule.read().activity.questionCount,1);
});
