/* 식단 표 — 달력 옆에 붙는 두 번째 보기.

   "모바일에서 캘린더도 좋은데 표로 식단 쭉 안 짤리고 볼 수 있는 뷰도
   있었으면" / "기존 캘린더는 살렸으면 좋겠어" (2026-11-11)

   열이 끼니, 행이 날짜, 같은 식단이 이어지면 칸 하나. 반복을
   글자가 아니라 칸 모양으로 말하므로 '전날과 같음' 같은 줄이 없고,
   끼니는 열이 말하므로 줄마다 이름을 다시 적지 않는다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160)); }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json(); return j.data||j; };
const B = [{ing:'pgy',g:20},{ing:'pgyo',g:20}];
const T = (...v) => v.map(i=>({ing:i,g:10}));
/* 달이 넘어가도 같은 그림이 되도록 날짜를 못 박는다 */
const M = '2027-03-';
const d = n => M + (n<10?'0':'') + n;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/favicon|net::ERR/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  const s0 = await st();
  for (const k of Object.keys(s0.weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  for (const [id,ko,vi,base] of [['pgy','쌀죽','cháo gạo',1],['pgyo','오트밀','yến mạch',1],
      ['beef','소고기','thịt bò',0],['bokchoy','청경채','cải thìa',0],['carrot','당근','cà rốt',0],
      ['apple','사과','táo',0],['egg','달걀','trứng',0]])
    await mut('setWeanIng',{ actor:'엄마', id, ko, vi, cubeG:base?20:10, isBase:!!base });

  /* 1~2 한 메뉴, 3~5 다른 메뉴(사흘), 4일에 간식, 6~7 점심이 붙는다 */
  for (const n of [1,2]) await mut('setWeanDay',{ date:d(n), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('bokchoy','beef') }] });
  for (const n of [3,4,5]) await mut('setWeanDay',{ date:d(n), actor:'엄마',
    meals: n===4
      ? [{ name:'아침', base:B, tops:T('carrot','beef') }, { name:'간식', base:[], tops:[{ing:'apple',g:20}] }]
      : [{ name:'아침', base:B, tops:T('carrot','beef') }] });
  for (const n of [6,7]) await mut('setWeanDay',{ date:d(n), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('carrot','beef') },
           { name:'점심', base:B, tops:T('egg','bokchoy') }] });

  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(800);

  /* ── 달력과 표는 한 화면 ─────────────────────────────
     "하나로 합치자 / 달력이 디폴트로 나오고 날짜 선택하면 달력 한줄로 접고
     그 아래에 선택한 날짜부터 아래로 쭉 표 뿌려주는거야" (2026-11-16) */
  check('달력/표 전환 단추는 없다',
    await p.evaluate(()=>document.querySelectorAll('[data-wn-layout]').length), 0);
  check('고르기 전에는 달력뿐이다', await p.evaluate(()=>[
    !!document.querySelector('#wn-body .wcal [data-wn-pick]'),
    !!document.querySelector('.wt')]), [true, false]);

  await p.click('[data-wn-pick="'+d(3)+'"]'); await p.waitForTimeout(900);
  check('고른 날이 있으면 달력은 그 주 한 줄로 접힌다', await p.evaluate(()=>
    !!document.querySelector('#wn-body .wcal.is-mini')), true);
  check('...년월은 남아서 달을 넘길 수 있다', await p.evaluate(()=>
    !!document.querySelector('#wn-body .wcal [data-wn-mopick]')), true);
  check('...하루 상세 패널은 더 이상 없다 (먹은 양은 기록 화면에서)',
    await p.evaluate(()=>!!document.querySelector('.wd-panel')), false);
  check('표는 달 전체를 그린다 (고른 날이 3일이어도)', await p.evaluate(()=>
    [...document.querySelectorAll('.wt .wt-date b')].map(e=>Number(e.textContent))),
    [1,2,3,4,5,6,7]);

  /* ── 열은 그 달에 쓰는 끼니만 ─────────────────────────── */
  check('끼니 두 가지면 열도 둘', await p.evaluate(()=>
    [...document.querySelectorAll('.wt-hd .wt-kind')].map(e=>e.textContent.trim())),
    ['아침','점심']);

  /* ── 같은 식단은 칸 하나로 묶인다 ─────────────────────── */
  const spans = await p.evaluate(()=>[...document.querySelectorAll('.wt .wt-card')]
    .map(btn=>({ from: btn.dataset.wnCell, meal: btn.dataset.wnCellmeal,
                 rows: Number(btn.dataset.wnSpan||1) })));
  check('1~2일이 한 칸으로 묶인다',
    spans.filter(s=>s.meal==='아침' && s.from.endsWith('-01')).map(s=>s.rows), [2]);
  /* 3~7일 아침은 같은 메뉴라 원래 한 칸(5일)이어야 하지만, 4일에 간식이
     끼므로 거기서 끊어 3~4 / 5~7 이 된다. 간식 줄이 병합 칸 **가운데** 끼면
     줄 번호가 어긋나 아래가 한 칸씩 밀리기 때문이다. */
  check('간식이 있는 날에서 덩어리가 끊긴다',
    spans.filter(s=>s.meal==='아침').map(s=>[s.from.slice(-2), s.rows]),
    [['01',2],['03',2],['05',3]]);
  check('간식은 열이 아니라 가로 한 줄이다', await p.evaluate(()=>{
    const b = document.querySelector('.wt-snack');
    return b ? getComputedStyle(b).gridColumnEnd : null; }), '-1');

  /* ── 안 잘린다 ───────────────────────────────────────── */
  check('재료 이름이 가로로 넘치지 않는다', await p.evaluate(()=>
    [...document.querySelectorAll('.wt-ing b')].filter(e=>e.scrollWidth>e.clientWidth+1).length), 0);
  check('표 전체가 화면 밖으로 넘치지 않는다', await p.evaluate(()=>{
    const t=document.querySelector('.wt'); return t.scrollWidth <= document.documentElement.clientWidth+1; }), true);

  /* ── 누르면 ─────────────────────────────────────────── */
  await p.click('.wt .wt-card'); await p.waitForTimeout(800);
  check('칸을 누르면 그 덩어리 고치기가 열린다', await p.evaluate(()=>{
    const f=document.getElementById('fp-weanday'); return !!(f && !f.hidden && f.classList.contains('show')); }), true);
  await p.click('#fp-weanday-back'); await p.waitForTimeout(600);
  check('...돌아오면 표가 그대로다', await p.evaluate(()=>!!document.querySelector('.wt')), true);
  /* 표의 날짜를 누르면 그 날이 고른 날이 된다 — 펼칠 것은 없다.
     접힌 달력이 그 주로 옮겨가고, + 로 새 식단을 넣을 기준도 그 날이 된다. */
  await p.click('.wt .wt-date[data-wn-trow="'+d(6)+'"]'); await p.waitForTimeout(900);
  check('표의 날짜를 누르면 그 날이 고른 날이 된다', await p.evaluate(()=>[
    !!document.querySelector('.wt'),
    !!document.querySelector('.wd-panel'),
    !!document.querySelector('#wn-body .wcal.is-mini')]), [true, false, true]);
  check('...접힌 달력이 그 주로 옮겨간다', await p.evaluate(()=>
    !!document.querySelector('#wn-body .wc-ring')), true);

  /* ── 한 끼뿐인 달은 한 열 ────────────────────────────── */
  for (const n of [6,7]) await mut('setWeanDay',{ date:d(n), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('carrot','beef') }] });
  await p.goto(BASE + '/'); await p.waitForTimeout(2000);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(800);
  await p.click('[data-wn-pick="'+d(3)+'"]'); await p.waitForTimeout(900);
  check('한 끼뿐이면 열도 하나', await p.evaluate(()=>
    document.querySelectorAll('.wt-hd .wt-kind').length), 1);
  check('...그만큼 재료 격자가 넓어진다', await p.evaluate(()=>
    !!document.querySelector('.wt-grid.c3')), true);

  /* ── 묶인 칸은 날짜마다 같은 높이를 나눠 갖는다 ───────
     "식단이 3줄로 넘어갈 때 첫번째 날짜보다 두번째 날짜가 세로 간격이
     두배더라고 / 식단높이를 각 날짜가 동일하게 나눠가졌으면 해"
     (2026-11-13). <table> 의 rowspan 은 남는 높이를 걸친 줄들에 제멋대로
     나눠 줘서 첫 날짜와 둘째 날짜의 간격이 배로 벌어졌다. 지금은 5~7일이
     한 칸이고 옆에 걸리는 다른 끼니가 없으므로 셋이 똑같이 나눠 갖는다. */
  check('묶인 칸 안에서 날짜 간격이 고르다', await p.evaluate(()=>{
    const y = [...document.querySelectorAll('.wt .wt-date')]
      .map(e=>e.getBoundingClientRect().top);
    const gaps = y.slice(1).map((v,i)=>Math.round(v-y[i]));
    return gaps[4] === gaps[5]; }), true);
  check('...묶인 칸이 걸친 날짜 수만큼 길다', await p.evaluate(()=>{
    const card = [...document.querySelectorAll('.wt .wt-card')]
      .find(b=>b.dataset.wnSpan === '3');
    const d = [...document.querySelectorAll('.wt .wt-date')];
    const h = Math.round(card.getBoundingClientRect().height);
    const one = Math.round(d[5].getBoundingClientRect().top - d[4].getBoundingClientRect().top);
    /* 칸 높이 = 하루 높이 × 3 − 아래 여백 4px */
    return h === one * 3 - 4; }), true);

  /* ── 베트남어 ───────────────────────────────────────── */
  const pv = await b.newPage({ viewport:{ width:390, height:900 } });
  await pv.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','vi'); });
  await pv.goto(BASE + '/'); await pv.waitForTimeout(2200);
  await pv.click('#btn-settings'); await pv.waitForTimeout(500);
  await pv.click('#set-wean'); await pv.waitForTimeout(800);
  await pv.click('[data-wn-pick="'+d(3)+'"]'); await pv.waitForTimeout(700);
  check('...재료 이름도 베트남어', await pv.evaluate(()=>
    /cà rốt/.test(document.querySelector('.wt').textContent)), true);
  await pv.close();

  /* ── 고른 날로 데려다 준다 ───────────────────────────
     표는 **달을 통째로** 그리고 스크롤 자리만 고른 날로 간다 — 앞 날짜를
     자르면 "위로 올리면 지난 날짜"가 깨진다(2026-11-16). */
  for (const n of [1,2,3,4,5,6,7]) await mut('deleteWeanDay',{ date:d(n), actor:'엄마' });
  const todayStr = new Date().toISOString().slice(0,10);
  const ymNow = todayStr.slice(0,7);
  const dd = n => ymNow + '-' + (n<10?'0':'') + n;
  for (let n = 1; n <= 28; n++) await mut('setWeanDay',{ date:dd(n), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T(n % 4 < 2 ? 'carrot' : 'bokchoy', 'beef') }] });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(900);
  await p.click('[data-wn-pick="'+dd(20)+'"]'); await p.waitForTimeout(1800);
  const jump = await p.evaluate((ds)=>{
    const row = document.querySelector('.wt .wt-date[data-wn-trow="'+ds+'"]');
    const first = document.querySelector('.wt .wt-date b');
    return { y: Math.round(window.scrollY), has: !!row,
      top: row ? Math.round(row.getBoundingClientRect().top) : null,
      firstDay: first ? Number(first.textContent) : null,
      vh: window.innerHeight };
  }, dd(20));
  check('고른 날 줄이 표에 있다', jump.has, true);
  check('...표는 1일부터 그대로 그린다 (앞을 자르지 않는다)', jump.firstDay, 1);
  check('...고른 날로 스크롤한다 ' + JSON.stringify(jump), jump.y > 0, true);
  check('...고른 날 줄이 화면 위쪽에 선다', jump.top >= 0 && jump.top < jump.vh / 2, true);

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
