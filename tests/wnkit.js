/* 알러지 테스트 키트 한 봉 — 큐브도 장 볼 것도 아니다 (2026-11-19).
   "한국에서 알러지 테스트 키트 사온거야 / 식단에 반영 되어 있나?"
   키트 재료(kit:true)는 식단·기록·먹어본 재료에는 들어가고,
   재고 '만들 것/쓸 것'과 장보기에서는 빠져야 한다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0, 160));
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };
const p2 = (x) => (x < 10 ? '0' : '') + x;
const now = new Date(), today = now.getFullYear() + '-' + p2(now.getMonth()+1) + '-' + p2(now.getDate());

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  const s0 = await st();
  for (const k of Object.keys(s0.weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  await mut('setWeanRaw', { actor:'엄마', id:'r_wheat', ko:'밀가루', vi:'bột mì', cat:'grain', allergen:true });
  await mut('setWeanRaw', { actor:'엄마', id:'beef', ko:'소고기', vi:'thịt bò', cat:'protein' });
  await mut('setWeanIng', { actor:'엄마', id:'pgbeef', ko:'소고기 베이스죽', vi:'cháo bò', cubeG:50, isBase:true });
  await mut('setWeanIng', { actor:'엄마', id:'zucchini', ko:'애호박', vi:'bí ngòi', cubeG:10 });
  await mut('setWeanIng', { actor:'엄마', id:'k_wheat', ko:'밀 (키트)', vi:'bột mì (gói thử)', cubeG:12,
    raw:['r_wheat'], kit:true });
  check('서버가 kit 를 받아 둔다', ((await st()).weanIngs || []).filter(g => g.id === 'k_wheat').map(g => g.kit), [true]);
  /* 다른 칸을 고쳐도 kit 는 안 날아간다 */
  await mut('setWeanIng', { actor:'엄마', id:'k_wheat', vi:'bột mì (gói thử)' });
  check('...다른 칸을 고쳐도 남는다', ((await st()).weanIngs || []).filter(g => g.id === 'k_wheat').map(g => g.kit), [true]);
  await mut('setWeanDay', { actor:'엄마', date:today, meals:[{ name:'아침',
    base:[{ ing:'pgbeef', g:50 }], tops:[{ ing:'zucchini', g:10 }, { ing:'k_wheat', g:12 }] }] });

  await p.goto(BASE + '/'); await p.waitForTimeout(2400);
  check('첫 화면 띠에 키트가 이름으로 선다', await p.evaluate(() =>
    /밀 \(키트\)/.test((document.getElementById('wn-band') || document.body).textContent)), true);
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(800);
  check('식단표에 키트 그림(밀가루)이 붙는다', await p.evaluate(() =>
    !!document.querySelector('#wn-body img[src$="wheat-flour.svg"]')), true);

  await p.click('#wn-tabs [data-wn="cubes"]'); await p.waitForTimeout(600);
  const lines = async () => p.evaluate(() => [...document.querySelectorAll('.wn-line .t-label')].map(e => e.textContent.trim()));
  await p.click('[data-wn-cv="use"]'); await p.waitForTimeout(500);
  const use = await lines();
  check('\'쓸 것\'에 애호박은 있고', use.some(x => /애호박/.test(x)), true);
  check('...키트는 없다', use.some(x => /키트|밀/.test(x)), false);
  await p.click('[data-wn-cv="make"]'); await p.waitForTimeout(500);
  check('\'만들 것\'에도 키트가 없다', (await lines()).some(x => /키트|밀/.test(x)), false);

  await p.click('#wn-tabs [data-wn="shop"]'); await p.waitForTimeout(600);
  const shop = await p.evaluate(() => [...document.querySelectorAll('#wn-body .wn-buy:not(.quiet)')].map(e => e.textContent));
  check('장보기에 애호박은 있고', shop.some(x => /애호박/.test(x)), true);
  /* (밀가루는 '집에 있는 것' 곡물 줄(.quiet)에 원래 있다 — 그건 장 볼 양이 아니다) */
  check('...밀가루(키트)는 없다', shop.some(x => /밀/.test(x)), false);

  /* 먹이면 '먹어본 재료'에 밀가루가 켜진다 */
  await p.click('#wn-tabs [data-wn="ings"]'); await p.waitForTimeout(600);
  const wheatCls = () => p.evaluate(() => document.querySelector('.gcell[data-wn-ing="r_wheat"]').className);
  check('먹이기 전: 밀가루 칸은 비어 있다', /\beat\b/.test(await wheatCls()), false);
  await mut('addEntry', { actor:'엄마', author:'엄마', type:'wean', start:new Date().toISOString(),
    ings:[{ ing:'pgbeef', g:50 }, { ing:'zucchini', g:10 }, { ing:'k_wheat', g:12 }] });
  await p.reload(); await p.waitForTimeout(2400);
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(800);
  await p.click('#wn-tabs [data-wn="ings"]'); await p.waitForTimeout(600);
  check('먹인 뒤: 밀가루가 먹어본 재료로 켜진다', /\beat\b/.test(await wheatCls()), true);
  check('키트는 냉동실에 없으니 재고도 안 건드린다',
    ((await st()).weanCubes || []).filter(c => c.ing === 'k_wheat').length, 0);

  /* kit:false 로 풀 수 있다 */
  await mut('setWeanIng', { actor:'엄마', id:'k_wheat', kit:false });
  check('kit:false 면 표시가 빠진다', ((await st()).weanIngs || []).filter(g => g.id === 'k_wheat').map(g => g.kit), [undefined]);
  check('오류 없음', errs, []);
  const f = R.filter(r => !r.ok).length;
  console.log('\n' + (R.length - f) + '/' + R.length + ' passed');
  await b.close();
})();
