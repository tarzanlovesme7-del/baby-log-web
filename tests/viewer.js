/* 사진 뷰어 — 전체 화면으로 한 장씩 본다.

   여기서 묻는 것:
     1) 화살표가 **사진 아래**에 있나(사진 위에 얹혀 한가운데를 가리고
        있었다 — 하필 손가락이 쓸고 지나가는 자리다),
     2) 좌우로 쓸면 넘어가나, 살짝 끈 것으로는 안 넘어가나,
     3) 위아래로 굴릴 것이 없나(탄성만 남아 있었다),
     4) 한 장뿐이면 화살표 줄이 아예 없나.
   2026-10-26. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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
}
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };

(async () => {
  for (const e of (await st()).entries || []) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  const iso = new Date().toISOString();
  await mut('addEntry', { type: 'play', start: iso, end: iso, note: '파란 책', author: '엄마' });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 2, hasTouch: true });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko');
  });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);

  /* 사진 석 장을 붙인다 */
  await p.click('.entry-row:has-text("놀이") .e-time'); await p.waitForTimeout(800);
  for (let i = 0; i < 3; i++) {
    await p.setInputFiles('#f-photo-input',
      { name: 'z' + i + '.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await p.waitForTimeout(1100);
  }
  await p.click('#fp-entry-save'); await p.waitForTimeout(1800);

  await p.click('.e-pic[data-epic="0"]'); await p.waitForTimeout(900);
  const count = () => p.evaluate(() => document.getElementById('fp-photo-count').textContent);
  check('첫 장부터 열린다', await count(), '1/3');

  /* ── 화살표는 사진 아래 ─────────────────────────────────── */
  check('화살표가 사진 위에 얹혀 있지 않다', await p.evaluate(() => {
    const st = document.getElementById('fp-photo-stage').getBoundingClientRect();
    return [...document.querySelectorAll('.photo-nav')]
      .every(n => n.getBoundingClientRect().top >= st.bottom - 0.5);
  }), true);
  check('...화살표 줄이 화면 바닥에 붙어 있다', await p.evaluate(() => {
    const f = document.getElementById('fp-photo-foot').getBoundingClientRect();
    return Math.round(window.innerHeight - f.bottom);
  }), 0);

  /* ── 좌우 스와이프 ──────────────────────────────────────── */
  const swipe = async (fx, tx, fy, ty) => {
    fy = fy || 420; ty = ty || fy;
    await p.mouse.move(fx, fy); await p.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await p.mouse.move(fx + (tx - fx) * i / 8, fy + (ty - fy) * i / 8);
    }
    await p.mouse.up(); await p.waitForTimeout(560);
  };
  /* 사진들은 **옆으로 나란히** 서 있다. 한 자리에서 src 만 갈아 끼우면
     다음 장이 받아지는 동안 한 프레임이 비어서 껌뻑인다(2026-10-26). */
  check('사진은 한 장씩 갈아 끼우지 않고 나란히 서 있다', await p.evaluate(() => [
    document.querySelectorAll('#fp-photo-track .photo-slide').length,
    !document.getElementById('fp-photo-img')]), [3, true]);
  await swipe(300, 90);
  check('왼쪽으로 쓸면 다음 장', await count(), '2/3');
  check('...띠가 그만큼 옆으로 갔다', await p.evaluate(() =>
    /calc\(-100%/.test(document.getElementById('fp-photo-track').style.transform)), true);
  await swipe(90, 300);
  check('오른쪽으로 쓸면 앞 장', await count(), '1/3');
  await swipe(200, 180);
  check('살짝 끈 것으로는 안 넘어간다', await count(), '1/3');
  /* 첫 장에서 더 오른쪽으로 쓸어도 마지막 장으로 되감지 않는다 */
  await swipe(90, 330);
  check('첫 장에서 더 쓸어도 제자리다', await count(), '1/3');
  await p.click('#fp-photo-next'); await p.waitForTimeout(400);
  check('화살표도 그대로 쓴다', await count(), '2/3');

  /* ── 위아래로는 아무 일도 없다 ──────────────────────────── */
  check('굴릴 것이 없다 (탄성만 남던 자리)', await p.evaluate(() => [
    document.documentElement.scrollHeight <= window.innerHeight,
    document.body.classList.contains('fp-nobounce'),
    getComputedStyle(document.getElementById('fp-photo')).position]),
    [true, true, 'fixed']);

  /* ── 아래로 끌어 내리면 닫힌다 ─────────────────────────── */
  await swipe(200, 200, 300, 330);
  check('조금 내린 것으로는 안 닫힌다', await p.evaluate(() =>
    document.getElementById('fp-photo').classList.contains('show')), true);
  check('...사진도 제자리로 돌아온다', await p.evaluate(() =>
    document.getElementById('fp-photo-stage').style.transform), '');
  await swipe(200, 200, 300, 520);
  check('아래로 쭉 내리면 닫힌다', await p.evaluate(() => [
    document.getElementById('fp-photo').classList.contains('show'),
    document.getElementById('fp-photo-stage').style.transform,
    document.getElementById('fp-photo').style.opacity]), [false, '', '']);

  /* 다시 열어서 닫기 단추도 확인 */
  await p.click('.e-pic[data-epic="0"]'); await p.waitForTimeout(900);
  await p.click('#fp-photo-back'); await p.waitForTimeout(800);
  check('닫으면 잠금이 풀린다', await p.evaluate(() => [
    document.body.classList.contains('fp-nobounce'),
    document.body.classList.contains('fp-open'),
    getComputedStyle(document.querySelector('header.top')).display]),
    [false, false, 'block']);

  /* ── 한 장뿐이면 ────────────────────────────────────────── */
  await p.click('.entry-row:has-text("놀이") .e-time'); await p.waitForTimeout(800);
  for (let i = 0; i < 2; i++) {
    await p.click('#f-pics [data-ent-drop]'); await p.waitForTimeout(400);
  }
  await p.click('#fp-entry-save'); await p.waitForTimeout(1800);
  await p.click('.e-pic[data-epic="0"]'); await p.waitForTimeout(900);
  check('한 장뿐이면 화살표 줄이 없다', await p.evaluate(() => [
    document.getElementById('fp-photo-foot').hidden,
    document.getElementById('fp-photo').classList.contains('has-nav'),
    document.getElementById('fp-photo-count').textContent]), [true, false, '']);
  check('...그만큼 사진이 바닥까지 쓴다', await p.evaluate(() =>
    Math.round(window.innerHeight -
      document.getElementById('fp-photo-stage').getBoundingClientRect().bottom)), 0);

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
