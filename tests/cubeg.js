/* 큐브 — g 으로 빼기 · 숫자 바로 고치기 · 재료 찾아 고르는 전체 화면 (2026-11-25)

   "단호박 20g도 만들고 50g 큐브도 만들면 식단이랑 같은 그람수로 빠지나?
    베이스죽 같은 경우에도 25g이 있고 50g이 있는데"
   "큐브 재고 숫자 클릭하면 그냥 숫자를 바로 바꿀 수 있었으면"
   "항목명을 텍스트로 쳐서 검색 … 바텀 시트 말고 풀 화면"

   못 박는 것:
     - 기록 한 건이 메뉴의 g 만큼 뺀다. 먹일 g 이하인 칸 중 가장 큰 칸부터,
       같은 크기면 오래된 것부터. 50g → 50g 한 칸, 없으면 25g 두 칸.
     - 10g 먹이는데 25g 칸밖에 없으면 25g 하나. 30g 먹이는데 25g 칸뿐이면 하나
       (남은 5g 은 칸 반도 안 된다).
     - 기록을 지우면 **뺀 그 덩어리로** 그대로 돌아온다. 그 사이 덩어리가 비어
       치워졌으면 같은 날·같은 g 으로 다시 선다.
     - 이번 주 '있는 것'은 g 으로 센다 — 50g×2 + 25g×4 는 50g 네 번.
     - 재고 숫자를 누르면 입력칸이 되고, 엔터로 그 수가 된다(서버에도).
     - '큐브 만들었어요'는 전체 화면이고 알약이 없다. 초성으로도 찾는다.
       안 쳤을 때는 이번 주 만들 것만 보인다. 엔터는 맨 위 것을 고른다. */
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
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json();
  const d = j.data || j; d.weanCubes = d.weanCubes || []; d.entries = d.entries || []; return d; };
const p2 = (x) => (x < 10 ? '0' : '') + x;
const dstr = (d) => d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate());
const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d); };
const today = dAgo(0);
const pile = async (ing) => (await st()).weanCubes.filter(c => c.ing === ing)
  .sort((a, b) => a.madeOn.localeCompare(b.madeOn) || a.perG - b.perG)
  .map(c => c.perG + 'g×' + c.n);
async function clear(){ for (const c of (await st()).weanCubes) await mut('setWeanCube', { ing: c.ing, n: 0, actor: '엄마' }); }
async function feed(ings){
  const r = await mut('addEntry', { type:'wean', start: new Date().toISOString(), author:'엄마', actor:'엄마', ings });
  return (r.result && r.result.entry && r.result.entry.id) || (r.entry && r.entry.id) || r.id;
}
async function unfeed(id){ await mut('deleteEntry', { id, actor:'엄마' }); }

