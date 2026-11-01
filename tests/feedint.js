/* 수유 계획 — 간격.

   "이제 이유식을 먹기 때문에 단순히 분유 용량 만으로 다음 수유시간을
   계산하면 안돼. 그래서 설정 - 수유 계획에서 '간격', 4시간으로 설정했는데도
   다음 수유 시간이 여전히 용량에 따라 나오더라." (2026-11-01)

   그래서 못 박는 것:
     - 다음 차례는 **마지막 수유 + 간격**이다. 먹인 양은 보지 않는다.
     - 같은 시각에 100 ml를 먹였든 300 ml를 먹였든 다음 차례는 같다.
     - 격자가 아니다: 배고파서 두 시간 만에 먹인 날에도 그 수유에서 센다
       (예전엔 그날 첫 수유에 4시간 격자를 깔아서, 남은 하루 내내 실제
       수유와 어긋난 시각을 가리켰다).
     - 정한 간격이 '최대 간격'보다 길어도 깎지 않는다.
     - 아직 안 먹인 날은 기준 시각부터.
     - 용량 방식은 그대로 양을 본다(이 변경으로 망가지지 않았는지). */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160));
  return r.json().catch(()=>({}));}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.entries=d.entries||[]; return d; };
const p2 = n => String(n).padStart(2,'0');
const hm = d => p2(d.getHours()) + ':' + p2(d.getMinutes());
const koTime = d => { let h = d.getHours(); const m = p2(d.getMinutes());
  const ap = h < 12 ? '오전' : '오후'; let hh = h % 12; if (hh === 0) hh = 12;
  return ap + ' ' + p2(hh) + ':' + m; };
