/* 언어를 바꾸면 일과표도 따라 바뀐다.

   "베트남어 버전으로 바꾸면 일과표 범례는 한국어로 남아있음" (2026-11-04)

   일과표는 renderAll() 에서 일부러 빼 두었다 — 4초마다 도는 폴링이 날짜
   칸 스크롤을 오늘로 되감기 때문이다. 그래서 언어만 바꾸면 범례와 요일이
   한국어로 남았다. 폴링이 아니라 **사람이 언어를 누른 때**만 다시 그린다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,140)); }

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  /* 범례는 기록에서 나온다 — 이 기간에 적힌 항목만 스위치가 선다 */
  const iso = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  await mut('addEntry', { type:'feed', start: iso(7), amount: 180, author:'엄마' });
  await mut('addEntry', { type:'sleep', start: iso(13), end: iso(15), author:'엄마' });
  await mut('addEntry', { type:'bath', start: iso(19), author:'엄마' });

  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{
    localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko');
    localStorage.removeItem('bbl_pattern_off');
  });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('.tab-btn[data-tab="stats"]'); await p.waitForTimeout(1200);

  const legend = () => p.evaluate(()=>
    [...document.querySelectorAll('#pattern-toggles button')].map(e=>e.textContent.trim()));
  const days = () => p.evaluate(()=>
    [...document.querySelectorAll('#pattern-cols .pattern-col-label')].map(e=>e.textContent.trim()));
  const anyKo = (a) => a.some(x=>/[가-힣]/.test(x));

  const ko = await legend();
  check('한국어에서 범례가 선다', ko.length > 0, true);
  check('...한국어로 적힌다', anyKo(ko), true);

  /* 언어 알약을 실제로 누른다 — 새로고침이 아니라 그 자리에서 */
  await p.click('.lang-pill button[data-lang="vi"]'); await p.waitForTimeout(1200);
  const vi = await legend();
  check('베트남어로 바꾸면 범례도 바뀐다', vi.length, ko.length);
  check('...한글이 한 글자도 남지 않는다', anyKo(vi), false);
  check('...붙박이 항목이 베트남어로 적힌다',
    vi.filter(x=>/Bú sữa|Ngủ|Tắm/.test(x)).length, 3);

  const vd = await days();
  if (vd.length){
    check('요일도 베트남어로 바뀐다', anyKo(vd), false);
  } else {
    check('요일 칸을 찾았다', vd.length > 0, true);
  }

  /* 되돌려도 따라온다 */
  await p.click('.lang-pill button[data-lang="ko"]'); await p.waitForTimeout(1200);
  check('한국어로 되돌리면 범례도 돌아온다', await legend(), ko);

  /* 폴링이 스크롤을 되감지 않는지 — 언어를 안 건드리면 다시 그리지 않는다 */
  await p.evaluate(()=>{ const t=document.getElementById('pattern-toggles');
    if (t) t.dataset.touched = '1'; });
  await p.evaluate(()=> window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);
  check('언어를 안 바꾸면 일과표를 다시 그리지 않는다',
    await p.evaluate(()=>document.getElementById('pattern-toggles').dataset.touched), '1');

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
