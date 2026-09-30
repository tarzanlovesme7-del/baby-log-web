/* 지급일 오버타임은 다음 급여로 넘긴다.

   급여 메모는 지급일 오후 5시에 나간다(내니 퇴근 시각). 오버타임은 그 뒤에
   붙는 일이라 이미 나간 메모에 담길 수 없다. 그래서 오버타임만 '다음 날이
   속한 기간'으로 센다 — 기간의 마지막 날 오버타임 하나만 다음 기간으로
   넘어가고 나머지 날은 그대로다.

   2026-09-30 아침에 급여 메모가 근무 12일로 나갔다. 실제는 13일이었다 —
   그날 출근 도장이 아직 안 찍힌 시각에 올라갔기 때문. 시각과 이 규칙을
   여기서 같이 못 박는다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return { status:r.status, body: await r.json().catch(()=>({})) };}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.shifts=d.shifts||[]; d.ot=d.ot||[]; d.leaves=d.leaves||[];
  d.payPeriods=d.payPeriods||[]; d.memos=d.memos||[]; return d; };
const p2 = n => String(n).padStart(2,'0');
const money = s => { const m = String(s).replace(/[^\d]/g,''); return m ? Number(m) : null; };
const OT_PER_MIN = 1750;           /* 70,000 ₫/시 × 1.5 ÷ 60 */

