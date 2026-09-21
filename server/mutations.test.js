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

  // 같은 날 두 번 눌러도 도장은 하나 — 오류로 돌려보내면 그 쓰기가 폰의
  // 아웃박스 머리에 박혀서 뒤에 줄 선 기록을 전부 막는다
  {
    const again = applyMutation(s, 'stampIn', { date: '2026-09-16', today: '2026-09-16', actor: '내니' });
    assert.equal(again.result.alreadyStamped, true);
    assert.equal(again.state.shifts.filter((x) => x.date === '2026-09-16').length, 1);
  }

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

  // 최소 하루량은 저장하지 않는다 (1회량 × 횟수로 화면에서 낸다)
  s = run(s, 'setFeedPlan', { actor: '엄마', target: 9999 });
  assert.equal(s.feedPlan.target, undefined);
  // 목표량(goal)은 저장한다
  assert.equal(s.feedPlan.goal, 1000);
  s = run(s, 'setFeedPlan', { actor: '엄마', goal: 1100 });
  assert.equal(s.feedPlan.goal, 1100);
  s = run(s, 'setFeedPlan', { actor: '엄마', goal: 99999 });
  assert.equal(s.feedPlan.goal, 5000);

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

/* ---- 유급 연차 ---- */
(function leaveTests(){
  const base = () => ({ shifts: [], leaves: [], ot: [], payPeriods: [],
    payroll: { daily: 800000, hourly: 70000, meal: 100000, otMul: 1.5,
               startDate: '2026-08-07', leaveDays: 11, leavePay: 800000 } });
  let st = base();
  let r = applyMutation(st, 'addLeave', { date: '2026-09-22', actor: '내니', author: '내니' });
  assert.equal(r.result.leave.status, 'pending', '내니가 넣으면 승인 대기');
  st = r.state;
  r = applyMutation(st, 'approveLeave', { id: r.result.leave.id, actor: '엄마' });
  assert.equal(r.result.leave.status, 'ok', '엄마가 승인하면 확정');
  st = r.state;

  /* 엄마가 직접 넣으면 승인 절차 없이 바로 */
  r = applyMutation(st, 'addLeave', { date: '2026-09-23', actor: '엄마', author: '엄마' });
  assert.equal(r.result.leave.status, 'ok', '엄마가 넣으면 바로 확정');
  st = r.state;

  /* 같은 날 두 번은 오류가 아니다 */
  r = applyMutation(st, 'addLeave', { date: '2026-09-23', actor: '엄마' });
  assert.equal(r.result.alreadyLeave, true, '같은 날 두 번은 그냥 알려준다');
  st = r.state;
  assert.equal(st.leaves.length, 2, '...연차가 늘지 않는다');

  /* 연차인 날은 출근이 될 수 없고, 그 반대도 */
  assert.throws(() => applyMutation(st, 'stampIn', { date: '2026-09-23', today: '2026-09-23', actor: '내니' }),
    /on leave/, '연차인 날엔 도장을 못 찍는다');
  let st2 = applyMutation(st, 'stampIn', { date: '2026-09-25', today: '2026-09-25', actor: '내니' }).state;
  assert.throws(() => applyMutation(st2, 'addLeave', { date: '2026-09-25', actor: '엄마' }),
    /work day/, '출근한 날은 연차가 될 수 없다');

  /* 승인 전에는 본인이 거둘 수 있고, 승인된 것은 엄마만 */
  let st3 = applyMutation(base(), 'addLeave', { date: '2026-09-22', actor: '내니', author: '내니' }).state;
  const pid = st3.leaves[0].id;
  st3 = applyMutation(st3, 'deleteLeave', { id: pid, actor: '내니' }).state;
  assert.equal(st3.leaves.length, 0, '승인 전 자기 신청은 스스로 거둔다');
  let st4 = applyMutation(base(), 'addLeave', { date: '2026-09-22', actor: '엄마' }).state;
  assert.throws(() => applyMutation(st4, 'deleteLeave', { id: st4.leaves[0].id, actor: '내니' }),
    /not-owner/, '승인된 연차는 내니가 못 지운다');

  /* 급여에 하루치로 들어가고, 굳는다 */
  let st5 = base();
  st5 = applyMutation(st5, 'stampIn', { date: '2026-09-16', today: '2026-09-16', actor: '엄마' }).state;
  st5 = applyMutation(st5, 'addLeave', { date: '2026-09-22', actor: '엄마' }).state;
  r = applyMutation(st5, 'markPaid', { from: '2026-09-16', to: '2026-09-30', actor: '엄마' });
  assert.equal(r.result.period.amount, 1600000, '근무 1일 + 연차 1일 = 1,600,000');
  assert.equal(r.result.period.days, 1, '...근무일은 1일');
  assert.equal(r.result.period.leaveDays, 1, '...연차는 따로 1일');
  /* 연차 금액을 바꿔도 굳은 기간은 안 움직인다 */
  let st6 = applyMutation(r.state, 'setPayroll', { actor: '엄마', leavePay: 700000 }).state;
  assert.equal(st6.payPeriods[0].amount, 1600000, '굳은 금액은 안 움직인다');
  console.log('PASS  유급 연차 (addLeave/approveLeave/deleteLeave/markPaid)');
})();
