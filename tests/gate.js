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
     - /healthz 는 열려 있다. 렌더가 서비스가 살아 있는지 묻는 길이다.
     - **이미 켜 둔 폰은 쫓아낸다.** 비번을 켜도 그 폰은 화면에 기록과
       사진을 그대로 띄우고 있었다("우리애기 얼굴 사진 남아있을텐데
       강제로 튕겨줘야지"). 폴링이 401을 보는 순간 화면을 비운다. */
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

  /* ── 3. 켜 둔 폰을 쫓아낸다 ──
     비번을 켜기 전부터 열려 있던 화면. 서버만 막아서는 안 되고, 그려 둔
     기록과 사진이 화면에서 사라져야 한다. */
  const ctx3 = await b.newContext({ viewport:{ width:390, height:860 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errs.push('kick: ' + String(e)));
  await p3.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마');
    localStorage.setItem('bbl_lang','ko'); });
  /* 먼저 제대로 들어가서 화면을 띄운다 */
  await ctx3.addCookies([{ name:'zio_gate', value: ck.split('=')[1],
    domain:'localhost', path:'/' }]);
  await p3.goto(BASE + '/'); await p3.waitForTimeout(2400);
  check('켜 둔 폰은 화면이 그려져 있다', await p3.evaluate(()=>
    !!document.getElementById('qa-grid') && document.getElementById('gate').hidden), true);

  /* 비번이 켜진 것과 같은 상황 — 그 폰의 표식을 빼앗는다 */
  await ctx3.clearCookies();
  let kicked = true;
  try {
    await p3.waitForFunction(() => {
      const g = document.getElementById('gate'), a = document.getElementById('app');
      return !!(g && !g.hidden) && !!a && a.children.length === 0;
    }, null, { timeout: 40000 });   /* 폴링은 25초마다 — 그 한 바퀴를 기다린다 */
  } catch (e) { kicked = false; }
  check('표식이 없어지면 스스로 쫓겨난다 (폴링이 알아챈다)', kicked, true);
  check('...화면에 기록이 한 줄도 안 남는다', await p3.evaluate(()=>
    document.querySelectorAll('.entry-row').length), 0);
  check('...사진 태그도 안 남는다', await p3.evaluate(()=>
    document.querySelectorAll('img[src*="/api/photo/"]').length), 0);
  check('...손에 쥔 문서도 버린다', await p3.evaluate(()=>
    document.getElementById('app').innerHTML.trim()), '');
  await p3.close();

  /* 폰을 주머니에서 꺼내는 순간(= 다시 보이게 되는 순간)에도 바로 묻는다 */
  const ctx4 = await b.newContext({ viewport:{ width:390, height:860 } });
  const p4 = await ctx4.newPage();
  await p4.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마');
    localStorage.setItem('bbl_lang','ko'); });
  await ctx4.addCookies([{ name:'zio_gate', value: ck.split('=')[1],
    domain:'localhost', path:'/' }]);
  await p4.goto(BASE + '/'); await p4.waitForTimeout(2400);
  await ctx4.clearCookies();
  await p4.evaluate(()=> window.dispatchEvent(new Event('focus')));
  let kicked2 = true;
  try {
    await p4.waitForFunction(() => {
      const g = document.getElementById('gate');
      return !!(g && !g.hidden);
    }, null, { timeout: 8000 });
  } catch (e) { kicked2 = false; }
  check('폰을 다시 들여다보면 그 자리에서 쫓겨난다', kicked2, true);
  await p4.close();

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
