/* 토핑 이유식 / 죽 이유식.

   "토핑 이유식은 큐브 쓸건데 죽 이유식은 큐브 안쓸거야 / 그냥 죽 째로
   만들어서 냉동할거임 / 큐브 재고랑 연결 끊었으면 좋겠는데" (2026-11-16)

   저장은 죽일 때만 form:'mix'. 없으면 토핑이다 — 쌓인 90일치가 그대로
   제 뜻으로 읽힌다. 죽은 재료별 칸이 아니라 '그 통에서 한 끼'가 빠진다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160));
  return r.ok ? (await r.json()) : null; }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json(); return j.data||j; };
const B = [{ing:'pgy',g:20},{ing:'pgyo',g:20}];
const T = (...v) => v.map(i=>({ing:i,g:10}));
/* 재고의 '만들 것 / 쓸 것'은 **이번 주**를 본다 — 날짜를 달 초로 못 박으면
   돌리는 날에 따라 그 주에 안 들어와서 줄이 하나도 안 선다. 월요일부터 센다. */
const mon = (() => { const t = new Date(); t.setUTCHours(0,0,0,0);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t; })();
const d = n => { const x = new Date(mon); x.setUTCDate(x.getUTCDate() + (n-1));
  return x.toISOString().slice(0,10); };
