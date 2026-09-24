/* 오늘 카드와 날짜 카드는 같은 돈을 말해야 한다.

   2026-09-24: 내니가 3시간 오버타임을 올리고 엄마가 승인했는데, 맨 위 오늘
   카드는 여전히 800,000₫ 하루치만 보여줬다. 캘린더 아래 날짜 카드는 제대로
   더하고 있었다 — 같은 계산이 두 벌 있었고 한 벌만 자랐다. 그래서 여기서는
   "오늘 카드 금액 == 날짜 카드의 이 날 일당"을 못으로 박는다. 한쪽만 고치면
   빨간불이 난다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return { status:r.status, body: await r.json().catch(()=>({})) };}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.shifts=d.shifts||[]; d.ot=d.ot||[]; return d; };
const D = d => { const x=new Date(); x.setDate(x.getDate()+d);
  return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
/* "1,115,000 ₫" → 1115000. 화면에 적힌 글자에서 읽는다 — 계산식을 다시
   쓰면 같은 실수를 두 번 하게 된다. */
const money = s => { const m = String(s).replace(/[^\d]/g,''); return m ? Number(m) : null; };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  await mut('setPayroll', { actor:'엄마', startDate: D(-45) });
  const s0 = await st();
  for (const x of s0.shifts.filter(s=>s.date===D(0))) await mut('deleteShift', { id:x.id, actor:'엄마' });
  for (const x of s0.ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  await mut('stampIn', { date: D(0), actor:'내니', author:'내니', at:new Date().toISOString() });

  const open = async () => {
    const p = await b.newPage({ viewport:{width:390,height:880} });
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
    await p.goto(BASE+'/'); await p.waitForTimeout(1800);
    await p.click('.tab-btn[data-tab="pay"]'); await p.waitForTimeout(1100);
    return p;
  };
  const topMoney = p => p.evaluate(()=>{ const e=document.querySelector('#pay-today .pay-row .t-money');
    return e ? e.textContent : null; });
  const dayMoney = p => p.evaluate(()=>{
    const lines = [...document.querySelectorAll('#pay-day .pay-line')];
    const row = lines.find(l => l.querySelector('b'));
    return row ? row.querySelector('.t-money').textContent : null; });

  // ═══ 오버타임 없는 날: 하루치 그대로 ═══
  let p = await open();
  check('오버타임 전에는 일당만', money(await topMoney(p)), 800000);
  await p.close();

  // ═══ 승인된 오버타임 3시간(180분 × 1,750₫ = 315,000₫) ═══
  const ok = await mut('addOt', { date:D(0), start:'17:00', end:'20:00', actor:'엄마', author:'엄마' });
  check('엄마가 넣은 오버타임은 바로 확정된다',
    (await st()).ot.filter(o=>o.date===D(0)).map(o=>o.status), ['ok']);
  p = await open();
  check('오늘 카드 금액에 오버타임이 더해진다', money(await topMoney(p)), 1115000);
  check('...오버타임 줄이 보인다',
    await p.evaluate(()=>/오버타임/.test(document.getElementById('pay-today').textContent)), true);
  check('...몇 시부터 몇 시까지인지 적혀 있다',
    await p.evaluate(()=>/17:00.20:00/.test(document.getElementById('pay-today').textContent)), true);

  /* 같은 날을 캘린더에서 눌러 연 카드와 금액이 같아야 한다 — 이게 이 파일의 핵심 */
  await p.click('[data-payday="'+D(0)+'"]'); await p.waitForTimeout(800);
  check('날짜 카드의 이 날 일당과 같다', money(await dayMoney(p)), money(await topMoney(p)));
  await p.close();

  // ═══ 승인 대기 중인 오버타임은 금액에 안 들어간다 ═══
  for (const x of (await st()).ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  await mut('addOt', { date:D(0), start:'17:00', end:'18:00', actor:'내니', author:'내니' });
  check('내니가 올린 오버타임은 대기 상태', (await st()).ot.map(o=>o.status), ['pending']);
  p = await open();
  check('대기 중인 오버타임은 금액에 안 더해진다', money(await topMoney(p)), 800000);
  check('...그래도 줄은 보이고 승인 대기라고 적힌다',
    await p.evaluate(()=>{ const x=document.getElementById('pay-today').textContent;
      return /오버타임/.test(x) && /승인|요청/.test(x); }), true);
  await p.close();

  for (const x of (await st()).ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  for (const x of (await st()).shifts.filter(s=>s.date===D(0))) await mut('deleteShift', { id:x.id, actor:'엄마' });
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