let BASE_MS = Date.now();
const mark = () => { const d = new Date(); d.setSeconds(0, 0); BASE_MS = d.getTime(); };
const ago = min => new Date(BASE_MS - min*60000);
const ahead = min => new Date(BASE_MS + min*60000);
const hasTime = (r, d) => r.text.indexOf(koTime(d)) >= 0 ? true : (r.text + '  ≠  ' + koTime(d));

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const clearFeeds = async () => {
    for (const e of (await st()).entries.filter(e=>e.type==='feed'||e.type==='wean'))
      await mut('deleteEntry', { id:e.id, actor:'엄마' });
  };
  /* 간격 4시간 · 하루 4회 — 라이브와 같은 값.
     '안 먹이는 시간'은 간격 방식에서 쓰지 않지만, 값이 남아 있어도 시각을
     밀지 않아야 한다 — 지금 바로 위에 덮어 두고 확인한다. */
  const plan = (extra) => mut('setFeedPlan', Object.assign({
    actor:'엄마', mode:'interval', intervalMin:240, count:4, startTime:'07:00',
    perFeed:200, goal:850, maxGapMin:240, quietFrom:'23:59',
    nightFrom: hm(ago(30)), nightTo: hm(ahead(600)) }, extra||{}));
  const feed = (d, ml) => mut('addEntry', { type:'feed',
    start:d.toISOString(), end:d.toISOString(), amount:ml, author:'엄마' });
  const wean = (d, g) => mut('addEntry', { type:'wean',
    start:d.toISOString(), end:d.toISOString(), amount:g, author:'엄마' });

  const cell = async () => {
    const p = await b.newPage({ viewport:{width:390,height:880} });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
    await p.goto(BASE+'/'); await p.waitForTimeout(1700);
    const out = await p.evaluate(()=>{
      const c = document.querySelector('#dash4 .d4');
      return { text: c ? (c.querySelector('.d4-sub')||{}).textContent || '' : '',
               big:  c ? (c.querySelector('.d4-big')||{}).textContent || '' : '' };
    });
    await p.close();
    return out;
  };
  const mins = s => { const h=/(\d+)시간/.exec(s), m=/(\d+)분/.exec(s);
    return (h?+h[1]*60:0) + (m?+m[1]:0); };

  // ═══ 마지막 수유 + 간격 ═══
  mark(); await plan(); await clearFeeds();
  await feed(ago(60), 100);                      /* 1시간 전 100 ml → 3시간 뒤 */
  let r = await cell();
  check('마지막 수유 한 시간 뒤면 다음은 세 시간 뒤', hasTime(r, ahead(180)), true);
  const big100 = mins(r.big);
  check('...남은 시간도 같이 적힌다', big100 >= 175 && big100 <= 180, true);

  // ═══ 양이 달라도 같은 시각 ═══
  mark(); await clearFeeds();
  await feed(ago(60), 300);                      /* 많이 먹었어도 */
  r = await cell();
  check('300 ml를 먹여도 같은 시각 (양을 보지 않는다)', hasTime(r, ahead(180)), true);
  mark(); await clearFeeds();
  await feed(ago(60), '');                       /* 양을 안 적었어도 */
  r = await cell();
  check('양을 안 적어도 같은 시각', hasTime(r, ahead(180)), true);

  // ═══ 격자가 아니다 ═══
  mark(); await clearFeeds();
  await feed(ago(300), 200);                     /* 다섯 시간 전 — 그날 첫 수유 */
  await feed(ago(30), 120);                      /* 배고파서 30분 전에 한 번 더 */
  r = await cell();
  check('중간에 더 먹인 날은 그 수유에서 센다 (첫 수유 격자가 아니다)',
    hasTime(r, ahead(210)), true);

  // ═══ 이유식은 수유 차례를 건드리지 않는다 ═══
  mark(); await clearFeeds();
  await feed(ago(60), 120);
  await wean(ago(20), 40);                       /* 20분 전에 이유식 */
  r = await cell();
  check('이유식을 먹여도 다음 분유 차례는 그대로', hasTime(r, ahead(180)), true);

  // ═══ 최대 간격이 간격을 깎지 않는다 ═══
  mark(); await plan({ intervalMin: 300, maxGapMin: 240 });
  await clearFeeds();
  await feed(ago(30), 120);
  r = await cell();
  check('정한 간격이 최대 간격보다 길어도 그대로', hasTime(r, ahead(270)), true);

  // ═══ 아직 안 먹인 날 ═══
  mark(); await plan({ startTime: hm(ahead(90)) });
  await clearFeeds();
  r = await cell();
  check('아직 안 먹였으면 기준 시각', hasTime(r, ahead(90)), true);

  // ═══ 안 먹이는 시간은 간격 방식을 밀지 않는다 ═══
  /* 위 plan() 이 '안 먹이는 시간'을 지금부터 10시간으로 덮어 두었다 —
     용량 방식이라면 창이 끝나는 시각으로 밀렸을 자리다. */
  mark(); await plan({ nightFrom: hm(ago(10)), nightTo: hm(ahead(600)) });
  await clearFeeds();
  await feed(ago(60), 120);
  r = await cell();
  check('간격 방식에선 안 먹이는 시간이 시각을 밀지 않는다',
    hasTime(r, ahead(180)), true);

  // ═══ 용량 방식은 그대로 양을 본다 ═══
  mark(); await mut('setFeedPlan', { actor:'엄마', mode:'amount', rateMl:200, rateMin:240,
    maxGapMin:300, nightFrom: hm(ahead(600)), nightTo: hm(ahead(660)) });
  await clearFeeds();
  await feed(ago(60), 150);                      /* 150 ml → 3시간 → 2시간 뒤 */
  r = await cell();
  check('용량 방식은 여전히 양으로 센다', hasTime(r, ahead(120)), true);

  // ═══ 설명 문구 ═══
  const p = await b.newPage({ viewport:{width:390,height:880} });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await mut('setFeedPlan', { actor:'엄마', mode:'interval' });
  await p.goto(BASE+'/'); await p.waitForTimeout(1700);
  await p.click('#btn-settings'); await p.waitForTimeout(700);
  await p.click('[data-set-go="feed"]'); await p.waitForTimeout(700);
  check('간격 설명이 "마지막 수유"에서 센다고 말한다', await p.evaluate(()=>
    /마지막 수유/.test(document.getElementById('feed-settings-hint').textContent)), true);
  check('...간격·횟수 칸이 있다', await p.evaluate(()=>
    !!document.querySelector('[data-feed-hours="intervalMin"]') &&
    !!document.querySelector('[data-feed-set="count"]')), true);
  await p.close();

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
