/* 재고 '있는 것' 화면 — 급한 순 · 남은 기한 칩 · 칸 막대.

   "이유식 재고 이런식으로 보여주는거 좋은듯 디벨롭해봐 참고해서" (2026-11-03)
   "몇개 만들었는데 몇개 썼고 몇개 남았는지가 보여야지"

   그래서 못 박는 것:
     - 줄의 순서는 재료별 칸 수가 아니라 남은 기한이 적은 순이다. 재고를
       보는 이유는 '뭐가 많나'가 아니라 '뭘 먼저 써야 하나'다.
     - 덩어리마다 남은 기한이 D-N 으로 선다. 2주를 넘기면 D+N, 사흘 이하면
       임박 색. 만든 날이 없는 덩어리에는 칩을 달지 않는다.
     - 칸 막대는 **만든 만큼** 길고, 그 중 쓴 칸은 회색이다. 남은 칸만
       그으면 열 칸 중 아홉을 쓴 줄과 한 칸만 만든 줄이 똑같이 보인다.
     - 만든/쓴/남은을 글로 한 번 더 적지는 않는다 — 줄이 복잡해진다
       ("이거 텍스트는 필요없어 복잡해보여"). 막대가 셋을 다 말한다.
     - 거르는 알약은 두지 않는다 — 줄마다 D-N 칩이 붙고 급한 것이 맨 위에
       모이므로 걸러 볼 일이 없다("밑에 디데이 보여주잖아").
     - 옛 덩어리(made 없음)는 남은 칸을 만든 칸으로 친다 = 쓴 것 0칸. */
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
  const d = j.data || j; d.weanCubes = d.weanCubes || [];
  d.entries = d.entries || []; return d; };