(async () => {
  /* ── 1. g 으로 빼기 (서버) ── */
  await clear();
  check('냉동실이 비었다', (await st()).weanCubes.length, 0);
  await mut('addWeanCubes', { ing:'pgbeef', n:4, perG:25, madeOn: dAgo(5), actor:'엄마' });
  await mut('addWeanCubes', { ing:'pgbeef', n:2, perG:50, madeOn: dAgo(1), actor:'엄마' });
  await mut('addWeanCubes', { ing:'carrot', n:5, perG:10, madeOn: dAgo(2), actor:'엄마' });

  const e1 = await feed([{ ing:'pgbeef', g:50 }, { ing:'carrot', g:10 }]);
  check('50g 먹이면 — 오래된 25g 이 아니라 50g 한 칸이 빠진다', await pile('pgbeef'), ['25g×4', '50g×1']);
  check('토핑 10g 은 10g 한 칸', await pile('carrot'), ['10g×4']);
  const e1row = (await st()).entries.find(e => e.id === e1);
  check('무엇을 뺐는지 기록에 적힌다', (e1row.cubeTook || []).map(t => t.ing + ':' + t.perG + 'g×' + t.n).sort(),
    ['carrot:10g×1', 'pgbeef:50g×1']);

  const e2 = await feed([{ ing:'pgbeef', g:50 }]);
  const e3 = await feed([{ ing:'pgbeef', g:50 }]);
  check('50g 칸이 다 떨어지면 25g 두 칸', await pile('pgbeef'), ['25g×2']);

  await unfeed(e2);
  check('기록을 지우면 뺀 그 50g 칸이 돌아온다 — 비어서 치워졌던 덩어리도 같은 날·같은 g 으로',
    await pile('pgbeef'), ['25g×2', '50g×1']);
  const back50 = (await st()).weanCubes.find(c => c.ing === 'pgbeef' && c.perG === 50);
  check('...만든 날도 그대로', back50 && back50.madeOn, dAgo(1));
  await unfeed(e3);
  check('25g 두 칸을 뺐던 기록을 지우면 25g 두 칸이 돌아온다', await pile('pgbeef'), ['25g×4', '50g×1']);

  /* 칸이 먹일 g 보다 큰 경우 */
  await clear();
  await mut('addWeanCubes', { ing:'pumpkin', n:3, perG:25, madeOn: today, actor:'엄마' });
  await feed([{ ing:'pumpkin', g:10 }]);
  check('10g 먹이는데 25g 칸뿐이면 한 칸', await pile('pumpkin'), ['25g×2']);
  await feed([{ ing:'pumpkin', g:30 }]);
  check('30g 먹이는데 25g 칸뿐이면 한 칸 — 남은 5g 은 반 칸도 안 된다', await pile('pumpkin'), ['25g×1']);
  await mut('addWeanCubes', { ing:'pumpkin', n:3, perG:25, madeOn: today, actor:'엄마' });
  await feed([{ ing:'pumpkin', g:40 }]);
  check('40g 이면 25g 두 칸 — 남은 15g 이 반 칸을 넘는다', await pile('pumpkin'), ['25g×2']);
  await feed([{ ing:'pumpkin', g:0 }]);
  check('g 이 비어 있으면 예전처럼 한 칸', await pile('pumpkin'), ['25g×1']);
  await feed([{ ing:'pumpkin', g:100 }]);
  check('모자라면 있는 만큼만 — 음수가 되거나 멈추지 않는다', await pile('pumpkin'), []);
  const eKit = await feed([{ ing:'k_egg', g:12 }]);
  check('큐브가 없는 재료(키트)는 아무것도 안 뺀다 — 오류도 없다', !!eKit, true);

  /* ── 2. 화면 ── */
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport:{ width:390, height:844 }, timezoneId:'Asia/Ho_Chi_Minh' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon|Failed to load/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => { localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko'); });

  await clear();
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(1200);
  const ingsN = (await st()).weanIngs.length;
  const gotoCubes = async () => {
    await p.reload(); await p.waitForTimeout(2000);
    await p.click('#btn-settings'); await p.waitForTimeout(500);
    await p.click('#set-wean'); await p.waitForTimeout(800);
    await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(500);
  };
  check('재료 사전이 있다(씨앗)', ingsN > 20, true);

  /* 이번 주 '있는 것'은 g 으로 — 쌀죽 한 칸은 40g. 40g×2 + 20g×4 = 160g = 40g 네 번 */
  await mut('setWeanDay', { date: today, actor:'엄마', meals:[{ name:'아침', base:[{ ing:'pgy', g:40 }], tops:[] }] });
  await mut('addWeanCubes', { ing:'pgy', n:2, perG:40, madeOn: today, actor:'엄마' });
  await mut('addWeanCubes', { ing:'pgy', n:4, perG:20, madeOn: dAgo(1), actor:'엄마' });
  await p.reload(); await p.waitForTimeout(2000);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await p.click('#set-wean'); await p.waitForTimeout(900);
  await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(500);
  await p.click('#wn-body [data-wn-cv="use"]'); await p.waitForTimeout(500);
  const useCap = await p.evaluate(() => [...document.querySelectorAll('#wn-body .wn-line')]
    .filter(l => /쌀죽/.test(l.textContent)).map(l => l.querySelector('.t-caption').textContent)[0]);
  check('있는 것을 g 으로 센다 — 40g×2 + 20g×4 는 40g 네 번(여섯 칸이 아니라)', useCap, '지금 4칸 · 필요 1칸');
  await p.click('#wn-body [data-wn-cv="have"]'); await p.waitForTimeout(400);
  for (const c of (await st()).weanCubes) await mut('setWeanCube', { ing: c.ing, n: 0, actor: '엄마' });
  await p.waitForTimeout(2500);

  await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(700);
  await p.click('#wn-add'); await p.waitForTimeout(700);
  const fp = await p.evaluate(() => {
    const el = document.getElementById('fp-wncube');
    const r = el.getBoundingClientRect();
    return { show: el.classList.contains('show'), top: Math.round(r.top), h: Math.round(r.height) >= 700,
      chips: document.querySelectorAll('#fp-wncube .chip').length,
      sheet: !!document.getElementById('wn-cube-sheet') };
  });
  check('큐브 만들기는 전체 화면이다(바텀 시트 아님)', fp, { show:true, top:0, h:true, chips:0, sheet:false });
  const idle = await p.evaluate(() => [...document.querySelectorAll('#wn-cube-ings [data-cube-ing]')].length);
  check('아무것도 안 쳤을 때 재료 사전 전부가 깔리지 않는다', idle < ingsN, true);

  await p.fill('#wn-cube-q', 'ㄷㅎ'); await p.waitForTimeout(250);
  let names = await p.evaluate(() => [...document.querySelectorAll('#wn-cube-ings .wp-nm')].map(x => x.textContent));
  check('초성으로 찾는다 — ㄷㅎ → 단호박', names.includes('단호박'), true);
  await p.fill('#wn-cube-q', '단호바'); await p.waitForTimeout(250);
  names = await p.evaluate(() => [...document.querySelectorAll('#wn-cube-ings .wp-nm')].map(x => x.textContent));
  check('치는 중인 글자로도 걸린다 — 단호바 → 단호박', names[0], '단호박');
  await p.fill('#wn-cube-q', '양'); await p.waitForTimeout(250);
  names = await p.evaluate(() => [...document.querySelectorAll('#wn-cube-ings .wp-nm')].map(x => x.textContent));
  check('앞에서부터 맞는 짧은 것이 위 — 양 → 양파 · 양배추 · 양송이버섯', names, ['양파', '양배추', '양송이버섯']);
  await p.fill('#wn-cube-q', 'bi do'); await p.waitForTimeout(250);
  names = await p.evaluate(() => [...document.querySelectorAll('#wn-cube-ings .wp-nm')].map(x => x.textContent));
  check('베트남어도 성조 없이 찾는다 — bi do → 단호박(bí đỏ)', names.includes('단호박'), true);
  await p.fill('#wn-cube-q', '계란키트'); await p.waitForTimeout(200);
  await p.fill('#wn-cube-q', '키트'); await p.waitForTimeout(200);
  const kitRows = await p.evaluate(() => [...document.querySelectorAll('#wn-cube-ings [data-cube-ing]')]
    .map(x => x.dataset.cubeIng).filter(id => /^k_/.test(id)).length);
  check('알러지 키트는 큐브로 만들 것이 아니라 안 나온다', kitRows, 0);
  await p.fill('#wn-cube-q', 'zzzz'); await p.waitForTimeout(200);
  check('없으면 없다고', await p.evaluate(() => document.querySelector('#wn-cube-ings .wp-empty').textContent), '찾는 재료가 없어요');

  /* 고르지 않고 저장하면 막는다 */
  await p.fill('#wn-cube-q', ''); await p.waitForTimeout(150);
  await p.click('#wn-cube-save'); await p.waitForTimeout(300);
  check('재료를 안 고르면 저장하지 않고 화면도 안 닫힌다',
    await p.evaluate(() => document.getElementById('fp-wncube').classList.contains('show')), true);

  await p.fill('#wn-cube-q', 'ㄷㅎㅂ'); await p.press('#wn-cube-q', 'Enter'); await p.waitForTimeout(250);
  const pick = await p.evaluate(() => ({ sel: (document.querySelector('#wn-cube-ings [aria-pressed="true"]') || {dataset:{}}).dataset.cubeIng,
    on: [...document.querySelectorAll('#wn-cube-ings [aria-pressed="true"] .wp-nm')].map(x => x.textContent),
    g: document.getElementById('wn-cube-g').value }));
  const pumpG = ((await st()).weanIngs.find(g => g.id === 'pumpkin') || {}).cubeG || 10;
  check('엔터는 맨 위 결과를 고르고, 한 칸 g 이 그 재료 기본값으로', pick, { sel:'pumpkin', on:['단호박'], g: String(pumpG) });
  await p.fill('#wn-cube-n', '7');
  await p.click('#wn-cube-save'); await p.waitForTimeout(1500);
  check('저장하면 닫히고', await p.evaluate(() => document.getElementById('fp-wncube').classList.contains('show')), false);
  check('...단호박 7칸이 선다', await pile('pumpkin'), [pumpG + 'g×7']);
  check('...재고 탭으로 돌아와 있다', await p.evaluate(() => !!document.querySelector('#wn-body .cb-row')), true);

  /* '만들 것' 줄을 누르면 그 재료가 골라진 채 열린다 */
  await mut('setWeanDay', { date: today, actor:'엄마', meals:[{ name:'아침', base:[], tops:[{ ing:'carrot', g:10 }] }] });
  await gotoCubes();
  await p.click('#wn-body [data-wn-cv="make"]'); await p.waitForTimeout(500);
  const makeN = await p.evaluate(() => document.querySelector('#wn-body [data-wn-make="carrot"]').dataset.n);
  await p.click('#wn-body [data-wn-make="carrot"]'); await p.waitForTimeout(600);
  const preSel = await p.evaluate(() => ({
    sel: (document.querySelector('#wn-cube-ings [aria-pressed="true"]') || {dataset:{}}).dataset.cubeIng,
    first: (document.querySelector('#wn-cube-ings [data-cube-ing]') || {dataset:{}}).dataset.cubeIng,
    n: document.getElementById('wn-cube-n').value }));
  check('만들 것에서 열면 그 재료가 골라져 맨 위에, 칸 수는 그 줄의 수', preSel, { sel:'carrot', first:'carrot', n: makeN });
  await p.click('#wn-cube-close'); await p.waitForTimeout(500);
  check('뒤로 가면 닫힌다', await p.evaluate(() => document.getElementById('fp-wncube').classList.contains('show')), false);
  await p.click('#wn-body [data-wn-cv="have"]'); await p.waitForTimeout(400);

  /* 죽 덩어리 이름 고치기도 같은 화면 */
  await mut('setWeanMixBatch', { key:'mix_test', n:2, perG:70, label:'소고기죽', parts:['beef'], madeOn: today, actor:'엄마' });
  await gotoCubes();
  await p.click('#wn-body [data-wn-mixname="mix_test"]'); await p.waitForTimeout(600);
  const mixOk = await p.evaluate(() => ({ show: document.getElementById('fp-wncube').classList.contains('show'),
      ing: document.getElementById('wn-cube-ingfield').hidden, name: document.getElementById('wn-cube-name').value }));
  check('죽 이름 고치기도 같은 전체 화면 — 재료 찾기 칸은 숨는다', mixOk, { show:true, ing:true, name:'소고기죽' });
  await p.click('#wn-cube-close'); await p.waitForTimeout(500);

  /* ── 3. 숫자 바로 고치기 ── */
  const sel = '#wn-body .cb-row b.cb-n[data-wn-cubeset="pumpkin"]';
  await p.click(sel); await p.waitForTimeout(200);
  const inEdit = await p.evaluate(() => { const i = document.querySelector('#wn-body input.cb-n-in');
    return i ? { v: i.value, focus: document.activeElement === i } : null; });
  check('숫자를 누르면 그 자리가 입력칸이 되고 바로 칠 수 있다', inEdit, { v:'7', focus:true });
  /* 고치는 동안 다른 쓰기의 답이 와서 다시 그려도 입력칸이 안 사라진다 */
  await mut('addWeanCubes', { ing:'onion', n:2, perG:10, madeOn: today, actor:'엄마' });
  /* 다른 폰의 쓰기는 다시 붙잡을 때(online/focus) 바로 당겨 온다 — 그걸로 다시 그리게 한다 */
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1500);
  const sawOnion = await p.evaluate(() => /양파/.test(document.getElementById('wn-body').textContent));
  check('...고치는 중에 다른 폰의 쓰기가 들어와 다시 그려도 입력칸이 남는다',
    await p.evaluate(() => !!document.querySelector('#wn-body input.cb-n-in')), true);
  await p.fill('#wn-body input.cb-n-in', '3'); await p.press('#wn-body input.cb-n-in', 'Enter');
  await p.waitForTimeout(150);
  check('엔터 — 화면이 곧바로 3', await p.evaluate((s) => document.querySelector(s).textContent, sel), '3');
  await p.waitForTimeout(1200);
  check('...서버도 3', await pile('pumpkin'), [pumpG + 'g×3']);
  const pr = (await st()).weanCubes.find(c => c.ing === 'pumpkin');
  check('...줄인 것은 쓴 것 — 만든 칸(7)은 그대로', pr.made, 7);

  await p.click(sel); await p.waitForTimeout(150);
  await p.fill('#wn-body input.cb-n-in', '9'); await p.press('#wn-body input.cb-n-in', 'Escape');
  await p.waitForTimeout(800);
  check('Esc 는 취소', [await p.evaluate((s) => document.querySelector(s).textContent, sel), await pile('pumpkin')],
    ['3', [pumpG + 'g×3']]);

  await p.click(sel); await p.waitForTimeout(150);
  await p.fill('#wn-body input.cb-n-in', '5');
  await p.click('#wn-body .t-caption'); await p.waitForTimeout(1200);
  check('바깥을 눌러도 확정 — 5', await pile('pumpkin'), [pumpG + 'g×5']);

  await p.click(sel); await p.waitForTimeout(150);
  await p.fill('#wn-body input.cb-n-in', '0'); await p.press('#wn-body input.cb-n-in', 'Enter');
  await p.waitForTimeout(1200);
  check('0 으로 고치면 그 줄이 빠진다', [await pile('pumpkin'),
    await p.evaluate(() => !!document.querySelector('#wn-body b.cb-n[data-wn-cubeset="pumpkin"]'))], [[], false]);

  /* −/+ 는 그대로 */
  await mut('addWeanCubes', { ing:'carrot', n:4, perG:10, madeOn: today, actor:'엄마' });
  await gotoCubes();
  await p.click('#wn-body button[data-wn-cube="carrot"][data-d="-1"]'); await p.waitForTimeout(1200);
  check('− + 단추는 예전 그대로', await pile('carrot'), ['10g×3']);

  check('화면 오류 없음', errs, []);
  await b.close();
  const f = R.filter(r => !r.ok).length;
  console.log('\n' + (R.length - f) + '/' + R.length + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
