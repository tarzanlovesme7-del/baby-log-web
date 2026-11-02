/* 커스텀 항목의 숫자 칸 — 그리고 kg 이면 새싹 탭까지.

   "기록 첫화면에 커스텀 항목으로 몸무게를 추가했어. 아무래도 여길 다들 많이
   보니까. 이 입력 란에 투약처럼 숫자만 입력해서 몸무게 넣고, 그렇게 넣은
   몸무게가 새싹 탭에도 연동되게끔." (2026-11-01)

   그래서 못 박는 것:
     - 단위를 정해 둔 커스텀 항목만 숫자 칸을 갖는다(단위 없는 항목은 없다).
     - 그 칸은 투약의 양 칸과 **같은 부품**이다 — 16px(iOS 확대 방지)에
       테두리 있는 상자, 옆에 단위 상자.
     - 적는 자리는 기록 한 곳이다. 저장하면 새싹 탭 몸무게가 따라오고,
       고치면 따라 고쳐지고, 지우면 따라 지워진다.
     - 숫자가 비면 곡선에 올리지 않는다(0kg 짜리 점을 그리지 않는다).
     - 목록 줄에서 숫자가 보인다 — 줄을 열지 않고도. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0, 160));
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json();
  const d = j.data || j; d.entries = d.entries || []; d.weights = d.weights || []; return d; };
const p2 = (x) => (x < 10 ? '0' : '') + x;
const today = (() => { const d = new Date();
  return d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate()); })();
const wOn = async (ds) => ((await st()).weights.filter(w => w.date === ds)[0] || null);

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  /* 폰은 베트남 시간이다 — UTC 로 두면 아침에 잰 몸무게가 전날로 간다 */
  const ctx = await b.newContext({ viewport:{ width:390, height:900 }, timezoneId:'Asia/Ho_Chi_Minh' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko');
  });

  /* ── 깨끗한 바닥 ── */
  let s = await st();
  for (const e of s.entries) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  for (const w of s.weights) await mut('deleteWeight', { id: w.id, actor: '엄마' });
  for (const c of (s.customTypes || [])) await mut('deleteCustomType', { id: c.id, actor: '엄마' });
  /* 실제 DB와 같은 모양: 그녀가 세워 둔 '몸무게' 항목 + 단위 없는 '병원' */
  const byName = async (nm) => ((await st()).customTypes || []).filter(c => c.name === nm)[0];
  await mut('addCustomType', { name:'몸무게', emoji:'ico:pencil', color:'#e0685c', unit:'kg' });
  await mut('addCustomType', { name:'병원', emoji:'ico:hospital', color:'#5b8dd6' });
  const kgType = await byName('몸무게'), plain = await byName('병원');
  check('단위는 커스텀 항목에 저장된다', [kgType.unit, plain.unit], ['kg', '']);

  const now = new Date(); now.setHours(9, 20, 0, 0);
  const iso = now.toISOString();
  await mut('addEntry', { type:'custom:' + kgType.id, start: iso, end: iso, author:'엄마' });
  await mut('addEntry', { type:'custom:' + plain.id,  start: iso, end: iso, author:'엄마' });

  await p.goto(BASE + '/');
  await p.waitForTimeout(2000);
  const openRow = async (ko) => { await p.click(`.entry-row:has-text("${ko}") .e-time`); await p.waitForTimeout(800); };
  const back = async () => { await p.click('#fp-entry-back'); await p.waitForTimeout(600); };

  // ═══ 숫자 칸 ═══
  await openRow('몸무게');
  check('몸무게 기록에 숫자 칸이 있다', await p.evaluate(()=>{
    const i = document.getElementById('f-amount');
    return !!i && i.type === 'text' && i.getAttribute('inputmode') === 'decimal';
  }), true);
  check('...눈금자가 아니라 투약과 같은 상자다', await p.evaluate(()=>{
    const i = document.getElementById('f-amount');
    return [!!i.closest('.ent-row2'), !!i.closest('[data-scrub]')];
  }), [true, false]);
  check('...글씨는 16px 이다(iOS 확대 방지)', await p.evaluate(()=>
    parseFloat(getComputedStyle(document.getElementById('f-amount')).fontSize)), 16);
  check('...테두리가 있는 상자다', await p.evaluate(()=>
    parseFloat(getComputedStyle(document.getElementById('f-amount')).borderTopWidth) > 0), true);
  check('...옆에 kg 상자가 선다', await p.evaluate(()=>{
    const u = document.querySelector('#fp-entry-body .ent-row2 .ent-unit');
    return u ? u.textContent.trim() : null; }), 'kg');
  check('...처음에는 비어 있다(0 이 적혀 있지 않다)', await p.evaluate(()=>
    document.getElementById('f-amount').value), '');
  check('...새싹에 올라간다고 말해 준다', await p.evaluate(()=>
    [...document.querySelectorAll('#fp-entry-body .field-hint')].some(x=>/새싹/.test(x.textContent))), true);

  /* ── 적으면 새싹 탭 몸무게가 된다 ── */
  await p.fill('#f-amount', '8.9');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  const w1 = await wOn(today);
  check('저장하면 그날 몸무게가 생긴다', w1 && [w1.date, w1.kg, w1.src], [today, 8.9, 'entry']);
  check('...기록 하나당 하나다', (await st()).weights.length, 1);
  check('목록 줄에 8.9kg 이 보인다', await p.evaluate(()=>{
    const r = [...document.querySelectorAll('.entry-row')].filter(x=>/몸무게/.test(x.textContent))[0];
    const sub = r && r.querySelector('.e-sub');
    return sub ? sub.textContent.trim() : null; }), '8.9kg');

  /* ── 새싹 탭에서 읽힌다 ── */
  await p.evaluate(()=>document.querySelector('.tab-btn[data-tab="growth"]').click());
  await p.waitForTimeout(1000);
  await p.evaluate(()=>document.querySelector('[data-gv="graph"]').click());
  await p.waitForTimeout(1000);
  check('새싹 탭 몸무게 카드에 8.9 가 있다', await p.evaluate(()=>
    /8\.9/.test(document.getElementById('weight-card').innerText)), true);
  check('...곡선이 그려진다(빈 카드가 아니다)', await p.evaluate(()=>
    !!document.querySelector('#weight-chart-wrap svg')), true);
  check('...목록에도 그날이 선다', await p.evaluate(()=>
    document.querySelectorAll('#weight-list .gline, #weight-list [data-kb-weight]').length >= 1), true);

  /* ── 고치면 따라 고쳐진다 ── */
  await p.evaluate(()=>document.querySelector('.tab-btn[data-tab="record"]').click());
  await p.waitForTimeout(900);
  await openRow('몸무게');
  check('다시 열면 적은 숫자가 그대로 있다', await p.evaluate(()=>
    document.getElementById('f-amount').value), '8.9');
  await p.fill('#f-amount', '9.15');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  const w2 = await wOn(today);
  check('고친 숫자가 몸무게에 반영된다', [w2.kg, (await st()).weights.length], [9.15, 1]);

  /* ── 비우면 곡선에서 내려간다 ── */
  await openRow('몸무게');
  await p.fill('#f-amount', '');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  check('숫자를 비우면 몸무게도 없어진다', await wOn(today), null);

  /* ── 다시 적고, 기록을 지우면 ── */
  await openRow('몸무게');
  await p.fill('#f-amount', '8.7');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  check('다시 적으면 다시 올라간다', (await wOn(today)).kg, 8.7);
  const kgEntry = (await st()).entries.filter(e=>e.type === 'custom:' + kgType.id)[0];
  await mut('deleteEntry', { id: kgEntry.id, actor:'엄마' });
  check('기록을 지우면 몸무게도 내려간다', await wOn(today), null);
  await mut('restoreEntry', { id: kgEntry.id, actor:'엄마', day: today });
  check('휴지통에서 되살리면 다시 올라간다', (await wOn(today)).kg, 8.7);

  /* ── 손으로 적은 몸무게는 남의 것이다 ── */
  await mut('addWeight', { date:'2026-10-01', kg: 8.1, author:'엄마' });
  check('예전에 손으로 적은 몸무게는 건드리지 않는다',
    ((await st()).weights.filter(w=>w.date==='2026-10-01')[0]||{}).kg, 8.1);

  /* ── 단위 없는 항목에는 숫자 칸이 없다 ── */
  await p.reload(); await p.waitForTimeout(2000);
  await openRow('병원');
  check('단위 없는 커스텀 항목에는 숫자 칸이 없다', await p.evaluate(()=>
    !!document.getElementById('f-amount')), false);
  check('...단위 상자도 없다', await p.evaluate(()=>
    !!document.querySelector('#fp-entry-body .ent-unit')), false);
  await back();

  /* ── 설정에서 단위를 나중에 달아 줄 수 있다 ── */
  await p.click('#btn-settings'); await p.waitForTimeout(800);
  await p.click('[data-set-go="types"]'); await p.waitForTimeout(800);
  check('설정 항목 목록에 단위 칸이 있다', await p.evaluate(()=>
    document.querySelectorAll('#custom-type-manage-list [data-unit-type]').length), 2);
  await p.evaluate((id)=>{
    const i = document.querySelector('[data-unit-type="' + id + '"]');
    i.value = 'cm'; i.dispatchEvent(new Event('change', { bubbles: true }));
  }, plain.id);
  await p.waitForTimeout(1400);
  check('...고치면 저장된다', ((await st()).customTypes.filter(c=>c.id===plain.id)[0]||{}).unit, 'cm');

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
