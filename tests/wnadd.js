/* 식단에 재료 넣기 — 이름을 쳐서 찾는 전체 화면 (2026-11-27)

   "새 식단 입력할 때도 큐브 재고 입력하는 것처럼 텍스트 검색으로 재료 검색할 수 있게"

   못 박는 것:
     - '+ 토핑' / '+ 베이스'는 시트가 아니라 전체 화면을 연다. 알약 밭이 없다.
     - 초성·덜 친 글자로 찾는다(큐브 만들기와 같은 찾기).
     - 토핑 칸에는 토핑만, 베이스 칸에는 베이스죽만. 이미 이 끼니에 든 재료는 안 뜬다.
     - 안 쳤을 때 토핑은 '요즘 식단에 자주 쓴 재료'만, 베이스는 전부.
     - 이 날 전에 식단에 한 번도 안 나온 재료에는 '처음'이 붙는다.
     - 엔터는 맨 위 결과를 고른다. 저장하면 끼니에 칩이 서고, 하루 저장으로 서버에 간다.
     - 고르지 않고 저장하면 막는다. 있는 재료 g 고치기는 예전 시트 그대로. */
const { chromium } = require(process.env.PW || 'playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) console.log('!! ' + t + ' ' + JSON.stringify(j).slice(0, 160));
  return j; }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };
