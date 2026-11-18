/* 빠른 기록을 연달아 찍기 + 이유식 저장 알림 — 느린 서버에서.
   "지오 로그 전체적으로 씹히는 현상이 있어 특히 분유랑 투약 한번에 찍을 때"
   "이유식 관련해서 뭐 바꾸면 저장됐는지 알수가 없어" (2026-11-18)

   씹히던 길 두 개를 따로 잡는다:
     1) 앞 기록의 답이 오는 순간 서버 문서로 갈아끼우면서, 아직 줄에 선 뒤
        기록이 화면에서 사라졌다 → overlayPending 이 /reducer.js 로 다시 얹는다
     2) 답이 올 때마다 빠른 기록 칸을 통째로 새로 그려서, 누르고 있던 칸이
        손가락 밑에서 바뀌었다(누른 칸 ≠ 뗀 칸 → 기록 안 됨)
   돌리기: bash tests/run.sh quicktap 1500   (지연 없이 돌리면 '저장 중…' 검사는 당연히 틀린다 —
   빠른 서버는 0.7초 안에 답한다) */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json();
  const d = j.data || j; d.entries = d.entries || []; d.weanCubes = d.weanCubes || []; return d; };
const drained = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('bbl_outbox') || '[]').length === 0);
async function waitDrain(p){ for (let i = 0; i < 60; i++){ if (await drained(p)) return true; await p.waitForTimeout(250); } return false; }

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const ctx = await b.newContext({ viewport:{ width:390, height:1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko'); });
  const before = (await st()).entries.length;
  await p.goto(BASE + '/'); await p.waitForTimeout(2500);
  check('reducer 를 받았다', await p.evaluate(() => !!(window.zioReducer && window.zioReducer.applyMutation)), true);

  const rows = () => p.locator('#timeline .entry-row').count();
  const tile = (t) => p.locator('.qa-btn[data-type="' + t + '"]');
  const r0 = await rows();

  /* ── 1) 분유 → 0.2초 뒤 투약. 분유의 답(1.5초)이 온 뒤에도 투약 줄이 남아 있나 ── */
  await tile('feed').click(); await p.waitForTimeout(200);
  await tile('med').click(); await p.waitForTimeout(100);
  check('찍자마자 두 줄', await rows(), r0 + 2);
  await p.waitForTimeout(1700);   /* 분유 답 도착, 투약은 아직 가는 중 */
  check('분유 답이 온 뒤에도 투약 줄이 남아 있다', await rows(), r0 + 2);
  check('...그 사이 투약은 아직 서버에 없다', (await st()).entries.filter(e => e.type === 'med').length, 0);
  await waitDrain(p); await p.waitForTimeout(500);
  const s1 = await st();
  check('서버에 분유 1 · 투약 1', [s1.entries.filter(e => e.type === 'feed').length,
    s1.entries.filter(e => e.type === 'med').length], [1, 1]);
  check('화면도 두 줄 그대로', await rows(), r0 + 2);

  /* ── 2) 칸을 누르고 있는 사이 앞 기록의 답이 온다 ──
     분유를 찍고 1.35초 뒤 투약 칸에 손가락을 대고, 답(1.5초)이 온 뒤 뗀다.
     누른 칸과 뗀 칸이 같은 칸이어야 기록된다. */
  await tile('med').evaluate(el => { el.__mark = 1; });
  await tile('feed').click();
  await p.waitForTimeout(1100);
  /* 투약 칸은 줄 끝에 있다 — 폰에서처럼 옆으로 밀어 보이게 한 뒤 누른다 */
  await tile('med').scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  const box = await tile('med').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(300);    /* 이 사이에 분유의 답이 도착한다 */
  check('누르는 동안 투약 칸이 바뀌지 않았다', await tile('med').evaluate(el => el.__mark === 1), true);
  await p.mouse.up();
  await p.waitForTimeout(150);
  check('손을 떼면 투약이 기록된다', await rows(), r0 + 4);
  await waitDrain(p); await p.waitForTimeout(500);
  const s2 = await st();
  check('서버: 분유 2 · 투약 2', [s2.entries.filter(e => e.type === 'feed').length,
    s2.entries.filter(e => e.type === 'med').length], [2, 2]);
  check('서버 기록 수 = 시작 + 4', s2.entries.length, before + 4);

  /* ── 3) 세 번 연달아 — 임시 id 가 진짜 id 로 바뀌고 중복 없이 ── */
  for (const t of ['diaper', 'feed', 'med']){ await tile(t).click(); await p.waitForTimeout(120); }
  check('세 줄이 바로 뜬다', await rows(), r0 + 7);
  await p.waitForTimeout(1800);
  check('첫 답 뒤에도 세 줄 그대로(사라지거나 두 번 뜨지 않는다)', await rows(), r0 + 7);
  await waitDrain(p); await p.waitForTimeout(600);
  check('다 끝나면 임시 id 가 남지 않는다', await p.evaluate(() =>
    [...document.querySelectorAll('#timeline .entry-row')].filter(r => /^tmp_/.test(r.dataset.id)).length), 0);
  check('서버 기록 수 = 시작 + 7', (await st()).entries.length, before + 7);

  /* ── 4) 이유식: 저장 중 → 저장했어요 ── */
  await mut('addWeanCubes', { ing:'potato', n:5, madeOn:'2026-11-17', perG:10, actor:'엄마' });
  await p.reload(); await p.waitForTimeout(2500);
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(800);
  await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(900);
  const toastNow = () => p.evaluate(() => { const e = document.getElementById('toast');
    return e.classList.contains('show') ? e.textContent : ''; });
  await p.locator('.cb-row').first().locator('[data-d="-1"]').click();
  await p.waitForTimeout(150);
  check('누른 순간엔 아직 저장했다고 안 한다', await toastNow(), '');
  await p.waitForTimeout(800);
  check('답이 늦으면 \'저장 중…\'', await toastNow(), '저장 중…');
  check('...이유식 화면 위에 보인다', await p.evaluate(() => {
    /* 토스트는 pointer-events:none 이라 그대로는 elementFromPoint 에 안 잡힌다 */
    const e = document.getElementById('toast'), r = e.getBoundingClientRect();
    e.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    e.style.pointerEvents = '';
    return !!hit && (hit === e || e.contains(hit)); }), true);
  await waitDrain(p); await p.waitForTimeout(100);
  check('답이 오면 \'저장했어요\'', await toastNow(), '저장했어요');
  /* 연달아 세 번: 중간 답마다 띄우지 않고 마지막에 한 번 */
  const seen = new Set();
  const minus = p.locator('.cb-row').first().locator('[data-d="-1"]');
  await p.waitForTimeout(1800);
  for (let i = 0; i < 2; i++){ await minus.click(); await p.waitForTimeout(100); }
  for (let i = 0; i < 150; i++){ seen.add(await toastNow()); if (await drained(p)) break; await p.waitForTimeout(100); }
  await p.waitForTimeout(100); seen.add(await toastNow());
  check('연달아 눌러도 마지막에 저장했어요', await toastNow(), '저장했어요');
  check('서버: 감자 2개 남음', (await st()).weanCubes.filter(c => c.ing === 'potato').map(c => c.n), [2]);
  /* 베트남어 */
  const src = await (await fetch(BASE + '/')).text();
  check('베트남어 문구', ['savingToast:"Đang lưu…"', 'savedToast:"Đã lưu"'].map(x => src.includes(x)), [true, true]);

  /* ── 5) reducer 를 못 받는 옛 서버에서도 앱은 돈다 ── */
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2 ' + String(e)));
  await p2.route('**/reducer.js', r => r.fulfill({ status: 404, body: 'not found' }));
  await p2.goto(BASE + '/'); await p2.waitForTimeout(2500);
  check('reducer 없음', await p2.evaluate(() => !window.zioReducer), true);
  const n2 = await p2.locator('#timeline .entry-row').count();
  await p2.locator('.qa-btn[data-type="feed"]').click(); await p2.waitForTimeout(200);
  check('...그래도 찍힌다', await p2.locator('#timeline .entry-row').count(), n2 + 1);
  await waitDrain(p2);

  check('오류 없음', errs, []);
  const f = R.filter(r => !r.ok).length;
  console.log('\n' + (R.length - f) + '/' + R.length + ' passed');
  await b.close();
})();
