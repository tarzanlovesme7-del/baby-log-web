/* 달력은 새 재료를 먼저 보여준다.

   "달력에서 항상 첫번째가 쌀죽 오트밀이잖아. 그걸 뒤로 보내고 나머지
   재료를 먼저 보여줘" (2026-11-08)
   "소고기도 거의 매일 들어가는 거니까 … 새 재료가 항상 먼저 나오도록"

   죽도 소고기도 거의 매일 같은 자리에 같은 이름으로 선다. 좁은 달력 칸에서
   그게 앞을 차지하면 그날 **다른** 것이 +2 뒤로 밀려 안 보인다. 차례는
   둘로 간다: 토핑이 죽보다 앞, 그 안에서는 식단표에 늦게 들어온 재료가 앞.
   보이는 차례만 바꾸고 저장되는 base/tops 는 건드리지 않는다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,140)); }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };
const p2 = x => (x<10?'0':'')+x;
const ds = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const today = ds(new Date());
const dAgo = n => { const d = new Date(); d.setDate(d.getDate()-n); return ds(d); };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  for (const k of Object.keys((await st()).weanPlan || {})) await mut('deleteWeanDay', { date:k, actor:'엄마' });
  /* 재료 사전 — 이름이 풀려야 알약에 글자가 선다 */
  await mut('setWeanIng', { actor:'엄마', id:'pgy',  ko:'쌀죽',  vi:'cháo gạo',   cubeG:20, isBase:true });
  await mut('setWeanIng', { actor:'엄마', id:'pgyo', ko:'오트밀', vi:'yến mạch',  cubeG:20, isBase:true });
  await mut('setWeanIng', { actor:'엄마', id:'beef', ko:'소고기', vi:'thịt bò',   cubeG:10 });
  await mut('setWeanIng', { actor:'엄마', id:'zucchini', ko:'애호박', vi:'bí ngòi', cubeG:10 });
  /* 소고기는 먼저(닷새 전부터), 애호박은 나중에 들어온 재료로 깐다.
     저장은 base 가 앞이고 토핑 안에서는 소고기가 앞이다 — 화면은 그 반대. */
  await mut('setWeanDay', { date: dAgo(5), actor:'엄마', meals: [{ name:'아침',
    base: [{ ing:'pgy', g:20 }], tops: [{ ing:'beef', g:15 }] }] });
  await mut('setWeanDay', { date: today, actor:'엄마', meals: [{ name:'아침',
    base: [{ ing:'pgy', g:20 }, { ing:'pgyo', g:20 }],
    tops: [{ ing:'beef', g:15 }, { ing:'zucchini', g:15 }] }] });

  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마');
    localStorage.setItem('bbl_lang','ko'); });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(900);

  /* 저장된 차례는 그대로 — base 가 먼저다 */
  const day = (await st()).weanPlan[today];
  check('저장은 그대로 base 가 먼저, 토핑 안에서는 소고기가 먼저다',
    [day.meals[0].base.map(x=>x.ing), day.meals[0].tops.map(x=>x.ing)],
    [['pgy','pgyo'], ['beef','zucchini']]);

  /* 달력 알약: 이름이 붙은 것부터 토핑이어야 한다 */
  /* 오늘 칸의 알약 — 첫 번째 알약은 닷새 전(소고기만 있는 날) 것이다 */
  const pill = await p.evaluate((d)=>{
    const el = document.querySelector('#wn-body .wc-pill[data-wn-pick="' + d + '"]');
    if (!el) return null;
    return {
      names: [...el.querySelectorAll('.wc-i i')].map(x=>x.textContent.trim()),
      icons: [...el.querySelectorAll('img.wi')].map(x=>x.getAttribute('src')),
    };
  }, today);
  check('달력 알약이 그려진다', !!pill, true);
  /* 칸이 좁으면 뒤쪽은 그림만 되거나 +N 으로 접힌다. 그래서 '몇 개가
     보이나'가 아니라 **차례**를 묻는다 — 토핑이 죽보다 앞이어야 한다. */
  const TOPICO = ['icons/beef.svg', 'icons/zucchini.svg'];
  const BASEICO = ['icons/rice.svg', 'icons/oatmeal.svg'];
  const firstBase = pill.icons.findIndex(x => BASEICO.indexOf(x) >= 0);
  const lastTop   = pill.icons.map(x => TOPICO.indexOf(x) >= 0).lastIndexOf(true);
  check('...맨 앞은 새로 들어온 토핑(애호박)이다', pill.icons[0], 'icons/zucchini.svg');
  check('...매일 들어가는 소고기는 그 뒤다',
    pill.icons.indexOf('icons/beef.svg') < 0 ||
    pill.icons.indexOf('icons/beef.svg') > 0, true);
  check('...죽은 토핑 뒤에만 온다', firstBase < 0 || firstBase > lastTop, true);
  check('...이름이 붙는 것도 토핑부터다',
    pill.names.length === 0 || ['소고기','애호박'].indexOf(pill.names[0]) >= 0, true);

  /* 날짜를 눌러 펼친 하루의 끼니 카드도 같은 차례 */
  await p.click('#wn-body [data-wn-pick="' + today + '"]'); await p.waitForTimeout(900);
  const card = await p.evaluate(()=>{
    const el = document.querySelector('#wn-body .wd-t b');
    const th = document.querySelector('#wn-body .wd-thumb');
    return { title: el ? el.textContent.trim() : null,
      icons: th ? [...th.querySelectorAll('img.wi')].map(x=>x.getAttribute('src')) : [] };
  });
  check('하루 카드 제목도 새 재료부터', (card.title || '').split(' ').slice(0, 2),
    ['애호박', '소고기']);
  check('...카드 그림도 새 재료부터', card.icons.slice(0, 2),
    ['icons/zucchini.svg', 'icons/beef.svg']);
  check('...죽이 빠지지는 않는다',
    /쌀죽/.test(card.title) && /오트밀/.test(card.title), true);

  check('페이지 오류 없음', errs, []);
  /* 깔아 둔 식단은 치우고 나간다 — 다른 스위트가 '식단이 없는 날'을 본다 */
  await mut('deleteWeanDay', { date: today, actor: '엄마' });
  await mut('deleteWeanDay', { date: dAgo(5), actor: '엄마' });
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