const p2 = (x) => (x < 10 ? '0' : '') + x;
const dstr = (d) => d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate());
const dAdd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport:{ width:390, height:844 }, timezoneId:'Asia/Ho_Chi_Minh' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon|Failed to load/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => { localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko'); });

  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(1200);   /* 여기서 씨앗이 심긴다 */

  /* 오늘 식단을 우리가 아는 모양으로 — 쌀죽 + 소고기·애호박. 어제·그제에 당근이 나왔다. */
  const T = dAdd(0);
  for (let i = -20; i <= 20; i++) await mut('setWeanDay', { date: dAdd(i), actor:'엄마', meals: [] });
  await mut('setWeanDay', { date: dAdd(-2), actor:'엄마', meals:[{ name:'아침', base:[{ ing:'pgy', g:40 }], tops:[{ ing:'carrot', g:10 }] }] });
  await mut('setWeanDay', { date: dAdd(-1), actor:'엄마', meals:[{ name:'아침', base:[{ ing:'pgy', g:40 }], tops:[{ ing:'carrot', g:10 }, { ing:'broccoli', g:10 }] }] });
  await mut('setWeanDay', { date: T, actor:'엄마', meals:[{ name:'아침', base:[{ ing:'pgy', g:40 }], tops:[{ ing:'beef', g:10 }, { ing:'zucchini', g:10 }] }] });
  await p.reload(); await p.waitForTimeout(2000);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(900);
  await p.click('#wn-add'); await p.waitForTimeout(900);   /* 식단표의 + = 오늘에 새 끼니(빈 화면) */
  check('새 끼니 고치기가 열린다', await p.evaluate(() => document.getElementById('fp-weanday').classList.contains('show')), true);

  /* ── + 토핑 ── */
  await p.click('#fp-weanday-body [data-wn-edit="tops:-1"]'); await p.waitForTimeout(600);
  const fp = await p.evaluate(() => {
    const el = document.getElementById('fp-wnadd'), r = el.getBoundingClientRect();
    return { show: el.classList.contains('show'), top: Math.round(r.top),
      sheet: document.getElementById('wn-ing-sheet').classList.contains('show'),
      chips: document.querySelectorAll('#fp-wnadd .chip').length,
      title: document.getElementById('wn-add-title').textContent };
  });
  check('+ 토핑은 시트가 아니라 전체 화면, 알약 없음', fp, { show:true, top:0, sheet:false, chips:0, title:'토핑' });
  const idle = await p.evaluate(() => ({
    cap: (document.querySelector('#wn-add-ings .wp-cap') || {}).textContent,
    ids: [...document.querySelectorAll('#wn-add-ings [data-add-ing]')].map(x => x.dataset.addIng) }));
  check('안 쳤을 때는 요즘 식단에 자주 쓴 재료만 — 당근이 맨 위(두 번)', [idle.cap, idle.ids[0]], ['요즘 식단에 자주 쓴 재료', 'carrot']);
  check('...오늘 아침에 쓴 소고기·애호박도 자주 쓴 재료로 뜬다(이 끼니엔 아직 없으니)', idle.ids.includes('beef') && idle.ids.includes('zucchini'), true);
  check('...베이스죽은 토핑 칸에 안 뜬다', idle.ids.includes('pgy'), false);

  await p.fill('#wn-add-q', 'ㄷㅎ'); await p.waitForTimeout(200);
  let rows = await p.evaluate(() => [...document.querySelectorAll('#wn-add-ings .wn-pick-row')].map(r => ({
    nm: r.querySelector('.wp-nm').textContent, nw: !!r.querySelector('.wp-new') })));
  check('초성으로 찾는다 — ㄷㅎ → 단호박', rows.map(r => r.nm).includes('단호박'), true);
  check('...식단에 처음 나오는 재료엔 "처음"', (rows.find(r => r.nm === '단호박') || {}).nw, true);
  await p.fill('#wn-add-q', 'ㅂ'); await p.waitForTimeout(200);
  const bfirst = await p.evaluate(() => [...document.querySelectorAll('#wn-add-ings .wp-nm')].map(x => x.textContent));
  check('초성 하나로 치면 그 초성으로 시작하는 것이 위 — ㅂ에 두부(ㄷㅂ)가 맨 위로 안 온다',
    bfirst.length > 2 && bfirst[0] !== '두부' && /^[바-빟]/.test(bfirst[0]), true);
  await p.fill('#wn-add-q', '당'); await p.waitForTimeout(200);
  rows = await p.evaluate(() => [...document.querySelectorAll('#wn-add-ings .wn-pick-row')].map(r => ({
    nm: r.querySelector('.wp-nm').textContent, nw: !!r.querySelector('.wp-new') })));
  check('...이미 먹어 본(식단에 나온) 당근엔 "처음"이 없다', (rows.find(r => r.nm === '당근') || {}).nw, false);
  await p.fill('#wn-add-q', '쌀'); await p.waitForTimeout(200);
  check('토핑 칸에서 베이스죽은 쳐도 안 나온다', await p.evaluate(() =>
    [...document.querySelectorAll('#wn-add-ings [data-add-ing]')].map(x => x.dataset.addIng).filter(id => /^pg/.test(id)).length), 0);

  /* 안 고르고 저장 → 막힘 */
  await p.fill('#wn-add-q', ''); await p.waitForTimeout(150);
  await p.click('#wn-add-save'); await p.waitForTimeout(300);
  check('고르지 않으면 저장하지 않고 화면도 안 닫힌다',
    await p.evaluate(() => document.getElementById('fp-wnadd').classList.contains('show')), true);

  await p.fill('#wn-add-q', '단호바'); await p.press('#wn-add-q', 'Enter'); await p.waitForTimeout(200);
  check('엔터는 맨 위 결과를 고른다', await p.evaluate(() =>
    (document.querySelector('#wn-add-ings [aria-pressed="true"]') || { dataset:{} }).dataset.addIng), 'pumpkin');
  check('...토핑 기본 양은 10g', await p.inputValue('#wn-add-g'), '10');
  await p.fill('#wn-add-g', '15');
  await p.click('#wn-add-save'); await p.waitForTimeout(500);
  check('저장하면 닫히고 하루 고치기로 돌아온다', await p.evaluate(() => [
    document.getElementById('fp-wnadd').classList.contains('show'),
    document.getElementById('fp-weanday').classList.contains('show')]), [false, true]);
  check('...끼니에 단호박 15g 칩이 선다', await p.evaluate(() =>
    [...document.querySelectorAll('#fp-weanday-body .wn-ing:not(.add)')].some(x => /단호박/.test(x.textContent) && /15g/.test(x.textContent))), true);

  /* 같은 끼니에 다시 + 토핑 — 방금 넣은 단호박은 안 뜬다 */
  await p.click('#fp-weanday-body [data-wn-edit="tops:-1"]'); await p.waitForTimeout(600);
  await p.fill('#wn-add-q', '단호'); await p.waitForTimeout(200);
  check('끼니에 이미 든 재료는 쳐서도 안 나온다', await p.evaluate(() =>
    !!document.querySelector('#wn-add-ings .wp-empty')), true);
  await p.click('#wn-add-close'); await p.waitForTimeout(500);
  check('뒤로 가면 아무것도 안 넣고 닫힌다', await p.evaluate(() =>
    document.querySelectorAll('#fp-weanday-body .wn-ing:not(.add)').length), 1);

  /* ── + 베이스 ── */
  await p.click('#fp-weanday-body [data-wn-edit="base:-1"]'); await p.waitForTimeout(600);
  const base = await p.evaluate(() => ({ title: document.getElementById('wn-add-title').textContent,
    g: document.getElementById('wn-add-g').value,
    ids: [...document.querySelectorAll('#wn-add-ings [data-add-ing]')].map(x => x.dataset.addIng) }));
  check('+ 베이스는 베이스죽만, 안 쳐도 전부', [base.title, base.g,
    base.ids.length > 3, base.ids.every(id => /^pg/.test(id)), base.ids.includes('pgy')], ['베이스', '50', true, true, true]);
  await p.click('#wn-add-ings [data-add-ing="pgy"]'); await p.waitForTimeout(150);
  await p.click('#wn-add-save'); await p.waitForTimeout(500);
  await p.click('#fp-weanday-body [data-wn-edit="base:-1"]'); await p.waitForTimeout(600);
  check('...넣은 쌀죽은 다음엔 안 뜬다', await p.evaluate(() =>
    [...document.querySelectorAll('#wn-add-ings [data-add-ing]')].map(x => x.dataset.addIng).includes('pgy')), false);
  await p.click('#wn-add-close'); await p.waitForTimeout(500);

  /* 있는 재료 g 고치기는 예전 시트 */
  await p.click('#fp-weanday-body .wn-ing:not(.add):has-text("단호박")'); await p.waitForTimeout(500);
  check('있는 재료를 누르면 시트(g 고치기·빼기)', await p.evaluate(() => [
    document.getElementById('wn-ing-sheet').classList.contains('show'),
    document.getElementById('fp-wnadd').classList.contains('show'),
    document.getElementById('wn-ing-remove').hidden, document.getElementById('wn-ing-g').value]), [true, false, false, '15']);
  await p.fill('#wn-ing-g', '20'); await p.click('#wn-ing-save'); await p.waitForTimeout(500);

  /* 하루 저장 → 서버 */
  await p.click('#fp-weanday-save'); await p.waitForTimeout(1500);
  const day = ((await st()).weanPlan || {})[T];
  const nm = (day && day.meals || []).find(m => (m.tops || []).some(x => x.ing === 'pumpkin'));
  check('저장하면 서버 식단에 새 끼니 — 쌀죽 50g + 단호박 20g', nm ? [nm.base.map(x => x.ing + ':' + x.g), nm.tops.map(x => x.ing + ':' + x.g)] : null,
    [['pgy:50'], ['pumpkin:20']]);
  check('...원래 아침은 그대로', (day.meals.find(m => m !== nm) || { tops: [] }).tops.map(x => x.ing).sort(), ['beef', 'zucchini']);

  check('화면 오류 없음', errs, []);
  await b.close();
  const f = R.filter(r => !r.ok).length;
  console.log('\n' + (R.length - f) + '/' + R.length + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
