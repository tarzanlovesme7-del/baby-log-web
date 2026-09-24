/* 정산 → 날짜별로 보기.

   정산 카드는 "근무 8일 · 5,980,000 ₫"까지만 말한다. 어느 날이 800,000이고
   어느 날이 왜 380,000인지는 이 화면에서 본다. 여기서 못 박는 것:
     - 합계가 정산 카드 금액과 한 푼도 안 틀린다(같은 값 두 벌 = 갈라질 자리)
     - 엄마도 내니도 연다 — 자기 급여가 어떻게 나왔는지 읽는 걸 막지 않는다
     - 날짜 라벨이 깨지지 않는다. '9월 21일 (월)'에서 앞을 탐욕적으로 잘랐더니
       '(월'까지 먹고 ')'만 남았다 — 월요일에만 나는 버그라 눈으로 놓치기 쉽다 */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return { status:r.status, body: await r.json().catch(()=>({})) };}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.shifts=d.shifts||[]; d.ot=d.ot||[]; d.leaves=d.leaves||[]; return d; };
const p2 = n => String(n).padStart(2,'0');
const money = s => { const m = String(s).replace(/[^\d]/g,''); return m ? Number(m) : null; };

(async () => {
  const now = new Date(), Y = now.getFullYear(), M = now.getMonth()+1, TD = now.getDate();
  const ds = d => Y + '-' + p2(M) + '-' + p2(d);
  /* 16일 이후여야 이번 기간(16~말일)에 근무가 들어간다. 1~15일에 돌리면
     이 테스트가 볼 것이 없으니, 그 땐 조용히 넘어간다. */
  if (TD < 17){ console.log('SKIP  16~말일 기간에서만 도는 테스트 (오늘 ' + TD + '일)'); return; }

  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  await mut('setPayroll', { actor:'엄마', startDate: ds(1) });
  const s0 = await st();
  for (const x of s0.shifts) await mut('deleteShift', { id:x.id, actor:'엄마' });
  for (const x of s0.ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  for (const x of s0.leaves) await mut('deleteLeave', { id:x.id, actor:'엄마' });

  /* 16일부터 오늘까지 근무, 딱 하루(17일)는 쉬는 날로 비워둔다 */
  for (let d = 16; d <= TD; d++){
    if (d === 17) continue;
    await mut('stampIn', { date: ds(d), actor:'내니', author:'내니',
      at: new Date(Y, M-1, d, 7, 42).toISOString() });
  }
  await mut('addOt', { date: ds(TD), start:'17:00', end:'20:00', actor:'엄마', author:'엄마' });

  const open = async (who) => {
    const p = await b.newPage({ viewport:{width:390,height:900} });
    p.on('pageerror', e => errs.push(who + ': ' + String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(who+': '+m.text()); });
    await p.addInitScript(w=>{ localStorage.setItem('bbl_author', w); localStorage.setItem('bbl_lang','ko'); }, who);
    await p.goto(BASE + '/'); await p.waitForTimeout(1800);
    await p.click('.tab-btn[data-tab="pay"]'); await p.waitForTimeout(900);
    await p.click('#pay-tabs button[data-pv="settle"]'); await p.waitForTimeout(900);
    return p;
  };
  const shown = p => p.evaluate(()=>{
    const f = document.getElementById('fp-payperiod');
    return !!f && f.classList.contains('show'); });

  // ═══ 엄마 ═══
  let p = await open('엄마');
  const cardAmount = money(await p.evaluate(()=>document.querySelector('#pay-period .t-money.big').textContent));
  check('정산 카드에 "날짜별로 보기"가 있다',
    await p.evaluate(()=>!!document.getElementById('pay-bydays')), true);
  await p.click('#pay-bydays'); await p.waitForTimeout(800);
  check('...누르면 열린다', await shown(p), true);

  check('제목이 기간이다',
    await p.evaluate(()=>/–/.test(document.getElementById('fp-pp-title').textContent)), true);
  const total = money(await p.evaluate(()=>document.querySelector('#pp-days .pp-total .t-money').textContent));
  check('합계가 정산 카드 금액과 같다', total, cardAmount);
  check('...요약 금액과도 같다',
    money(await p.evaluate(()=>document.querySelector('#pp-sum .t-money.big').textContent)), cardAmount);

  const rows = await p.evaluate(()=>[...document.querySelectorAll('#pp-days .pp-day')].map(r=>({
    d: r.querySelector('.pp-d').textContent.trim(),
    sub: r.querySelector('.pp-sub').textContent.trim(),
    amt: r.querySelector('.pp-amt').textContent.trim() })));
  check('기간의 날이 빠짐없이 한 줄씩', rows.length,
    new Date(Y, M, 0).getDate() - 15);
  check('날짜 라벨이 깨지지 않는다 (월요일 포함)',
    rows.every(r => /^\d+일\s*\(.\)$/.test(r.d)), true);
  check('안 나온 날도 회색 줄로 남는다',
    rows.filter(r => /쉬는 날/.test(r.sub)).length, 1);
  check('...그 줄은 금액이 없다',
    rows.find(r => /쉬는 날/.test(r.sub)).amt, '—');
  check('오버타임이 붙은 날은 합쳐진 금액 하나로 적힌다',
    money(rows.find(r => /오버타임/.test(r.sub)).amt), 1115000);
  check('...+더해진 몫을 따로 적지 않는다 (140만처럼 읽혔다)',
    /\+/.test(rows.find(r => /오버타임/.test(r.sub)).amt), false);

  /* 줄 금액을 다 더하면 합계가 나온다 — 화면 안에서 앞뒤가 맞는지 */
  check('줄 금액의 합이 합계와 같다',
    rows.reduce((n,r)=> n + (money(r.amt)||0), 0), total);
  await p.close();

  // ═══ 내니도 본다 ═══
  p = await open('내니');
  check('내니 폰에도 "날짜별로 보기"가 있다',
    await p.evaluate(()=>!!document.getElementById('pay-bydays')), true);
  await p.click('#pay-bydays'); await p.waitForTimeout(800);
  check('...내니도 열 수 있다', await shown(p), true);
  check('...같은 합계를 본다',
    money(await p.evaluate(()=>document.querySelector('#pp-days .pp-total .t-money').textContent)), total);
  await p.evaluate(()=>document.getElementById('fp-pp-back').click());
  await p.waitForTimeout(500);
  check('뒤로 가기로 닫힌다', await shown(p), false);
  await p.close();

  for (const x of (await st()).ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  for (const x of (await st()).shifts) await mut('deleteShift', { id:x.id, actor:'엄마' });
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
