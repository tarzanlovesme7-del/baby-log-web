/* 장보기 줄에서 베트남어 이름을 베낀다.

   "장보기 목록에서 베트남어 재료명 복사하는 아이콘 있었으면 좋겠어.
   한국어 모드일때만 나오게" (2026-11-08)

   그녀는 한국어 화면을 보는데, 시장에서 보여 줘야 하는 이름은 베트남어다.
   베트남어 화면에서는 이름 자체가 이미 베트남어라 단추를 세우지 않는다.
   베트남어 이름이 없는 재료에도 세우지 않는다 — 베낄 것이 없다. */
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

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  /* 베트남어 이름이 있는 재료 하나, 없는 재료 하나 */
  await mut('setWeanIng', { actor:'엄마', id:'beef', ko:'소고기', vi:'thịt bò', cubeG:10 });
  await mut('setWeanIng', { actor:'엄마', id:'zucchini', ko:'애호박', vi:'', cubeG:10 });
  await mut('setWeanDay', { date: today, actor:'엄마', meals: [{ name:'아침',
    base: [], tops: [{ ing:'beef', g:15 }, { ing:'zucchini', g:15 }] }] });

  const open = async (lang) => {
    const ctx = await b.newContext({ viewport:{ width:390, height:900 },
      permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript(l => { localStorage.setItem('bbl_author','엄마');
      localStorage.setItem('bbl_lang', l); }, lang);
    await p.goto(BASE + '/'); await p.waitForTimeout(2200);
    await p.click('#btn-settings'); await p.waitForTimeout(600);
    await p.click('#set-wean'); await p.waitForTimeout(700);
    await p.click('#wn-tabs button[data-wn="shop"]'); await p.waitForTimeout(900);
    return p;
  };

  /* ── 한국어 화면 ── */
  let p = await open('ko');
  const btns = () => p.evaluate(()=>
    [...document.querySelectorAll('#wn-body [data-wn-copy]')].map(e=>e.dataset.wnCopy));
  check('한국어 화면에 베끼기 단추가 선다', (await btns()).indexOf('thịt bò') >= 0, true);
  check('...베트남어 이름이 없는 재료에는 안 선다',
    (await btns()).some(x => !x), false);
  check('...단추마다 설명이 붙는다 (읽어 주는 화면용)', await p.evaluate(()=>{
    const e = document.querySelector('#wn-body [data-wn-copy]');
    return !!(e && e.getAttribute('aria-label')); }), true);

  /* 눌러서 클립보드에 들어가는지 */
  await p.click('#wn-body [data-wn-copy="thịt bò"]');
  await p.waitForTimeout(900);
  check('누르면 클립보드에 베트남어 이름이 들어간다',
    await p.evaluate(()=>navigator.clipboard.readText()), 'thịt bò');
  check('...베꼈다고 말해 준다', await p.evaluate(()=>{
    const el = document.querySelector('.toast, #toast');
    return !!(el && /thịt bò/.test(el.textContent)); }), true);

  /* 베끼기를 눌러도 양 고치기 시트가 열리면 안 된다 — 같은 줄에 겹쳐 있다 */
  check('...양 고치기 시트는 열리지 않는다', await p.evaluate(()=>{
    const sh = document.getElementById('wn-amt-sheet');
    return !!(sh && sh.classList.contains('show')); }), false);
  await p.close();

  /* ── 베트남어 화면 ── */
  p = await open('vi');
  check('베트남어 화면에는 단추가 없다',
    await p.evaluate(()=>document.querySelectorAll('#wn-body [data-wn-copy]').length), 0);
  await p.close();

  check('페이지 오류 없음', errs, []);
  await mut('deleteWeanDay', { date: today, actor: '엄마' });
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