/* 앱의 weanHash 와 같은 FNV-1a — 죽 키를 브라우저 밖에서도 셀 수 있어야 한다 */
const hash = (str) => { let h = 2166136261;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'm' + (h >>> 0).toString(36); };
const mixKeyOf = (...ids) => 'mix_' + hash(ids.slice().sort().join(','));

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/favicon|net::ERR/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  const s0 = await st();
  for (const k of Object.keys(s0.weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  for (const c of (s0.weanCubes||[])) await mut('setWeanCube',{ actor:'엄마', ing:c.ing, n:0 });
  for (const [id,ko,vi,base] of [['pgy','쌀죽','cháo gạo',1],['pgyo','오트밀','yến mạch',1],
      ['beef','소고기','thịt bò',0],['radish','무','củ cải trắng',0],['napa','배추','cải thảo',0],
      ['zucchini','애호박','bí ngòi',0]])
    await mut('setWeanIng',{ actor:'엄마', id, ko, vi, cubeG:base?20:10, isBase:!!base });

  /* 1일 토핑, 2일 죽(소고기·무·배추), 3일 토핑 */
  await mut('setWeanDay',{ date:d(1), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('zucchini','beef') }] });
  await mut('setWeanDay',{ date:d(2), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('radish','napa','beef'), form:'mix' }] });
  await mut('setWeanDay',{ date:d(3), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('zucchini','beef') }] });

  /* ── 저장되는 모양 ───────────────────────────────────── */
  const s1 = await st();
  check('죽일 때만 form 을 적는다 — 토핑은 칸이 아예 없다',
    [s1.weanPlan[d(1)].meals[0].form, s1.weanPlan[d(2)].meals[0].form],
    [undefined, 'mix']);
  await mut('setWeanDay',{ date:d(4), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('beef'), form:'소고기' }] });
  check('모르는 form 값은 버리고 토핑으로 읽는다',
    (await st()).weanPlan[d(4)].meals[0].form, undefined);
  await mut('deleteWeanDay',{ date:d(4), actor:'엄마' });

  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(800);
  await p.click('[data-wn-pick="'+d(1)+'"]'); await p.waitForTimeout(900);

  /* ── 식단표 라벨 ─────────────────────────────────────── */
  check('칸마다 토핑/죽 라벨이 붙는다', await p.evaluate(()=>
    [...document.querySelectorAll('.wt .wt-card .wn-form')].map(e=>e.textContent.trim())),
    ['토핑','죽','토핑']);
  check('죽만 꽉 채운다 (토핑은 테두리만)', await p.evaluate(()=>
    [...document.querySelectorAll('.wt .wt-card .wn-form')].map(e=>e.classList.contains('is-mix'))),
    [false,true,false]);
  check('라벨이 \'N일\' 자리를 뺏지 않는다', await p.evaluate(()=>{
    const t = document.querySelector('.wt .wt-card .wt-top');
    return !!t.querySelector('.wt-sp'); }), true);

  /* ── 재고: 죽은 큐브 칸에서 빠지고 끼로 선다 ─────────── */
  await p.click('#wn-tabs [data-wn="cubes"]');
  await p.waitForTimeout(600);
  const cv = await p.evaluate(()=>!!document.querySelector('[data-wn-cv]'));
  if (!cv) { console.log('!! 재고 탭을 못 열었다'); }
  await p.click('[data-wn-cv="use"]'); await p.waitForTimeout(600);
  const use = await p.evaluate(()=>[...document.querySelectorAll('.wn-line')].map(e=>({
    nm: e.querySelector('.t-label').textContent.trim(),
    n: e.querySelector('.t-value').textContent.trim() })));
  check('죽 재료는 큐브 칸으로 안 센다 (무·배추가 칸 줄에 없다)',
    use.filter(x=>/무|배추/.test(x.nm) && /칸/.test(x.n)).length, 0);
  check('죽은 \'끼\'로 한 줄 선다',
    use.filter(x=>/끼$/.test(x.n)).map(x=>x.n), ['1끼']);
  check('소고기는 토핑 날 것만 센다 (죽 날은 빠진다)',
    (use.filter(x=>/^소고기/.test(x.nm))[0]||{}).n, '큐브 2칸');

  /* ── 자동 차감: 죽은 그 통에서 한 끼 ─────────────────── */
  /* 이름은 식단에 붙는다 — 통을 다 먹고 다시 끓여도 따라온다 (2026-11-16) */
  await mut('setWeanDay',{ date:d(2), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('radish','napa','beef'),
             form:'mix', mixLabel:'소고기 알배추죽' }] });
  check('식단이 죽 이름을 들고 있다',
    (await st()).weanPlan[d(2)].meals[0].mixLabel, '소고기 알배추죽');
  await p.reload(); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  await p.click('#wn-tabs [data-wn="cubes"]'); await p.waitForTimeout(600);
  await p.click('[data-wn-cv="make"]'); await p.waitForTimeout(600);
  check('...\'만들 것\' 줄에 그 이름이 선다 (자동 이름 대신)', await p.evaluate(()=>{
    const e = [...document.querySelectorAll('.wn-line')]
      .find(x=>x.querySelector('.wn-form'));
    return e ? e.querySelector('.t-label').textContent.trim() : null; }),
    '죽소고기 알배추죽');
  await mut('setWeanDay',{ date:d(2), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('radish','napa','beef'), form:'mix' }] });

  const mixKey = mixKeyOf('pgy','pgyo','radish','napa','beef');
  check('죽 키는 mix_ 로 시작한다', /^mix_[0-9a-z]{1,12}$/.test(mixKey), true);
  /* '만들 것'에서는 줄이 누를 수 있는 단추다 — 거기 달린 키가 앱이 센 키다 */
  await p.click('[data-wn-cv="make"]'); await p.waitForTimeout(600);
  check('...앱이 세는 키와 같다', await p.evaluate(()=>
    [...document.querySelectorAll('[data-wn-make]')].map(e=>e.dataset.wnMake)
      .filter(x=>x.slice(0,4)==='mix_')), [mixKey]);
  await mut('setWeanMixBatch',{ actor:'엄마', key:mixKey, n:6, perG:70,
    madeOn:d(2), label:'소고기무배추죽', parts:['beef','radish','napa'] });
  await mut('addWeanCubes',{ actor:'엄마', ing:'beef', n:5, perG:10, madeOn:d(1) });
  await mut('addWeanCubes',{ actor:'엄마', ing:'pgy', n:5, perG:20, madeOn:d(1) });

  const r = await mut('addEntry',{ type:'wean', author:'엄마',
    start:new Date(d(2)+'T02:00:00Z').toISOString(), end:new Date(d(2)+'T02:00:00Z').toISOString(),
    amount:70, mealName:'아침', form:'mix', mixKey:mixKey,
    ings:[{ing:'pgy',g:20},{ing:'pgyo',g:20},{ing:'radish',g:10},{ing:'napa',g:10},{ing:'beef',g:10}] });
  const s2 = await st();
  const n = (ing) => (s2.weanCubes||[]).filter(c=>c.ing===ing).reduce((a,c)=>a+(c.n||0),0);
  check('죽을 먹이면 그 통에서 한 끼만 빠진다', n(mixKey), 5);
  check('...소고기 큐브는 그대로다 (이게 11/16에 잡은 버그다)', n('beef'), 5);
  check('...쌀죽 큐브도 그대로다', n('pgy'), 5);

  await mut('deleteEntry',{ id:r.result.entry.id, actor:'엄마' });
  const s3 = await st();
  const n3 = (ing) => (s3.weanCubes||[]).filter(c=>c.ing===ing).reduce((a,c)=>a+(c.n||0),0);
  check('기록을 지우면 한 끼가 돌아온다', n3(mixKey), 6);
  check('...이름표는 그대로 남는다',
    ((s3.weanCubes||[]).filter(c=>c.ing===mixKey)[0]||{}).label, '소고기무배추죽');

  /* 토핑 기록은 예전 그대로 */
  const r2 = await mut('addEntry',{ type:'wean', author:'엄마',
    start:new Date(d(1)+'T02:00:00Z').toISOString(), end:new Date(d(1)+'T02:00:00Z').toISOString(),
    amount:60, mealName:'아침', form:'top', mixKey:'',
    ings:[{ing:'pgy',g:20},{ing:'pgyo',g:20},{ing:'zucchini',g:10},{ing:'beef',g:10}] });
  const s4 = await st();
  check('토핑 기록은 재료마다 한 칸씩 빠진다 (예전 그대로)',
    (s4.weanCubes||[]).filter(c=>c.ing==='beef').reduce((a,c)=>a+(c.n||0),0), 4);
  await mut('deleteEntry',{ id:r2.result.entry.id, actor:'엄마' });

  /* ── 있는 것 화면 ────────────────────────────────────── */
  await p.goto(BASE + '/'); await p.waitForTimeout(2000);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  await p.click('#wn-tabs [data-wn="cubes"]'); await p.waitForTimeout(700);
  check('있는 것에 죽 덩어리가 한 줄 선다', await p.evaluate(()=>{
    const b = document.querySelector('[data-wn-mixname]');
    return b ? b.querySelector('.cb-head b').textContent.trim() : null; }), '소고기무배추죽');
  check('...밑줄에 무엇이 들었는지 적는다', await p.evaluate(()=>{
    const b = document.querySelector('[data-wn-mixname]');
    return b.querySelector('.cb-sub').textContent.trim(); }).then(x=>/70g/.test(x) && /소고기 \+ 무 \+ 배추/.test(x)), true);
  check('...죽 줄에는 재료 그림이 없다 (재료 사전에 없는 것이다)', await p.evaluate(()=>
    !document.querySelector('[data-wn-mixname] .cb-head img')), true);
  check('...누르면 재료 상세가 아니라 덩어리 고치기가 열린다', await p.evaluate(async ()=>{
    document.querySelector('[data-wn-mixname]').click();
    await new Promise(r=>setTimeout(r,500));
    const sh = document.getElementById('wn-cube-sheet');
    return [sh.classList.contains('show'),
      document.getElementById('wn-cube-namefield').hidden,
      document.getElementById('wn-cube-ingfield').hidden,
      document.getElementById('wn-cube-name').value]; }),
    [true, false, true, '소고기무배추죽']);

  /* 이름 고치기 */
  await p.evaluate(()=>{ document.getElementById('wn-cube-name').value = '겨울죽'; });
  await p.click('#wn-cube-save'); await p.waitForTimeout(900);
  check('이름을 고치면 저장된다',
    ((await st()).weanCubes||[]).filter(c=>c.ing===mixKey)[0].label, '겨울죽');

  /* ── 띠 머리줄 ───────────────────────────────────────
     "띠배너에서 죽 라벨은 9일차 옆에 붙는게 나은듯? 토핑, 죽일때 모두
     보여주고." (2026-11-16) — 끼니 줄이 아니라 '며칠차' 옆, 둘 다. */
  const pb = await b.newPage({ viewport:{ width:390, height:900 } });
  await pb.addInitScript(()=>{ localStorage.setItem('bbl_author','내니 Vi');
    localStorage.setItem('bbl_lang','ko'); });
  await pb.goto(BASE + '/'); await pb.waitForTimeout(2400);
  check('띠 머리줄 \'며칠차\' 바로 옆에 붙는다', await pb.evaluate(()=>{
    const line = document.getElementById('wn-dn-line');
    const kids = [...line.children].map(e=>e.id);
    return kids.indexOf('wn-form-tag') === kids.indexOf('wn-stage') + 1; }), true);
  check('...토핑인 날에도 뜬다', await pb.evaluate(()=>{
    const e = document.querySelector('#wn-form-tag .wn-form');
    return e ? [e.textContent.trim(), e.classList.contains('is-mix')] : null; }),
    ['토핑', false]);
  check('...하루가 한 가지면 끼니 줄에는 안 적는다', await pb.evaluate(()=>
    document.querySelectorAll('#wn-meals .wn-form').length), 0);
  /* 오늘(1일)을 아침 토핑 + 점심 죽으로 바꾸면 머리줄이 거짓말이 된다 */
  await mut('setWeanDay',{ date:d(1), actor:'엄마', meals:[
    { name:'아침', base:B, tops:T('zucchini','beef') },
    { name:'점심', base:B, tops:T('radish','napa'), form:'mix' }] });
  await pb.reload(); await pb.waitForTimeout(2400);
  check('끼니마다 방법이 다르면 머리줄은 비우고 줄마다 적는다', await pb.evaluate(()=>[
    document.querySelectorAll('#wn-form-tag .wn-form').length,
    [...document.querySelectorAll('#wn-meals .wn-form')].map(e=>e.textContent.trim())]),
    [0, ['토핑','죽']]);
  await pb.close();
  await mut('setWeanDay',{ date:d(1), actor:'엄마',
    meals:[{ name:'아침', base:B, tops:T('zucchini','beef') }] });

  /* ── 하루 고치기 세그먼트 ────────────────────────────── */
  await p.goto(BASE + '/'); await p.waitForTimeout(2000);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  await p.click('[data-wn-pick="'+d(2)+'"]'); await p.waitForTimeout(900);
  /* 하루 상세 패널이 없어졌으니(2026-11-16) 표의 그 날 칸으로 들어간다 */
  await p.click('.wt .wt-card[data-wn-cell="'+d(2)+'"]'); await p.waitForTimeout(900);
  check('하루 고치기에 토핑/죽 세그먼트가 있다', await p.evaluate(()=>
    [...document.querySelectorAll('[data-wn-form]')].map(e=>
      [e.dataset.wnForm, e.getAttribute('aria-pressed')])), [['top','false'],['mix','true']]);
  await p.click('[data-wn-form="top"]'); await p.waitForTimeout(400);
  check('토핑으로 바꾸면 눌린 자리가 옮겨간다', await p.evaluate(()=>
    document.querySelector('[data-wn-form="top"]').getAttribute('aria-pressed')), 'true');
  check('...설명 줄도 같이 바뀐다', await p.evaluate(()=>
    /얹어요/.test(document.getElementById('fp-weanday-body').textContent)), true);

  /* ── 베트남어 ───────────────────────────────────────── */
  const pv = await b.newPage({ viewport:{ width:390, height:900 } });
  await pv.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','vi'); });
  await pv.goto(BASE + '/'); await pv.waitForTimeout(2200);
  await pv.click('#btn-settings'); await pv.waitForTimeout(500);
  await pv.click('#set-wean'); await pv.waitForTimeout(800);
  await pv.click('[data-wn-pick="'+d(1)+'"]'); await pv.waitForTimeout(900);
  check('베트남어 라벨', await pv.evaluate(()=>
    [...new Set([...document.querySelectorAll('.wt .wt-card .wn-form')].map(e=>e.textContent.trim()))].sort()),
    ['Rắc lên','Trộn đều']);
  await pv.close();

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
