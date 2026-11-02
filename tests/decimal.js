/* 소수점 — 점으로도 쉼표로도.

   "내가 지금 아이폰 국가설정을 베트남으로 바꿨는데 3.4 입력이 안되네.
   투약에서 3,4 이렇게 쓰잖아 베트남은." / "온점, 소숫점 다 입력 가능하게 해"
   / "그리고 상단 국가 설정 따라서 보여줘" (2026-11-02)

   iOS 는 폰 국가가 베트남이면 type=number 칸에 쉼표를 받아주지 않고 값을
   통째로 비운다. 그래서 소수를 받는 칸은 type=text + inputmode=decimal 이고,
   읽을 때 numVal 이 점·쉼표를 둘 다 받는다. 보여줄 때는 **앱 위쪽 언어
   설정**을 따른다 — 베트남어면 3,4 / 한국어면 3.4. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160));
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.entries = d.entries||[]; d.weights = d.weights||[]; return d; };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const open = async (lang) => {
    const p = await b.newPage({ viewport:{ width:390, height:900 } });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type()==='error' && !/favicon|net::ERR/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript((l)=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang', l); }, lang);
    await p.goto(BASE+'/'); await p.waitForTimeout(1900);
    return p;
  };
  const openRow = async (p, ko) => { await p.click(`.entry-row:has-text("${ko}") .e-time`); await p.waitForTimeout(800); };
  /* 칸에 직접 적는다 — 폰 자판이 무엇을 넣든 결과는 문자열 하나다 */
  const typeAmount = async (p, text) => p.evaluate((txt)=>{
    const box = document.querySelector('.ent-row2') || document.querySelector('.amt [data-scrub="ruler"]');
    const btn = box.querySelector('[data-scrub-exact]');
    if (btn) btn.click();
    const i = document.getElementById('f-amount');
    i.value = txt; i.dispatchEvent(new Event('change', { bubbles:true })); i.blur();
  }, text);

  let s = await st();
  for (const e of s.entries) await mut('deleteEntry', { id:e.id, actor:'엄마' });
  for (const w of s.weights) await mut('deleteWeight', { id:w.id, actor:'엄마' });
  const now = new Date(); now.setHours(10, 0, 0, 0);
  const iso = now.toISOString();
  await mut('addEntry', { type:'med',  start:iso, end:iso, author:'엄마', med:'Hemangiol' });
  await mut('addEntry', { type:'temp', start:iso, end:iso, temp:36.5, author:'엄마' });

  // ═══ 칸은 type=text + inputmode=decimal ═══
  let p = await open('ko');
  await openRow(p, '투약');
  check('투약 양 칸은 type=number 가 아니다 (iOS 쉼표 문제)', await p.evaluate(()=>{
    const i = document.getElementById('f-amount');
    return [i.getAttribute('type'), i.getAttribute('inputmode')];
  }), ['text', 'decimal']);

  // ═══ 쉼표로 적어도 들어간다 ═══
  await typeAmount(p, '3,4');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  check('쉼표로 적은 3,4 가 3.4 로 저장된다',
    (await st()).entries.filter(e=>e.type==='med')[0].amount, 3.4);
  // ═══ 점으로 적어도 들어간다 ═══
  await openRow(p, '투약');
  await typeAmount(p, '2.6');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  check('점으로 적은 2.6 도 그대로 저장된다',
    (await st()).entries.filter(e=>e.type==='med')[0].amount, 2.6);
  /* 한국어로 보면 점 */
  check('한국어 화면에는 점으로 보인다', await p.evaluate(()=>{
    const r = [...document.querySelectorAll('.entry-row')].filter(x=>/투약/.test(x.textContent))[0];
    return r.querySelector('.e-sub').textContent.trim(); }), 'Hemangiol · 2.6ml');

  // ═══ 체온 눈금의 직접 적기 ═══
  await openRow(p, '체온');
  check('체온 칸도 text + decimal 이다', await p.evaluate(()=>{
    const i = document.getElementById('f-temp');
    return [i.getAttribute('type'), i.getAttribute('inputmode')]; }), ['text','decimal']);
  await p.evaluate(()=>{
    const box = document.querySelector('.amt [data-scrub="ruler"]');
    box.querySelector('[data-scrub-exact]').click();
    const i = document.getElementById('f-temp');
    i.value = '37,8'; i.dispatchEvent(new Event('change', { bubbles:true })); i.blur();
  });
  await p.waitForTimeout(400);
  check('체온도 쉼표로 적힌다 (37,8 → 37.8)', await p.evaluate(()=>
    document.querySelector('.amt .scrub-val b').textContent), '37.8');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  check('...저장도 37.8', (await st()).entries.filter(e=>e.type==='temp')[0].temp, 37.8);
  await p.close();

  // ═══ 베트남어로 보면 쉼표 ═══
  p = await open('vi');
  check('베트남어 화면에는 쉼표로 보인다', await p.evaluate(()=>{
    const r = [...document.querySelectorAll('.entry-row')].filter(x=>/Hemangiol/.test(x.textContent))[0];
    return r.querySelector('.e-sub').textContent.trim(); }), 'Hemangiol · 2,6ml');
  await openRow(p, 'Uống thuốc');
  check('...칸에 채워진 값도 쉼표다', await p.evaluate(()=>
    document.getElementById('f-amount').value), '2,6');
  check('...눈금 큰 숫자도 쉼표다', await p.evaluate(()=>{
    const v = document.querySelector('.amt .scrub-val b');
    return v ? v.textContent : null; }), null);   /* 투약은 눈금이 아니라 상자다 */
  await p.click('#fp-entry-back'); await p.waitForTimeout(600);
  await openRow(p, 'Thân nhiệt');
  check('체온 눈금의 큰 숫자가 쉼표다', await p.evaluate(()=>
    document.querySelector('.amt .scrub-val b').textContent), '37,8');
  check('...눈금 라벨도 쉼표다', await p.evaluate(()=>{
    const b = [...document.querySelectorAll('.amt .sv.maj b')].map(x=>x.textContent);
    return b.filter(x=>/,/.test(x)).length === b.length; }), true);
  /* 쉼표로 보이는 값을 고치지 않고 저장해도 값이 그대로여야 한다 */
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  check('고치지 않고 저장해도 값이 안 바뀐다',
    (await st()).entries.filter(e=>e.type==='temp')[0].temp, 37.8);

  // ═══ 몸무게 칸 ═══
  await p.evaluate(()=>document.querySelector('.tab-btn[data-tab="growth"]').click());
  await p.waitForTimeout(900);
  await p.evaluate(()=>document.querySelector('[data-gv="graph"]').click());
  await p.waitForTimeout(900);
  check('몸무게 칸도 text + decimal 이다', await p.evaluate(()=>{
    const i = document.getElementById('weight-kg');
    return [i.getAttribute('type'), i.getAttribute('inputmode')]; }), ['text','decimal']);
  await p.evaluate(()=>{
    const f = document.getElementById('weight-form'); if (f) f.hidden = false;
    document.getElementById('weight-kg').value = '8,95';
    document.getElementById('weight-save').click();
  });
  await p.waitForTimeout(1600);
  check('몸무게도 쉼표로 적힌다 (8,95 → 8.95)',
    ((await st()).weights[0]||{}).kg, 8.95);
  check('...베트남어 목록에는 쉼표로 보인다', await p.evaluate(()=>
    /8,95/.test(document.getElementById('weight-card').innerText)), true);
  await p.close();

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
