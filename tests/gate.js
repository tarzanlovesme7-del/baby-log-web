/* 집 비번 — 주소를 알아도 못 들어온다.

   "이 미친 내니년 못 들어오게 하고싶은데" (2026-11-08)

   이 앱에는 로그인이 없어서 주소를 아는 사람이 곧 보는 사람이었다. 주소를
   바꾸는 건 자물쇠가 아니라 숨기기고, 렌더는 주소를 바꿔 주지도 않는다.
   그래서 서버에 비번 하나를 둔다. 못 박는 것:
     - 서버가 막는다. 화면만 가리면 /api/state 를 직접 쳐서 다 가져간다.
     - 폰마다 **한 번만** 묻는다("하루에도 수십번 입력하는데?") — 쿠키.
     - 틀리면 안 들어가고, 안 알려 준다.
     - ZIO_PASSCODE 가 비어 있으면 잠그지 않는다 — 키를 넣기 전에 앱이
       통째로 죽으면 고칠 길까지 막힌다.
     - /healthz 는 열려 있다. 렌더가 서비스가 살아 있는지 묻는 길이다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const PASS = process.env.ZIO_PASSCODE || '';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }

(async () => {
  if (!PASS){ console.log('SKIP  ZIO_PASSCODE 를 주고 돌려야 하는 스위트'); process.exit(0); }

  /* ── 1. 서버가 막는가 (브라우저 없이) ── */
  const bare = async (path, opts) => {
    const r = await fetch(BASE + path, opts || {});
    return { s: r.status, j: await r.json().catch(()=>({})), set: r.headers.get('set-cookie') || '' };
  };
  check('비번 없이 /api/state 를 치면 막힌다', (await bare('/api/state')).s, 401);
  check('...mutate 도 막힌다', (await bare('/api/mutate', { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ type:'addEntry', payload:{ type:'bath',
      start:new Date().toISOString(), author:'엄마' } }) })).s, 401);
  check('...사진도 막힌다', (await bare('/api/photo/p_' + 'a'.repeat(24))).s, 401);
  check('...버전도 막힌다', (await bare('/api/version')).s, 401);

  const health = await fetch(BASE + '/healthz');
  check('/healthz 는 열려 있다 (렌더가 쓰는 길)', health.status, 200);

  const wrong = await bare('/api/gate', { method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pass: PASS + 'x' }) });
  check('틀린 비번은 거절한다', [wrong.s, wrong.set], [401, '']);

  const right = await bare('/api/gate', { method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pass: PASS }) });
  check('맞는 비번은 표식을 내준다', [right.s, /zio_gate=/.test(right.set)], [200, true]);
  check('...표식은 비번 그대로가 아니다 (해시)',
    right.set.indexOf(PASS) >= 0, false);
  check('...표식은 오래 간다 (폰마다 한 번만)',
    /Max-Age=3153\d+/.test(right.set), true);
  check('...자바스크립트가 못 읽는다', /HttpOnly/i.test(right.set), true);

  const ck = right.set.split(';')[0];
  check('표식을 들고 가면 열린다',
    (await bare('/api/state', { headers:{ cookie: ck } })).s, 200);
  check('엉뚱한 표식은 안 열린다',
    (await bare('/api/state', { headers:{ cookie: 'zio_gate=' + 'f'.repeat(32) } })).s, 401);

  /* ── 2. 폰에서 ── */
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const ctx = await b.newContext({ viewport:{ width:390, height:860 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마');
    localStorage.setItem('bbl_lang','ko'); });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);

  check('처음 열면 비번 화면이 선다', await p.evaluate(()=>{
    const g = document.getElementById('gate');
    return !!(g && !g.hidden); }), true);
  check('...앱은 보이지 않는다', await p.evaluate(()=>{
    const a = document.getElementById('app');
    return a ? getComputedStyle(a).display : null; }), 'none');
  check('...기록이 한 줄도 화면에 없다', await p.evaluate(()=>
    document.querySelectorAll('.entry-row').length), 0);

  /* 틀린 비번 */
  await p.fill('#gate-pass', PASS + 'x');
  await p.click('#gate-go'); await p.waitForTimeout(1200);
  check('틀리면 안 열리고 틀렸다고 한다', await p.evaluate(()=>{
    const g = document.getElementById('gate'), e = document.getElementById('gate-err');
    return [!!(g && !g.hidden), !!(e && !e.hidden)]; }), [true, true]);

  /* 맞는 비번 — 통과하면 페이지를 새로 읽으므로 그게 끝나기를 기다린다 */
  await p.fill('#gate-pass', PASS);
  await p.click('#gate-go');
  let opened = true;
  try {
    await p.waitForFunction(() => {
      const g = document.getElementById('gate');
      return !!(g && g.hidden) && !document.body.classList.contains('gated')
        && !document.body.classList.contains('booting');
    }, null, { timeout: 15000 });
  } catch (e) { opened = false; }
  check('맞으면 앱이 열린다', opened, true);
  check('...기록 화면이 그려진다', await p.evaluate(()=>
    !!document.getElementById('qa-grid')), true);

  /* 다시 열어도 안 묻는다 — 같은 폰(같은 쿠키) */
  await p.goto(BASE + '/'); await p.waitForTimeout(2400);
  check('같은 폰은 다시 열어도 안 묻는다', await p.evaluate(()=>{
    const g = document.getElementById('gate');
    return !!(g && g.hidden); }), true);
  await p.close();

  /* 다른 폰(쿠키 없음)은 그대로 잠겨 있다 */
  const ctx2 = await b.newContext({ viewport:{ width:390, height:860 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/'); await p2.waitForTimeout(2200);
  check('다른 폰은 그대로 잠겨 있다', await p2.evaluate(()=>{
    const g = document.getElementById('gate');
    return !!(g && !g.hidden); }), true);
  await p2.close();

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
