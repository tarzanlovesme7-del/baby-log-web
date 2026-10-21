/* 안 읽은 메모 배너는 **이 폰 + 이 사람**의 것인가.

   예전에는 폰 하나에 물 자국 하나였다. 엄마 폰에서 내니로 바꿔 보면 엄마가
   읽어 둔 자국을 물려받아 전부 읽은 것처럼 보였다(2026-10-20 "내가 내니로
   로그인하니까 읽은것처럼 보이길래"). 내니 폰이 멀쩡해 보였던 건 거기 자국이
   하나뿐이라서다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n +
    (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e)));
}
async function mut(type, payload) {
  const r = await fetch(BASE + '/api/mutate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });
  if (!r.ok) console.log('!! ' + type + ' ' + (await r.text()).slice(0, 140));
  return r;
}
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errs = [];
  for (const m of (await st()).memos || []) await mut('deleteMemo', { id: m.id, actor: '엄마' });

  /* 한 대의 폰(브라우저 프로필 하나)을 끝까지 쓴다 — 이게 이 시험의 전부다 */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const open = async (who) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(w => {
      localStorage.setItem('bbl_author', w); localStorage.setItem('bbl_lang', 'ko');
    }, who);
    await p.goto(BASE + '/'); await p.waitForTimeout(1800);
    return p;
  };
  const bannerUp = p => p.evaluate(() => !document.getElementById('memo-open-btn').hidden);

  /* 아빠가 메모를 하나 남긴다 — 엄마에게도 내니에게도 남의 글이다 */
  await mut('addMemo', { text: '분유 통 새로 땄어요', author: '아빠', lang: 'ko' });

  let p = await open('엄마');
  check('엄마 폰에 안 읽은 메모 배너가 뜬다', await bannerUp(p), true);
  /* 읽고 나온다 — 메모 탭에 들어갔다가 기록 탭으로 */
  await p.click('.tab-btn[data-tab="memo"]'); await p.waitForTimeout(1200);
  await p.click('.tab-btn[data-tab="record"]'); await p.waitForTimeout(700);
  check('...읽고 나오면 배너가 사라진다', await bannerUp(p), false);
  await p.close();

  /* 같은 폰에서 사람만 내니로 바꾼다 */
  p = await open('내니');
  check('같은 폰이라도 내니에게는 아직 안 읽은 메모다', await bannerUp(p), true);
  await p.click('.tab-btn[data-tab="memo"]'); await p.waitForTimeout(1200);
  await p.click('.tab-btn[data-tab="record"]'); await p.waitForTimeout(700);
  check('...내니가 읽으면 내니 쪽만 사라진다', await bannerUp(p), false);
  await p.close();

  /* 엄마 자국은 내니가 읽어도 그대로여야 한다 — 새 메모 하나로 확인 */
  await mut('addMemo', { text: '기저귀 두 봉지 샀어요', author: '아빠', lang: 'ko' });
  p = await open('엄마');
  check('새 메모는 둘 다에게 다시 뜬다', await bannerUp(p), true);
  check('...자국은 이름마다 따로 적힌다', await p.evaluate(() =>
    Object.keys(localStorage).filter(k => k.indexOf('bbl_memo_seen:') === 0).sort()),
    ['bbl_memo_seen:내니', 'bbl_memo_seen:엄마']);
  /* 자기가 쓴 글은 자기에게 안 읽음이 아니다 */
  await mut('addMemo', { text: '엄마가 쓴 메모', author: '엄마', lang: 'ko' });
  await p.click('.tab-btn[data-tab="memo"]'); await p.waitForTimeout(1200);
  await p.click('.tab-btn[data-tab="record"]'); await p.waitForTimeout(900);
  check('...자기가 쓴 메모로는 배너가 뜨지 않는다', await bannerUp(p), false);
  await p.close();

  check('콘솔 에러 없음', errs, []);
  await ctx.close();
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
})();
