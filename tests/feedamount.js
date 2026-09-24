/* 수유 계획 — 용량에 따라.

   직전 수유의 양이 다음 차례를 정한다. 200 ml를 4시간으로 잡으면 150 ml는
   3시간 뒤다. 밤(안 먹이는 시간)에 걸리는 차례는 그 시간이 끝난 뒤로 미루고,
   그 동안엔 배너를 아예 띄우지 않는다.

   시계를 못 돌리니 '안 먹이는 시간'을 지금 시각 기준으로 옮겨가며 본다 —
   창을 다음 차례 위에 덮으면 밀리는지, 지금 위에 덮으면 숨는지. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return { status:r.status, body: await r.json().catch(()=>({})) };}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.entries=d.entries||[]; return d; };
const p2 = n => String(n).padStart(2,'0');
const hm = d => p2(d.getHours()) + ':' + p2(d.getMinutes());
/* 화면의 시각 표기(한국어)와 같은 모양으로 — "오후 01:55" */
const koTime = d => { let h = d.getHours(); const m = p2(d.getMinutes());
  const ap = h < 12 ? '오전' : '오후'; let hh = h % 12; if (hh === 0) hh = 12;
  return ap + ' ' + p2(hh) + ':' + m; };
/* 한 경우 안에서는 같은 기준 시각을 쓴다 — 먹인 시각과 기대 시각을 따로
   Date.now()로 만들면 그 사이에 분이 넘어가서 1분 차이로 흔들린다. */
let BASE_MS = Date.now();
/* 초는 0으로 맞춰둔다 — 앱은 수유 시각을 분 단위로 반올림하므로, 초가
   30을 넘은 순간에 만든 기록은 1분 뒤로 계산돼 검사가 흔들린다. */