const p2 = (x) => (x < 10 ? '0' : '') + x;
const dstr = (d) => d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate());
const today = dstr(new Date());
const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d); };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const ctx = await b.newContext({ viewport:{ width:390, height:1200 }, timezoneId:'Asia/Ho_Chi_Minh' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko');
  });

  /* ── 깨끗한 냉동실 ── */
  for (const c of (await st()).weanCubes) await mut('setWeanCube', { ing: c.ing, n: 0, actor: '엄마' });
  check('냉동실이 비었다', (await st()).weanCubes.length, 0);

  /* 세 덩어리 — 지난 것 / 임박한 것 / 넉넉한 것.
     넉넉한 쪽에 칸을 가장 많이 둔다. 칸 수로 정렬하면 이게 맨 위로 온다. */
  await mut('addWeanCubes', { ing:'beef',     n:3,  madeOn: dAgo(20), perG:10, actor:'엄마' });
  await mut('addWeanCubes', { ing:'apple',    n:4,  madeOn: dAgo(12), perG:20, actor:'엄마' });
  await mut('addWeanCubes', { ing:'zucchini', n:12, madeOn: today,    perG:10, actor:'엄마' });

  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(900);

  const rows = () => p.evaluate(()=>[...document.querySelectorAll('#wn-body .cb-row')].map(r=>({
    name: r.querySelector('.cb-head b').textContent.trim(),
    chip: (r.querySelector('.cb-d')||{textContent:''}).textContent.trim(),
    cls:  (r.querySelector('.cb-d')||{className:''}).className.replace('cb-d','').trim(),
    sub:  r.querySelector('.cb-sub').textContent.trim(),
    on:   r.querySelectorAll('.cb-bar i:not(.gone)').length,
    gone: r.querySelectorAll('.cb-bar i.gone').length,
    more: (r.querySelector('.cb-bar em')||{textContent:''}).textContent.trim(),
    n:    r.querySelector('.wn-step b').textContent.trim(),
  })));

  let rs = await rows();
  check('덩어리마다 한 줄이 선다', rs.length, 3);
  check('급한 순으로 선다 — 칸 수가 아니라 남은 기한',
    rs.map(r=>r.name), ['소고기', '사과', '애호박']);
  check('남은 기한이 칩으로 선다', rs.map(r=>r.chip), ['D+6', 'D-2', 'D-14']);
  check('...지난 것과 임박한 것에 색이 붙는다', rs.map(r=>r.cls), ['over', 'soon', '']);
  /* 날짜와 g 만 — '만든 것'·'한 칸' 같은 말은 줄마다 같은 말이라 뺐다 */
  check('줄마다 만든 날과 한 칸 용량이 날짜·g 로만 적힌다',
    rs.map(r=>/^\d\d\/\d\d · \d+g$/.test(r.sub)), [true, true, true]);
  check('칸 막대는 남은 칸만큼 긋는다', rs.map(r=>r.on), [3, 4, 12]);
  check('스테퍼에는 남은 칸이 적힌다', rs.map(r=>r.n), ['3', '4', '12']);

  /* ── 만든 / 쓴 / 남은 ── */
  check('아직 쓴 칸이 없으면 막대에 회색이 없다', rs.map(r=>r.gone), [0, 0, 0]);
  check('...만든/쓴/남은을 글로 또 적지는 않는다',
    await p.evaluate(()=>document.querySelectorAll('#wn-body .cb-cnt').length), 0);

  /* 애호박 한 줄의 − 를 세 번 — '썼다'다. 만든 수는 그대로여야 한다. */
  const zuc = p.locator('#wn-body .cb-row', { hasText: '애호박' });
  for (let i = 0; i < 3; i++){ await zuc.locator('[data-d="-1"]').click(); await p.waitForTimeout(900); }
  await p.waitForTimeout(600);
  rs = await rows();
  const z = rs.filter(r=>r.name==='애호박')[0];
  check('− 를 누르면 쓴 칸이 회색으로 남는다 (만든 12 · 쓴 3 · 남은 9)',
    [z.on, z.gone, z.more, z.n], [9, 3, '', '9']);
  check('...만든 수는 그대로다',
    ((await st()).weanCubes.filter(c=>c.ing==='zucchini')[0]||{}).made, 12);

  /* + 는 '더 만들었다' — 만든 수도 같이 오른다 */
  await zuc.locator('[data-d="1"]').click(); await p.waitForTimeout(1100);
  rs = await rows();
  const z2 = rs.filter(r=>r.name==='애호박')[0];
  check('+ 를 누르면 만든 수도 같이 오른다 (만든 13 · 쓴 3 · 남은 10)',
    [z2.on, z2.gone, z2.n], [10, 3, '10']);
  check('...서버에도 만든 수가 오른다',
    ((await st()).weanCubes.filter(c=>c.ing==='zucchini')[0]||{}).made, 13);

  /* 먹인 기록으로 빠진 칸도 '쓴 것'이다 */
  await mut('addEntry', { type:'wean', start: new Date().toISOString(), author:'엄마',
    ings:[{ ing:'apple', g:20 }] });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);
  rs = await rows();
  const ap = rs.filter(r=>r.name==='사과')[0];
  check('이유식을 기록해서 빠진 칸도 쓴 것으로 센다 (만든 4 · 쓴 1 · 남은 3)',
    [ap.on, ap.gone, ap.n], [3, 1, '3']);

  check('거르는 알약은 두지 않는다',
    await p.evaluate(()=>document.querySelectorAll('#wn-body [data-wn-sf]').length), 0);
  check('...덩어리는 늘 다 보인다', (await rows()).length, 3);

  /* ── 아주 큰 덩어리 ── */
  /* 열여섯 칸까지는 한 칸 한 대시로 센다. 넘치면 +N 으로 접는다 —
     열일곱 번째부터는 세는 눈이 아니라 '많다'는 느낌만 남는다. */
  await mut('addWeanCubes', { ing:'potato', n:20, perG:10, madeOn: today, actor:'엄마' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);
  const pot = (await rows()).filter(r=>r.name==='감자')[0];
  check('열여섯 칸을 넘으면 +N 으로 접는다', [pot.on, pot.gone, pot.more, pot.n],
    [16, 0, '+4', '20']);

  /* 지난 덩어리를 다 쓰면 줄째로 사라진다 */
  const beef = p.locator('#wn-body .cb-row', { hasText: '소고기' });
  for (let i = 0; i < 3; i++){ await beef.locator('[data-d="-1"]').click(); await p.waitForTimeout(900); }
  await p.waitForTimeout(700);
  check('덩어리를 다 쓰면 줄이 사라진다',
    (await rows()).map(r=>r.name), ['사과', '감자', '애호박']);

  /* ── 기록을 지우면 쓴 칸도 돌아온다 ── */
  /* 쓴 칸 = 만든 칸 − 남은 칸이다. 기록을 지워 남은 칸이 돌아오면 쓴 칸이
     저절로 0으로 돌아가야 한다 — 음수가 되거나 1칸 쓴 채로 남으면 안 된다. */
  const ae = ((await st()).entries || []).filter(e=>e.type==='wean');
  for (const e of ae) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);
  rs = await rows();
  const ap2 = rs.filter(r=>r.name==='사과')[0];
  check('기록을 지우면 쓴 칸(회색)도 함께 돌아온다', [ap2.on, ap2.gone, ap2.n], [4, 0, '4']);

  /* ── 베트남어 ── */
  /* 재고는 이모가 매일 여는 화면이다 — 새로 붙인 말이 한글로 남으면 안 된다 */
  const pv = await ctx.newPage();
  pv.on('pageerror', e => errs.push('vi: ' + String(e)));
  await pv.addInitScript(() => {
    localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'vi');
  });
  await pv.goto(BASE + '/'); await pv.waitForTimeout(2200);
  await pv.click('#btn-settings'); await pv.waitForTimeout(600);
  await pv.click('#set-wean'); await pv.waitForTimeout(700);
  await pv.click('#wn-tabs button[data-wn="cubes"]'); await pv.waitForTimeout(900);
  check('베트남어에도 줄이 한글 없이 뜬다', await pv.evaluate(()=>{
    const names = [...document.querySelectorAll('#wn-body .cb-head b')].map(e=>e.textContent.trim());
    const sub = (document.querySelector('#wn-body .cb-sub')||{textContent:''}).textContent;
    return [names.length > 0, /[가-힣]/.test(names.join('')),
            /^\d\d\/\d\d · \d+g$/.test(sub.trim())];
  }), [true, false, true]);

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
