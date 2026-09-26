/* 급여 탭의 세로 틈은 한 값이어야 한다.

   2026-09-24: 오늘 카드와 캘린더 사이만 30px로 벌어져 있었다. 소스에는
   gap:10px 한 줄뿐이라 읽어서는 절대 못 찾는다 — 범인은 '승인 대기'와
   '내 근무'였다. 둘 다 비어서 높이가 0인데도 flex 항목이라 자리를 차지하고,
   앞뒤로 10px 틈을 하나씩 더 만들고 있었다.

   그래서 소스가 아니라 렌더 결과에서 잰다: 보이는 형제들 사이의 간격이
   전부 같은 값인가. 예외는 섹션 제목 위 한 곳뿐 — 거긴 일부러 한 칸 띄운다. */
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

/* 보이는 형제들 사이의 간격과, 그 틈이 섹션 제목 위인지 */
const measure = p => p.evaluate(()=>{
  const tab = document.getElementById('tab-pay');
  const panel = [...tab.querySelectorAll('.ins-panel')].find(e => !e.hidden && e.offsetParent);
  const kids = [...panel.children].filter(e => e.offsetParent && getComputedStyle(e).display !== 'none');
  const gap = Math.round(parseFloat(getComputedStyle(panel).rowGap || getComputedStyle(panel).gap));
  const out = [];
  for (let i = 1; i < kids.length; i++){
    out.push({
      what: (kids[i-1].id || kids[i-1].className) + ' → ' + (kids[i].id || kids[i].className),
      px: Math.round(kids[i].getBoundingClientRect().top - kids[i-1].getBoundingClientRect().bottom),
      beforeTitle: kids[i].classList.contains('section-title')
    });
  }
  /* 서브탭과 첫 카드 사이도 같은 틈이어야 한다 */
  const tabs = document.getElementById('pay-tabs');
  if (tabs && kids.length) out.unshift({ what: '서브탭 → 첫 카드',
    px: Math.round(kids[0].getBoundingClientRect().top - tabs.getBoundingClientRect().bottom),
    beforeTitle: false });
  /* 높이 0짜리가 자리를 차지하고 있지 않은지 — 이번 버그의 모양 그대로 */
  const ghosts = kids.filter(e => e.getBoundingClientRect().height === 0)
    .map(e => e.id || e.className);
  return { gap: gap, rows: out, ghosts: ghosts };
});

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  await mut('setPayroll', { actor:'엄마', startDate: D(-45) });
  const s0 = await st();
  for (const x of s0.shifts.filter(s=>s.date===D(0))) await mut('deleteShift', { id:x.id, actor:'엄마' });
  for (const x of s0.ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  await mut('stampIn', { date: D(0), actor:'내니', author:'내니', at:new Date().toISOString() });
  await mut('addOt', { date: D(0), start:'17:00', end:'20:00', actor:'엄마', author:'엄마' });

  for (const who of ['엄마', '내니']){
    const p = await b.newPage({ viewport:{width:390,height:900} });
    p.on('pageerror', e => errs.push(who + ': ' + String(e)));
    await p.addInitScript(w=>{ localStorage.setItem('bbl_author', w); localStorage.setItem('bbl_lang','ko'); }, who);
    await p.goto(BASE + '/'); await p.waitForTimeout(1800);
    await p.click('.tab-btn[data-tab="pay"]'); await p.waitForTimeout(1100);

    for (const view of ['stamp', 'settle']){
      if (view === 'settle'){
        await p.click('#pay-tabs button[data-pv="settle"]'); await p.waitForTimeout(1000);
      }
      const m = await measure(p);
      const tag = who + ' · ' + (view === 'stamp' ? '출근 도장' : '정산');
      check(tag + ' — 빈 칸이 자리를 차지하지 않는다', m.ghosts, []);
      check(tag + ' — 카드 사이 틈이 전부 같다',
        m.rows.filter(r => !r.beforeTitle).map(r => r.px)
          .filter((v, i, a) => a.indexOf(v) === i),
        [m.gap]);
      check(tag + ' — 섹션 제목 위만 한 칸 더 띄운다',
        m.rows.filter(r => r.beforeTitle).every(r => r.px > m.gap), true);
    }
    await p.close();
  }

  for (const x of (await st()).ot) await mut('deleteOt', { id:x.id, actor:'엄마' });
  for (const x of (await st()).shifts.filter(s=>s.date===D(0))) await mut('deleteShift', { id:x.id, actor:'엄마' });
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
