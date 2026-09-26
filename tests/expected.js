/* 기간이 끝나면 얼마가 될지를 큰 금액 아래 작게 세운다.

   큰 금액은 지금까지 찍힌 것뿐이라, 그게 다 나온 건지 며칠 남은 건지 알 수
   없다. 그래서 한 줄 더: 지나간 날은 기록 그대로, 아직 안 온 날은 정상 근무로
   친 합계. 내니는 월~토 근무라 일요일만 빼고 센다.

   여기서 못 박는 것:
     - 지나간 날을 '정상 근무'로 덮어쓰지 않는다 (단축 근무한 날은 그 금액대로)
     - 안 나온 지난 날을 미래처럼 세지 않는다
     - 쉬는 요일을 더하면 '남은 기간'의 그 요일만큼만 줄어든다
     - 끝난 기간·입금한 기간에는 아예 뜨지 않는다 (같은 숫자를 두 번 적는 꼴) */
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
  d.payPeriods=d.payPeriods||[]; return d; };
const p2 = n => String(n).padStart(2,'0');
const money = s => { const m = String(s).replace(/[^\d]/g,''); return m ? Number(m) : null; };
const DAILY = 800000;

const NOW = new Date(), Y = NOW.getFullYear(), M = NOW.getMonth()+1, TD = NOW.getDate();
const LAST = new Date(Y, M, 0).getDate();
const ds = d => `${Y}-${p2(M)}-${p2(d)}`;
const dow = d => new Date(Y, M-1, d).getDay();
const PR = TD <= 15 ? { from: 1, to: 15 } : { from: 16, to: LAST };
/* 오늘부터 기간 끝까지의 근무일 수 */
const remainWork = (off) => {
  let n = 0;
  for (let d = TD; d <= PR.to; d++) if (off.indexOf(dow(d)) < 0) n++;
  return n;
};

