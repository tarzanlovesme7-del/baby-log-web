// Standalone logic test for the reducer — pure Node, no npm deps needed.
// Run with: node server/mutations.test.js
const assert = require('assert');
const { applyMutation } = require('./mutations');

const EMPTY_STATE = {
  entries: [], active: null, customTypes: [], memos: [], typeOrder: [],
  profile: { nameKo: '', nameVi: '', birth: '' },
};

let s = EMPTY_STATE;

let r = applyMutation(s, 'addEntry', { type: 'feed', start: new Date().toISOString(), amount: 120, author: '엄마' });
s = r.state;
assert.strictEqual(s.entries.length, 1);
const entryId = s.entries[0].id;

r = applyMutation(s, 'updateEntry', { id: entryId, amount: 150, note: 'test' });
s = r.state;
assert.strictEqual(s.entries[0].amount, 150);

r = applyMutation(s, 'startActive', { type: 'sleep', author: '아빠' });
s = r.state;
assert.ok(s.active && s.active.type === 'sleep');
const startedAt = s.active.start;

r = applyMutation(s, 'togglePauseActive', {});
s = r.state;
assert.strictEqual(s.active.paused, true);

r = applyMutation(s, 'togglePauseActive', {});
s = r.state;
assert.strictEqual(s.active.paused, false);
assert.ok(new Date(s.active.start).getTime() >= new Date(startedAt).getTime());

r = applyMutation(s, 'finishActive', {});
s = r.state;
assert.strictEqual(s.active, null);
assert.strictEqual(s.entries.length, 2);

r = applyMutation(s, 'deleteEntry', { id: entryId });
s = r.state;
assert.strictEqual(s.entries.length, 1);

/* deleting what is already gone is a quiet no-op, not a 404: two phones
   share this log, and the second one to tap delete was being told "entry
   not found" while the record sprang back onto its screen */
r = applyMutation(s, 'deleteEntry', { id: 'nope' });
assert.strictEqual(r.result.alreadyGone, true);
assert.strictEqual(r.state.entries.length, 1);
/* the same record deleted twice: still one in the bin, not two */
r = applyMutation(s, 'deleteEntry', { id: entryId });
assert.strictEqual(r.state.trash.filter((x) => x.id === entryId).length, 1);

r = applyMutation(s, 'addMemo', { text: '안녕하세요', lang: 'ko', translation: 'Xin chào', author: '엄마' });
s = r.state;
assert.strictEqual(s.memos.length, 1);

r = applyMutation(s, 'addCustomType', { name: '체온', color: '#ff0000', emoji: '🌡️' });
s = r.state;
const ctId = s.customTypes[0].id;
r = applyMutation(s, 'setTypeOrder', { order: ['feed', 'custom:' + ctId, 'diaper'] });
s = r.state;
r = applyMutation(s, 'deleteCustomType', { id: ctId });
s = r.state;
assert.strictEqual(s.customTypes.length, 0);
assert.ok(s.typeOrder.indexOf('custom:' + ctId) === -1);

r = applyMutation(s, 'setProfile', { nameKo: '지오', birth: '2026-05-11' });
s = r.state;
assert.strictEqual(s.profile.nameKo, '지오');

try {
  applyMutation(s, 'nope', {});
  assert.fail('expected throw');
} catch (e) {
  assert.strictEqual(e.status, 400);
}

console.log('ALL MUTATION TESTS PASSED');

