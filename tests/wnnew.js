/* '새 재료'는 다른 폰에서 고친 식단도 따라가야 한다.

   "16일 식단 상세 누르니까 새 재료에 브로콜리라고 나오는데? 이거 하드코딩이야?"
   (2026-11-13) — 하드코딩이 아니라 캐시였다. weanIngFirsts()의 열쇠가
   '식단 날 수 : 재료 수 : 내가 고친 횟수'뿐이라, **날 수도 재료 수도 그대로인 채
   내용만 바뀐** 식단이 폴링으로 들어오면 열쇠가 같아서 옛 첫날 표를 그대로 썼다.
   게다가 __weanStamp 는 appState 안에 있어 폴링 때 0으로 돌아가므로, 옛 열쇠가
   되살아나기까지 했다. 열쇠에 서버 판 번호(appVersion)를 넣어 고쳤다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160)); }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json(); return j.data||j; };
const p2 = n => (n<10?'0':'')+n;
const ds = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const add = n => { const d=new Date(); d.setDate(d.getDate()+n); return ds(d); };
const B = [{ing:'pgy',g:20},{ing:'pgyo',g:20}];
const T = (...v) => v.map(i=>({ing:i,g:10}));

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  const s0 = await st();
  for (const k of Object.keys(s0.weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  for (const [id,ko,vi,base] of [['pgy','쌀죽','cháo gạo',1],['pgyo','오트밀','yến mạch',1],
      ['beef','소고기','thịt bò',0],['broccoli','브로콜리','bông cải xanh',0],['carrot','당근','cà rốt',0]])
    await mut('setWeanIng',{ actor:'엄마', id, ko, vi, cubeG:base?20:10, isBase:!!base });

  /* 오늘~+1 은 소고기, +2~+3 에 브로콜리가 처음 들어간다 */
  const D0=add(0), D2=add(2);
  for (let i=0;i<=1;i++) await mut('setWeanDay',{ date:add(i), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('beef') }] });
  for (let i=2;i<=3;i++) await mut('setWeanDay',{ date:add(i), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('broccoli','beef') }] });

  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  /* 이유식 → 식단표 → 그 날 → 끼니 카드. **다시 불러오지 않는다** —
     새로고침하면 캐시가 비어서 버그가 숨는다. */
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(900);
  const openSpan = async (d) => {
    await p.click('[data-wn-pick="'+d+'"]'); await p.waitForTimeout(700);
    await p.click('#wn-body [data-wn-day]'); await p.waitForTimeout(800);
    const txt = await p.evaluate(()=>{ const a=document.querySelector('#fp-weanday-body .wn-alert b');
      return a ? a.textContent.replace(/\s+/g,' ').trim() : null; });
    await p.click('#fp-weanday-back'); await p.waitForTimeout(600);
    return txt;
  };
  check('처음에는 브로콜리가 새 재료', /브로콜리/.test(await openSpan(D2) || ''), true);

  /* ── 다른 폰에서 고친 것처럼: 날 수도 재료 수도 그대로, 내용만 바꾼다 ──
     브로콜리를 당근으로 갈아끼운다. 페이지는 새로고침하지 않는다. */
  for (let i=2;i<=3;i++) await mut('setWeanDay',{ date:add(i), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('carrot','beef') }] });
  const s1 = await st();
  check('날 수와 재료 수는 그대로다 (열쇠가 안 변하는 조건)',
    [Object.keys(s1.weanPlan).length, s1.weanIngs.length], [4, 5]);

  /* 폴링이 새 상태를 들고 올 때까지 — 달력 알약이 먼저 바뀐다 (POLL_MS 25s) */
  await p.waitForFunction(() => /당근/.test(document.getElementById('wn-body').textContent),
    null, { timeout: 45000 });

  const after = await openSpan(D2);
  check('식단이 바뀌면 새 재료도 따라 바뀐다', /당근/.test(after || ''), true);
  check('...옛 재료는 더 이상 새 재료가 아니다', /브로콜리/.test(after || ''), false);

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