const mark = () => { const d = new Date(); d.setSeconds(0, 0); BASE_MS = d.getTime(); };
const ago = min => new Date(BASE_MS - min*60000);
/* 어긋나면 화면에 뭐라고 적혀 있었는지까지 보여준다 */
const hasTime = (r, d) => r.text.indexOf(koTime(d)) >= 0 ? true : (r.text + '  ≠  ' + koTime(d));
const ahead = min => new Date(BASE_MS + min*60000);

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const clearFeeds = async () => {
    for (const e of (await st()).entries.filter(e=>e.type==='feed'))
      await mut('deleteEntry', { id:e.id, actor:'엄마' });
  };
  const plan = (extra) => mut('setFeedPlan', Object.assign({
    actor:'엄마', mode:'amount', rateMl:200, rateMin:240,
    startTime:'07:00', goal:900, maxGapMin:300,
    nightFrom:'23:00', nightTo:'06:00' }, extra||{}));
  const feed = (d, ml) => mut('addEntry', { type:'feed',
    start:d.toISOString(), end:d.toISOString(), amount:ml, author:'엄마' });

  const banner = async () => {
    const p = await b.newPage({ viewport:{width:390,height:880} });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
    await p.goto(BASE+'/'); await p.waitForTimeout(1700);
    const out = await p.evaluate(()=>{
      const box = document.getElementById('next-feed-row');
      return { hidden: !!box.hidden,
        label: document.getElementById('nf-label').textContent,
        text: document.getElementById('nf-text').textContent,
        sub: document.getElementById('nf-sub').textContent };
    });
    await p.close();
    return out;
  };

  // ═══ 기준대로 먹인 날 ═══
  mark();
  await plan(); await clearFeeds();
  await feed(ago(60), 200);                       /* 1시간 전 200 ml → 4시간 뒤 */
  let r = await banner();
  check('200 ml면 기준 시간 뒤가 다음 차례',
    hasTime(r, ahead(180)), true);
  check('...무엇 때문에 그 시각인지 말해준다', /200ml 먹었으니 4시간 뒤/.test(r.text), true);
  check('...오늘 먹은 양은 목표와 나란히', /200 \/ 900/.test(r.sub.replace(/ml/g,'')), true);

  // ═══ 덜 먹은 날은 더 일찍 ═══
  mark();
  await clearFeeds();
  await feed(ago(60), 150);                       /* 150 ml → 3시간 뒤 */
  r = await banner();
  check('150 ml면 3시간 뒤', hasTime(r, ahead(120)), true);
  check('...이유도 150 기준으로 바뀐다', /150ml 먹었으니 3시간 뒤/.test(r.text), true);

  // ═══ 양을 안 적은 수유 ═══
  mark();
  await clearFeeds();
  await feed(ago(60), '');
  r = await banner();
  check('양을 안 적었으면 기준 시간만큼 (0으로 치지 않는다)', hasTime(r, ahead(180)), true);

  // ═══ 최대 간격이 천장 ═══
  mark();
  await plan({ maxGapMin: 240 });
  await clearFeeds();
  await feed(ago(30), 400);                       /* 계산상 8시간, 천장 4시간 */
  r = await banner();
  check('많이 먹어도 최대 간격을 넘기지 않는다', hasTime(r, ahead(210)), true);

  // ═══ 안 먹이는 시간에 걸리면 끝으로 미룬다 ═══
  /* 1시간 전 200 ml → 3시간 뒤가 차례. 그 위를 창으로 덮는다. */
  mark();
  await plan({ maxGapMin: 600, nightFrom: hm(ahead(120)), nightTo: hm(ahead(300)) });
  await clearFeeds();
  await feed(ago(60), 200);
  r = await banner();
  check('안 먹이는 시간에 걸리면 창이 끝나는 시각으로 미룬다', hasTime(r, ahead(300)), true);
  check('...앞으로 당기지 않는다', r.text.indexOf(koTime(ahead(120))) >= 0, false);
  check('...밤이라 밀렸다고 말해준다 (계산이 틀린 걸로 읽히면 안 된다)',
    /밤엔 안 먹여요/.test(r.text), true);

  // ═══ 그 시간 동안엔 아무것도 안 띄운다 ═══
  mark();
  await plan({ nightFrom: hm(ago(30)), nightTo: hm(ahead(120)) });
  await clearFeeds();
  await feed(ago(60), 200);
  r = await banner();
  check('안 먹이는 시간 동안엔 배너가 숨는다', r.hidden, true);

  // ═══ 방식을 바꿔도 다른 방식의 값은 남아 있다 ═══
  await plan();
  await mut('setFeedPlan', { actor:'엄마', times:['06:30','10:30','14:30','18:30'] });
  await mut('setFeedPlan', { actor:'엄마', mode:'fixed' });
  check('용량 방식을 거쳐도 정해진 시각이 살아 있다',
    (await st()).feedPlan.times, ['06:30','10:30','14:30','18:30']);
  await mut('setFeedPlan', { actor:'엄마', mode:'amount' });
  check('...돌아오면 비율도 그대로',
    [(await st()).feedPlan.rateMl, (await st()).feedPlan.rateMin], [200, 240]);

  // ═══ 내니는 못 바꾼다 ═══
  const bad = await mut('setFeedPlan', { actor:'내니', rateMl: 50 });
  check('내니는 수유 계획을 못 바꾼다', bad.status, 403);
  check('...값도 그대로', (await st()).feedPlan.rateMl, 200);

  // ═══ 설정 목차 요약 ═══
  await clearFeeds();
  const p = await b.newPage({ viewport:{width:390,height:880} });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await p.goto(BASE+'/'); await p.waitForTimeout(1700);
  await p.click('#btn-settings'); await p.waitForTimeout(800);
  check('설정 목차가 용량 방식을 요약한다',
    await p.evaluate(()=>{ const row=document.querySelector('[data-set-go="feed"]');
      return /용량/.test(row.textContent) && /200/.test(row.textContent); }), true);
  await p.click('[data-set-go="feed"]'); await p.waitForTimeout(800);
  check('...하위 화면에 비율 칸이 있다',
    await p.evaluate(()=>!!document.querySelector('[data-feed-set="rateMl"]')), true);
  check('...안 먹이는 시간 칸도 두 개', await p.evaluate(()=>
    !!document.querySelector('[data-feed-set="nightFrom"]') &&
    !!document.querySelector('[data-feed-set="nightTo"]')), true);
  check('...이 방식에선 1회 수유량을 감춘다',
    await p.evaluate(()=>!document.querySelector('[data-feed-set="perFeed"]')), true);
  /* 시각 칸 두 개가 화면 밖으로 밀리지 않는지 — 128px 고정폭 두 개면 넘친다 */
  check('...시각 칸이 화면 안에 들어온다', await p.evaluate(()=>{
    const el = document.querySelector('[data-feed-set="nightTo"]');
    return el.getBoundingClientRect().right <= window.innerWidth; }), true);
  /* 방식 칩 세 개가 각각 한 줄이어야 한다 */
  check('...방식 칩 글자가 두 줄로 접히지 않는다', await p.evaluate(()=>
    [...document.querySelectorAll('[data-feed-mode]')].every(b => {
      const r = document.createRange(); r.selectNodeContents(b);
      return r.getClientRects().length <= 1;   /* 접히면 사각형이 둘이 된다 */
    })), true);
  await p.close();

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