(async () => {
  /* 기간에 지나간 날이 있어야 '기록대로' 쪽을 볼 수 있다 */
  if (TD === PR.from){ console.log('SKIP  기간 첫날에는 볼 지난 날이 없다'); return; }

  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const reset = async () => {
    const s = await st();
    for (const x of s.shifts) await mut('deleteShift', { id:x.id, actor:'엄마' });
    for (const x of s.ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
    for (const x of s.leaves) await mut('deleteLeave', { id:x.id, actor:'엄마' });
    for (const x of s.payPeriods) await mut('unmarkPaid', { id:x.id, actor:'엄마' });
  };
  await mut('setPayroll', { actor:'엄마', daily: DAILY, startDate: ds(PR.from), offDays: [0] });
  await reset();

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
  const grab = txt => { const m = txt.match(/기간 끝나면 (\d+)일 · ([\d.,]+)/);
    return m ? { days: Number(m[1]), amount: money(m[2]) } : null; };
  const readCard = async () => {
    const p = await open();
    const card = grab(await p.evaluate(()=>document.getElementById('pay-period').textContent));
    await p.click('#pay-bydays'); await p.waitForTimeout(800);
    const sum = grab(await p.evaluate(()=>document.getElementById('pp-sum').textContent));
    await p.close();
    return { card, sum };
  };

  // ═══ 기록이 하나도 없을 때 — 남은 날만 센다 ═══
  let r = await readCard();
  check('정산 카드에 기간 끝나면 얼마인지 뜬다', !!r.card, true);
  check('...기록이 없으면 오늘부터 남은 근무일만', r.card.days, remainWork([0]));
  check('...금액은 그 일수 × 일급', r.card.amount, remainWork([0]) * DAILY);
  check('날짜별 보기 요약에도 같은 값', r.sum, r.card);

  // ═══ 지나간 날은 기록대로 — 정상 근무로 덮어쓰지 않는다 ═══
  /* 어제(쉬는 날이면 그 전날)를 11시 퇴근으로 만든다 */
  let past = TD - 1;
  while (past >= PR.from && dow(past) === 0) past--;
  if (past >= PR.from){
    await mut('stampIn', { date: ds(past), actor:'내니', author:'내니',
      at: new Date(Y, M-1, past, 7, 42).toISOString() });
    const sh = (await st()).shifts.find(x => x.date === ds(past));
    await mut('setShiftTimes', { id: sh.id, end:'11:00', actor:'엄마', author:'엄마' });
    const short = 380000;   /* 07:00–11:00 = 4시간 → 70,000×4 + 식대 100,000 */
    r = await readCard();
    check('지나간 날은 기록대로 더한다 (단축 근무는 그 금액으로)',
      r.card.amount, remainWork([0]) * DAILY + short);
    check('...일수는 하루 늘어난다', r.card.days, remainWork([0]) + 1);
    check('...정상 근무 하루치로 덮어쓰지 않는다',
      r.card.amount === remainWork([0]) * DAILY + DAILY, false);
  }

  // ═══ 안 나온 지난 날은 0으로 남는다 ═══
  const worked = (await st()).shifts.length;
  const pastWork = (() => { let n = 0;
    for (let d = PR.from; d < TD; d++) if (dow(d) !== 0) n++; return n; })();
  check('안 나온 지난 날을 미래처럼 세지 않는다',
    r.card.days, remainWork([0]) + worked);
  check('...(그 기간에 안 나온 날이 실제로 있다)', pastWork > worked, true);

  // ═══ 쉬는 요일을 더하면 남은 기간의 그 요일만큼만 줄어든다 ═══
  const before = r.card;
  await mut('setPayroll', { actor:'엄마', offDays: [0, 6] });
  r = await readCard();
  check('토요일도 쉬면 남은 기간의 토요일만큼 줄어든다',
    r.card.days, before.days - (remainWork([0]) - remainWork([0,6])));
  check('...지나간 토요일 기록은 그대로 남는다',
    r.card.amount, before.amount - (remainWork([0]) - remainWork([0,6])) * DAILY);
  await mut('setPayroll', { actor:'엄마', offDays: [0] });

  // ═══ 입금한 기간에는 안 뜬다 ═══
  await mut('markPaid', { actor:'엄마', from: ds(PR.from), to: ds(PR.to), payday: ds(PR.to) });
  r = await readCard();
  check('입금 완료한 기간에는 뜨지 않는다 (같은 숫자를 두 번 적는 꼴)', r.card, null);
  for (const x of (await st()).payPeriods) await mut('unmarkPaid', { id:x.id, actor:'엄마' });

  // ═══ 이미 끝난 기간에도 안 뜬다 ═══
  const prevTo = PR.from === 1 ? null : ds(15);
  if (prevTo){
    await mut('setPayroll', { actor:'엄마', startDate: ds(1) });
    await mut('stampIn', { date: ds(2), actor:'내니', author:'내니',
      at: new Date(Y, M-1, 2, 7, 42).toISOString() });
    const p = await open();
    await p.click('[data-pp-open]'); await p.waitForTimeout(900);
    check('이미 끝난 기간에도 뜨지 않는다',
      grab(await p.evaluate(()=>document.getElementById('pp-sum').textContent)), null);
    await p.close();
    await mut('setPayroll', { actor:'엄마', startDate: ds(PR.from) });
  }

  // ═══ 쉬는 요일 설정 자체 ═══
  await reset();
  await mut('setPayroll', { actor:'엄마', offDays: [0,1,2,3,4,5,6] });
  check('이레 전부 쉬는 날로는 못 둔다', (await st()).payroll.offDays, [0]);
  await mut('setPayroll', { actor:'엄마', offDays: [] });
  check('...아무 요일도 안 쉬는 것도 마찬가지', (await st()).payroll.offDays, [0]);
  await mut('setPayroll', { actor:'엄마', offDays: ['x', 9, -1, 3, 3] });
  check('...이상한 값은 걸러서 쓸 수 있는 것만 남긴다', (await st()).payroll.offDays, [3]);
  await mut('setPayroll', { actor:'엄마', offDays: [0] });
  const bad = await mut('setPayroll', { actor:'내니', offDays: [0,6] });
  check('내니는 쉬는 요일을 못 바꾼다', bad.status, 403);
  check('...값도 그대로', (await st()).payroll.offDays, [0]);

  const p = await b.newPage({ viewport:{width:390,height:900} });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await p.goto(BASE+'/'); await p.waitForTimeout(1700);
  await p.click('#btn-settings'); await p.waitForTimeout(800);
  await p.click('[data-set-go="pay"]'); await p.waitForTimeout(800);
  check('요일 칩이 일곱 개', await p.evaluate(()=>document.querySelectorAll('[data-pay-off]').length), 7);
  check('...일요일만 눌려 있다', await p.evaluate(()=>
    [...document.querySelectorAll('[data-pay-off]')].map(b=>b.getAttribute('aria-pressed'))),
    ['true','false','false','false','false','false','false']);
  check('...한 줄에 들어간다', await p.evaluate(()=>{
    const els = [...document.querySelectorAll('[data-pay-off]')];
    const top = els[0].getBoundingClientRect().top;
    return els.every(e => Math.abs(e.getBoundingClientRect().top - top) < 2) &&
           els[6].getBoundingClientRect().right <= window.innerWidth; }), true);
  await p.click('[data-pay-off="6"]'); await p.waitForTimeout(1200);
  check('토요일을 누르면 저장된다', (await st()).payroll.offDays, [0,6]);
  await p.click('[data-pay-off="6"]'); await p.waitForTimeout(1200);
  check('...다시 누르면 풀린다', (await st()).payroll.offDays, [0]);
  await p.close();

  await reset();
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
