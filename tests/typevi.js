/* 커스텀 항목도 이름이 둘이다.

   "유산균, 터미타임, 몸무게도 베트남어로 보이게 해줘" (2026-11-04)

   붙박이 항목(분유·수면…)은 사전에 두 나라 말이 다 있는데, 사람이 만든
   항목은 적은 이름 하나뿐이라 이모 폰에서도 한글로 떴다. 내니 이름
   (customAuthors.nameVi)과 **같은 짜임**으로 베트남어 이름을 하나 더 둔다:
     - 저장은 두 이름 다. 베트남어가 비면 한국어 이름으로 떨어진다.
     - 설정의 그 줄에서 손으로 고칠 수 있다(기계 번역은 짐작이다).
     - 한 번 고친 이름은 자동 번역이 덮지 않는다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,140));
  return (await r.json().catch(()=>({}))); }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json();
  const d = j.data || j; d.customTypes = d.customTypes || []; return d; };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];

  /* 깨끗한 바닥 */
  for (const c of (await st()).customTypes) await mut('deleteCustomType', { id: c.id });
  const mk = async (name, nameVi, unit) =>
    (await mut('addCustomType', { name, nameVi, unit: unit || '', emoji:'🏷️',
      color:'var(--c-custom)' })).result.customType;
  const probi = await mk('유산균', 'Men vi sinh');
  const tummy = await mk('터미타임', 'Nằm sấp');
  const kg    = await mk('몸무게', 'Cân nặng', 'kg');
  const bare  = await mk('모빌', '');        /* 베트남어가 없는 항목 */
  check('베트남어 이름이 저장된다',
    (await st()).customTypes.map(c=>c.nameVi), ['Men vi sinh', 'Nằm sấp', 'Cân nặng', '']);

  const open = async (lang) => {
    const p = await b.newPage({ viewport:{ width:390, height:900 } });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript(l => { localStorage.setItem('bbl_author','엄마');
      localStorage.setItem('bbl_lang', l); }, lang);
    await p.goto(BASE + '/'); await p.waitForTimeout(2200);
    return p;
  };
  const quick = (p) => p.evaluate(()=>
    [...document.querySelectorAll('#qa-grid .qa-btn')].map(e=>e.textContent.trim()));

  /* ── 한국어 폰 ── */
  let p = await open('ko');
  let q = await quick(p);
  check('한국어 폰에는 한국어 이름', ['유산균','터미타임','몸무게','모빌']
    .every(n => q.some(x => x.indexOf(n) >= 0)), true);
  await p.close();

  /* ── 베트남어 폰 ── */
  p = await open('vi');
  q = await quick(p);
  check('베트남어 폰에는 베트남어 이름', ['Men vi sinh','Nằm sấp','Cân nặng']
    .every(n => q.some(x => x.indexOf(n) >= 0)), true);
  check('...한국어 이름은 남지 않는다',
    q.filter(x => /유산균|터미타임|몸무게/.test(x)), []);
  check('베트남어 이름이 없으면 한국어 이름으로 떨어진다',
    q.some(x => x.indexOf('모빌') >= 0), true);

  /* 기록 줄과 기록 시트에서도 같은 이름 */
  await mut('addEntry', { type:'custom:'+probi.id, start:new Date().toISOString(), author:'엄마' });
  await p.evaluate(()=> window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);
  check('기록 줄에도 베트남어로 적힌다', await p.evaluate(()=>
    [...document.querySelectorAll('.entry-row .e-title')].map(e=>e.textContent.trim())
      .some(x => x.indexOf('Men vi sinh') >= 0)), true);

  /* 일과표 범례 */
  await p.click('.tab-btn[data-tab="stats"]'); await p.waitForTimeout(1300);
  check('일과표 범례도 베트남어다', await p.evaluate(()=>{
    const ls = [...document.querySelectorAll('#pattern-toggles button')].map(e=>e.textContent.trim());
    return [ls.some(x=>x.indexOf('Men vi sinh')>=0), ls.some(x=>/[가-힣]/.test(x))];
  }), [true, false]);
  await p.close();

  /* ── 설정에서 손으로 고친다 ── */
  p = await open('ko');
  await p.click('#btn-settings'); await p.waitForTimeout(700);
  await p.click('[data-set-go="types"]'); await p.waitForTimeout(800);
  check('항목마다 베트남어 칸이 선다', await p.evaluate(()=>
    document.querySelectorAll('#custom-type-manage-list [data-vi-type]').length), 4);
  await p.fill('#custom-type-manage-list [data-vi-type="' + bare.id + '"]', 'Đồ chơi treo nôi');
  await p.locator('#custom-type-manage-list [data-vi-type="' + bare.id + '"]').blur();
  await p.waitForTimeout(1600);
  check('...고치면 저장된다',
    ((await st()).customTypes.filter(c=>c.id===bare.id)[0]||{}).nameVi, 'Đồ chơi treo nôi');
  await p.close();

  p = await open('vi');
  check('...이모 폰에 바로 보인다',
    (await quick(p)).some(x => x.indexOf('Đồ chơi treo nôi') >= 0), true);
  check('손으로 적은 이름을 자동 번역이 덮지 않는다', await (async()=>{
    await p.waitForTimeout(3200);
    return ((await st()).customTypes.filter(c=>c.id===bare.id)[0]||{}).nameVi;
  })(), 'Đồ chơi treo nôi');
  await p.close();

  /* 단위(kg)는 그대로 — 베트남어 칸을 끼워 넣느라 밀리지 않았는지 */
  check('단위는 그대로다',
    ((await st()).customTypes.filter(c=>c.id===kg.id)[0]||{}).unit, 'kg');
  check('터미타임도 그대로다',
    ((await st()).customTypes.filter(c=>c.id===tummy.id)[0]||{}).nameVi, 'Nằm sấp');

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