/* ---------------- 내니 근무와 급여 ---------------- */
(function payrollTests(){
  let s = { entries: [], trash: [], memos: [], shifts: [], ot: [], payPeriods: [],
            payroll: { daily: 800000, hourly: 70000, meal: 100000, otMul: 1.5, startDate: '2026-09-16' } };

  // 내니가 오늘 도장 → 바로 반영
  s = applyMutation(s, 'stampIn', { date: '2026-09-16', today: '2026-09-16', at: '2026-09-16T01:55:00Z', actor: '내니', author: '내니' }).state;
  assert.equal(s.shifts[0].status, 'ok');

  // 내니가 지난 날짜 도장 → 승인 대기
  s = applyMutation(s, 'requestStamp', { date: '2026-09-17', actor: '내니', author: '내니' }).state;
  assert.equal(s.shifts[1].status, 'pending');

  // 같은 날 두 번은 안 된다
  assert.throws(() => applyMutation(s, 'stampIn', { date: '2026-09-16', today: '2026-09-16', actor: '내니' }), /already stamped/);

  // 내니가 넣은 오버타임은 승인 전까지 돈이 아니다
  s = applyMutation(s, 'addOt', { date: '2026-09-18', start: '18:00', end: '19:40', actor: '내니', author: '내니' }).state;
  assert.equal(s.ot[0].status, 'pending');

  // 승인은 엄마만
  assert.throws(() => applyMutation(s, 'approveOt', { id: s.ot[0].id, actor: '내니' }), /not-owner/);
  s = applyMutation(s, 'approveShift', { id: s.shifts[1].id, actor: '엄마' }).state;
  s = applyMutation(s, 'approveOt', { id: s.ot[0].id, actor: '엄마' }).state;

  // 18일 도장도 찍고 정산
  s = applyMutation(s, 'stampIn', { date: '2026-09-18', today: '2026-09-18', actor: '엄마' }).state;
  const paid = applyMutation(s, 'markPaid', { from: '2026-09-16', to: '2026-09-30', payday: '2026-09-30', actor: '엄마' });
  s = paid.state;
  const p = paid.result.period;
  // 3일 × 800,000 + 100분 × 1,750
  assert.equal(p.days, 3);
  assert.equal(p.otMin, 100);
  assert.equal(p.amount, 3 * 800000 + 175000);

  // 나중에 일급을 올려도 지난 급여는 안 움직인다
  s = applyMutation(s, 'setPayroll', { daily: 900000, actor: '엄마' }).state;
  assert.equal(s.payPeriods[0].amount, 3 * 800000 + 175000);

  // 자정을 넘긴 오버타임
  const mid = applyMutation(s, 'addOt', { date: '2026-09-19', start: '22:30', end: '00:30', actor: '엄마' });
  const o = mid.result.ot;
  assert.equal(o.status, 'ok');
  const paid2 = applyMutation(mid.state, 'markPaid', { from: '2026-09-19', to: '2026-09-19', actor: '엄마' });
  assert.equal(paid2.result.period.otMin, 120);
  console.log('payroll: ok');
})();

/* ── 수유 계획 ───────────────────────────────────────────────── */
(function feedPlanTests() {
  const base = () => ({ entries: [], memos: [], shifts: [], ot: [], payPeriods: [] });
  const run = (st, type, payload) => applyMutation(st, type, payload).state;

  let s = base();
  // 기본값이 채워져 나온다
  s = run(s, 'setFeedPlan', { actor: '엄마', perFeed: 200 });
  assert.equal(s.feedPlan.mode, 'fixed');
  assert.deepEqual(s.feedPlan.times, ['07:00', '11:00', '15:00', '19:00']);
  assert.equal(s.feedPlan.perFeed, 200);
  // 하루 목표량은 저장하지 않는다 — 1회량 × 횟수로 화면에서 낸다
  assert.equal(s.feedPlan.target, undefined);

  // 넘긴 필드만 바뀌고 나머지는 남는다
  s = run(s, 'setFeedPlan', { actor: '엄마', perFeed: 180 });
  assert.equal(s.feedPlan.perFeed, 180);
  assert.deepEqual(s.feedPlan.times, ['07:00', '11:00', '15:00', '19:00']);

  // target을 보내도 저장되지 않는다
  s = run(s, 'setFeedPlan', { actor: '엄마', target: 9999 });
  assert.equal(s.feedPlan.target, undefined);

  // 시각은 정렬되어 저장된다
  s = run(s, 'setFeedPlan', { actor: '엄마', times: ['19:00', '07:00', '13:00'] });
  assert.deepEqual(s.feedPlan.times, ['07:00', '13:00', '19:00']);

  // HH:MM이 아닌 것은 거절
  assert.throws(() => run(base(), 'setFeedPlan', { actor: '엄마', times: ['7시'] }));
  assert.throws(() => run(base(), 'setFeedPlan', { actor: '엄마', times: ['25:00'] }));
  assert.throws(() => run(base(), 'setFeedPlan', { actor: '엄마', times: [] }));

  // 범위를 벗어난 숫자는 잘린다
  s = run(base(), 'setFeedPlan', { actor: '엄마', count: 99, intervalMin: 5, perFeed: -10 });
  assert.equal(s.feedPlan.count, 12);
  assert.equal(s.feedPlan.intervalMin, 30);
  assert.equal(s.feedPlan.perFeed, 0);

  // 엄마만 바꾼다
  assert.throws(() => run(base(), 'setFeedPlan', { actor: '내니', perFeed: 100 }));
  assert.throws(() => run(base(), 'setFeedPlan', { actor: '아빠', perFeed: 100 }));

  // interval 모드
  s = run(base(), 'setFeedPlan', { actor: '엄마', mode: 'interval', intervalMin: 240, count: 4 });
  assert.equal(s.feedPlan.mode, 'interval');
  assert.equal(s.feedPlan.intervalMin, 240);
  // 모르는 모드는 fixed로
  s = run(s, 'setFeedPlan', { actor: '엄마', mode: 'nonsense' });
  assert.equal(s.feedPlan.mode, 'fixed');

  console.log('PASS  수유 계획 (setFeedPlan)');
})();
