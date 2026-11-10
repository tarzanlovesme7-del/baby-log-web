/* 첫 화면 이유식 띠의 단계 줄 — "초기 이유식" + "12일차".

   "첫화면에 이유식 배너에 / 초기 이유식 N일차 / 이렇게 떴으면 좋겠어 /
   메뉴 위에" (2026-11-10)

   단계는 식단표에 적는 칸이 아니라 지오 개월수에서 나온다. 6개월까지 초기,
   7~8 중기, 9~11 후기, 12개월부터 완료기 — 생일 하나로 저절로 넘어간다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160));
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json(); return j.data||j; };
const p2 = n => (n<10?'0':'')+n;
const ds = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const add = n => { const d = new Date(); d.setDate(d.getDate()+n); return ds(d); };
const today = add(0);
/* 오늘을 기준으로 '만 N개월 + 하루'가 되는 생일 */
const birthFor = m => { const d = new Date(); d.setMonth(d.getMonth()-m); d.setDate(d.getDate()-1); return ds(d); };

/* 띠에서 읽어오는 세 가지: 제목 · 알약 · 제목 줄이 서 있는지 */
const read = p => p.evaluate(()=>{
  const line = document.getElementById('wn-dn-line');
  return {
    shown: !!(line && !line.hidden),
    label: (document.getElementById('wn-label').textContent || '').trim(),
    stage: (document.getElementById('wn-stage').textContent || '').trim(),
    dn:    (document.getElementById('wn-dn').textContent || '').trim(),
  };
});

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' &&
    !/favicon|ERR_TUNNEL|ERR_NAME|net::ERR/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  /* 깨끗한 바닥 — 오늘이 12일차가 되도록 11일 전부터 식단을 깐다 */
  const s0 = await st();
  const hadBirth = ((s0.profile||{}).birth) || '';
  for (const k of Object.keys(s0.weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  await mut('setWeanIng', { actor:'엄마', id:'pgy',   ko:'쌀죽',   vi:'cháo gạo',  cubeG:20, isBase:true });
  await mut('setWeanIng', { actor:'엄마', id:'pgyo',  ko:'오트밀', vi:'yến mạch',  cubeG:20, isBase:true });
  await mut('setWeanIng', { actor:'엄마', id:'beef',  ko:'소고기', vi:'thịt bò',   cubeG:10 });
  await mut('setWeanIng', { actor:'엄마', id:'zucchini', ko:'애호박', vi:'bí ngòi', cubeG:10 });
  await mut('setWeanIng', { actor:'엄마', id:'bokchoy',  ko:'청경채', vi:'cải thìa', cubeG:10 });
  /* 390px에서 재료가 두 줄로 떨어지는 하루 — 줄 간격을 재려면 두 줄이어야 한다 */
  const MEAL = [{ name:'아침',
    base:[{ ing:'pgy', g:20 }, { ing:'pgyo', g:20 }],
    tops:[{ ing:'beef', g:15 }, { ing:'zucchini', g:15 }, { ing:'bokchoy', g:15 }] }];
  for (let i = -11; i <= 3; i++)
    await mut('setWeanDay', { date: add(i), actor:'엄마', meals: MEAL });

  /* ── 6개월: 초기 ───────────────────────────────────────── */
  await mut('setProfile', { birth: birthFor(6), actor:'엄마' });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  let v = await read(p);
  check('메뉴가 선 날에도 제목 줄이 서 있다', v.shown, true);
  check('6개월이면 초기 이유식', v.label, '초기 이유식');
  check('알약은 며칠차', v.stage, '12일차');
  check('시작 전 D-N 자리는 비어 있다', v.dn, '');
  check('그림(🍽️)은 빠진다', await p.evaluate(()=>!!document.getElementById('wn-emoji').hidden), true);
  check('메뉴는 그대로 아래에 깔린다',
    await p.evaluate(()=>document.querySelectorAll('#wn-meals .wn-it').length > 0), true);

  /* 제목 줄과 메뉴 사이가 재료 줄 간격보다 좁으면 '초기 이유식'이 재료
     목록의 첫 줄처럼 붙어 읽힌다 — 그래서 더 넓어야 한다(2026-11-10). */
  const gaps = await p.evaluate(()=>{
    const R = e => e.getBoundingClientRect();
    const its = [...document.querySelectorAll('#wn-meals .wn-it')].map(R);
    const top = its[0].top;
    const r1 = its.filter(x => Math.abs(x.top - top) < 2);
    const r2 = its.filter(x => x.top > top + 2);
    return {
      title: +(top - R(document.getElementById('wn-dn-line')).bottom).toFixed(1),
      row: r2.length ? +(Math.min(...r2.map(x=>x.top)) - Math.max(...r1.map(x=>x.bottom))).toFixed(1) : null,
    };
  });
  check('재료가 두 줄로 떨어진다 (간격을 잴 수 있다)', gaps.row !== null, true);
  check('제목 줄 간격이 재료 줄 간격보다 넓다 ' + JSON.stringify(gaps),
    gaps.row !== null && gaps.title > gaps.row, true);

  /* ── 7 · 8개월: 중기 ──────────────────────────────────── */
  for (const m of [7, 8]){
    await mut('setProfile', { birth: birthFor(m), actor:'엄마' });
    await p.goto(BASE + '/'); await p.waitForTimeout(1800);
    check(m + '개월이면 중기 이유식', (await read(p)).label, '중기 이유식');
  }
  /* ── 9 · 11개월: 후기 ─────────────────────────────────── */
  for (const m of [9, 11]){
    await mut('setProfile', { birth: birthFor(m), actor:'엄마' });
    await p.goto(BASE + '/'); await p.waitForTimeout(1800);
    check(m + '개월이면 후기 이유식', (await read(p)).label, '후기 이유식');
  }
  /* ── 12개월: 완료기 ───────────────────────────────────── */
  await mut('setProfile', { birth: birthFor(12), actor:'엄마' });
  await p.goto(BASE + '/'); await p.waitForTimeout(1800);
  check('12개월이면 완료기 이유식', (await read(p)).label, '완료기 이유식');

  /* ── 베트남어 ─────────────────────────────────────────── */
  await mut('setProfile', { birth: birthFor(6), actor:'엄마' });
  /* addInitScript 가 창마다 ko 를 다시 깔기 때문에 vi 는 새 창에서 본다 */
  const pv = await b.newPage({ viewport:{ width:390, height:900 } });
  await pv.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','vi'); });
  await pv.goto(BASE + '/'); await pv.waitForTimeout(2200);
  v = await read(pv);
  check('베트남어 단계 이름', v.label, 'Ăn dặm giai đoạn đầu');
  check('베트남어 며칠차', v.stage, 'ngày 12');
  await pv.close();

  /* ── 생일이 없으면 단계도 없다 ───────────────────────── */
  await mut('setProfile', { birth: '', actor:'엄마' });
  await p.goto(BASE + '/'); await p.waitForTimeout(2000);
  v = await read(p);
  check('생일이 없으면 그냥 이유식', v.label, '이유식');
  check('생일이 없어도 며칠차는 센다', v.stage, '12일차');

  /* ── 시작 전에는 D-N 한 줄, 알약 없음 ───────────────── */
  await mut('setProfile', { birth: birthFor(6), actor:'엄마' });
  for (const k of Object.keys((await st()).weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  await mut('setWeanDay', { date: add(30), actor:'엄마', meals: MEAL });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  v = await read(p);
  check('시작 전에는 제목이 이유식', v.label, '이유식');
  check('시작 전에는 D-N', v.dn, 'D-30');
  check('시작 전에는 단계 알약이 없다', v.stage, '');
  check('시작 전에는 그림이 선다', await p.evaluate(()=>!!document.getElementById('wn-emoji').hidden), false);
  /* 한 줄짜리일 때는 메뉴 위에 둘 여백이 없다 — 남아 있으면 띠 안에서
     글자가 위로 치우친다 */
  check('시작 전에는 메뉴 위 여백이 빠진다',
    await p.evaluate(()=>document.getElementById('wn-dn-line').classList.contains('wn-over-menu')), false);

  /* 뒷정리 — 다른 검사가 쓰는 식단과 생일을 건드린 채 나가지 않는다 */
  for (const k of Object.keys((await st()).weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  for (let i = 0; i < 4; i++)
    await mut('setWeanDay', { date: add(i), actor:'엄마', meals: MEAL });
  await mut('setProfile', { birth: hadBirth, actor:'엄마' });

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