const NOW = new Date(), Y = NOW.getFullYear(), M = NOW.getMonth()+1, TD = NOW.getDate();
const LAST = new Date(Y, M, 0).getDate();
const ds = d => `${Y}-${p2(M)}-${p2(d)}`;
const PR = TD <= 15 ? { from: 1, to: 15 } : { from: 16, to: LAST };
/* 앞 기간의 마지막 날 = 이 기간 첫날의 하루 전 */
const PREV_END = (() => { const d = new Date(Y, M-1, PR.from); d.setDate(d.getDate()-1);
  return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; })();

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const reset = async () => {
    const s = await st();
    for (const x of s.shifts) await mut('deleteShift', { id:x.id, actor:'엄마' });
    for (const x of s.ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
    for (const x of s.leaves) await mut('deleteLeave', { id:x.id, actor:'엄마' });
    for (const x of s.payPeriods) await mut('unmarkPaid', { id:x.id, actor:'엄마' });
  };
  await mut('setPayroll', { actor:'엄마', daily:800000, hourly:70000, meal:100000,
    otMul:1.5, startDate: PREV_END, offDays:[0] });
  await reset();

  /* 앞 기간 마지막 날 오버타임 2시간 → 이 기간으로 넘어와야 한다
     이 기간 마지막 날(지급일) 오버타임 3시간 → 다음 기간으로 나가야 한다 */
  await mut('addOt', { date: PREV_END, start:'17:00', end:'19:00', actor:'엄마', author:'엄마' });
  await mut('addOt', { date: ds(PR.to), start:'17:00', end:'20:00', actor:'엄마', author:'엄마' });
  const CARRY_IN = 120 * OT_PER_MIN;    /* 210,000 */
  const CARRY_OUT = 180 * OT_PER_MIN;   /* 315,000 */

  const open = async () => {
    const p = await b.newPage({ viewport:{width:390,height:900} });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
    await p.goto(BASE+'/'); await p.waitForTimeout(1700);
    await p.click('.tab-btn[data-tab="pay"]'); await p.waitForTimeout(900);
    await p.click('#pay-tabs button[data-pv="settle"]'); await p.waitForTimeout(900);
    return p;
  };

  let p = await open();
  const card = await p.evaluate(()=>document.getElementById('pay-period').textContent);
  /* 정산 카드의 오버타임 줄은 이 기간 몫만 — 넘어온 2시간뿐이다 */
  check('이 기간 오버타임은 앞 기간에서 넘어온 것만', /오버타임 2시간/.test(card), true);
  check('...지급일 오버타임 3시간은 안 들어간다', /오버타임 5시간|오버타임 3시간/.test(card), false);

  await p.click('#pay-bydays'); await p.waitForTimeout(900);
  const rows = await p.evaluate(()=>[...document.querySelectorAll('#pp-days .pp-day')].map(r=>({
    d: r.querySelector('.pp-d').textContent.trim(),
    sub: r.querySelector('.pp-sub').textContent.trim(),
    amt: r.querySelector('.pp-amt').textContent.trim() })));
  const total = money(await p.evaluate(()=>document.querySelector('#pp-days .pp-total .t-money').textContent));

  const inRow = rows.find(r => /넘어옴/.test(r.sub));
  check('날짜별 보기 맨 위에 이월 줄이 선다', !!inRow, true);
  check('...금액이 넘어온 오버타임과 같다', money(inRow.amt), CARRY_IN);
  check('...맨 첫 줄이다', rows[0] === inRow, true);

  const outRow = rows.find(r => /다음 급여에 반영/.test(r.sub));
  check('지급일 줄은 다음 급여라고 말해준다', !!outRow, true);
  check('...그 줄은 이 기간 금액에 안 들어간다', money(outRow.amt), null);

  check('줄 금액의 합이 합계와 같다',
    rows.reduce((n,r)=> n + (money(r.amt)||0), 0), total);
  check('합계가 넘어온 오버타임만 담는다', total, CARRY_IN);
  await p.close();

  // ═══ 굳히는 금액도 같은 규칙 ═══
  await mut('markPaid', { actor:'엄마', from: ds(PR.from), to: ds(PR.to), payday: ds(PR.to) });
  const per = (await st()).payPeriods[0];
  check('입금 완료로 굳힌 오버타임 분도 넘어온 것만', per.otMin, 120);
  check('...굳힌 금액도 화면과 같다', per.amount, CARRY_IN);
  for (const x of (await st()).payPeriods) await mut('unmarkPaid', { id:x.id, actor:'엄마' });

  // ═══ 급여 메모는 오후 5시에 ═══
  const memoAt = async (hour) => {
    const s = await st();
    for (const m of s.memos.filter(m => m.paydayKey)) await mut('deleteMemo', { id:m.id, actor:'엄마' });
    /* 급여 메모의 write id는 기간에서 정해져 늘 같다 — 서버가 '이미 올렸다'고
       기억하고 있으면 두 번째 실행부터 안 올라간다. 그 기억만 비운다. */
    await fetch(BASE+'/api/forget-mids', { method:'POST' }).catch(()=>{});
    const pg = await b.newPage({ viewport:{width:390,height:900} });
    pg.on('pageerror', e => errs.push(String(e)));
    /* 그날 그 시각으로 시계를 맞춘다 — 지급일 아침과 저녁을 갈라 봐야 한다.
       install()은 타이머까지 멈춰서 앱이 안 돌아간다. 시각만 고정한다. */
    await pg.clock.setFixedTime(new Date(Y, M-1, PR.to, hour, 5, 0));
    await pg.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
    await pg.goto(BASE+'/'); await pg.waitForTimeout(1800);
    /* 급여 메모는 급여 탭이 그려질 때 올라간다 */
    await pg.click('.tab-btn[data-tab="pay"]'); await pg.waitForTimeout(1800);
    await pg.close();
    return (await st()).memos.filter(m => m.paydayKey);
  };
  /* 그날 출근이 찍혀 있어야 '빠진 하루'를 볼 수 있다 */
  await mut('stampIn', { date: ds(PR.to), actor:'내니', author:'내니',
    at: new Date(Y, M-1, PR.to, 7, 42).toISOString() });

  check('지급일 아침에는 급여 메모가 안 나간다', (await memoAt(8)).length, 0);
  const evening = await memoAt(17);
  check('오후 5시가 지나면 나간다', evening.length, 1);
  check('...그날 출근이 들어가 있다', /근무 1일/.test(evening[0].text), true);
  /* 넘어온 2시간은 이 기간 몫이라 들어가고, 지급일 3시간은 빠져야 한다 */
  check('...넘어온 오버타임 2시간은 들어가 있다', /오버타임 2시간/.test(evening[0].text), true);
  check('...지급일 오버타임 3시간은 빠져 있다',
    /오버타임 (3|5)시간/.test(evening[0].text), false);

  await reset();
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
