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

  /* ── 화살표는 사진 아래쪽에 ─────────────────────────────
     2026-11-11부터 무대가 화면 전체라 화살표는 사진 **위에** 뜬다. 가리면
     안 되는 것은 사진 한가운데다 — 거기가 손가락이 쓸고 지나가는 자리라
     한 번 치웠었다(2026-10-26). 아래 4분의 1 안에 있어야 한다. */
  check('화살표는 화면 아래쪽에만 뜬다', await p.evaluate(() => {
    const vh = window.innerHeight;
    return [...document.querySelectorAll('.photo-nav')]
      .every(n => n.getBoundingClientRect().top >= vh * 0.75);
  }), true);
  check('...화살표 줄이 화면 바닥에 붙어 있다', await p.evaluate(() => {
    const f = document.getElementById('fp-photo-foot').getBoundingClientRect();
    return Math.round(window.innerHeight - f.bottom);
  }), 0);

  /* ── 사진은 화면 한가운데 선다 ──────────────────────────
     예전 무대는 '위는 머리 높이만큼, 아래는 화살표 줄만큼' 비운 자리였다.
     그런데 화살표 줄은 사진이 두 장 이상일 때만 생긴다 — 그래서 **한 장짜리
     기록에서만** 위만 비어 사진이 머리 절반(그녀 폰에서 61px)만큼 내려앉았다
     ("기록에 붙은 사진 누르면 가끔 이렇게 아래로 정렬될 때가 있어",
     2026-11-11). 이제 무대가 화면 전체라 줄이 있든 없든 자리가 같다. */
  const photoMid = () => p.evaluate(() => {
    const r = document.querySelector('#fp-photo-track img').getBoundingClientRect();
    return (r.top + r.bottom) / 2;
  });
  check('사진이 화면 한가운데 선다',
    Math.round(await photoMid() - (await p.evaluate(() => window.innerHeight / 2))), 0);
  check('...화살표 줄이 없어도 자리가 같다 (한 장짜리 기록)', await p.evaluate(() => {
    const img = document.querySelector('#fp-photo-track img');
    const mid = () => { const r = img.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const was = mid();
    const foot = document.getElementById('fp-photo-foot');
    foot.hidden = true;
    const now = mid();
    foot.hidden = false;
    return Math.round(now - was);
  }), 0);
  /* 머리가 사진 위에 떠 있어도 ‹ 는 눌린다 — 무대가 화면 전체를 덮으므로
     머리가 그 위에 서지 않으면 손가락이 무대에 먹힌다. */
  check('‹ 가 무대 위에 있다 (닫기가 눌린다)',
    await p.evaluate(() => (document.elementFromPoint(26, 30) || {}).id), 'fp-photo-back');

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
    document.getElementById('fp-photo-count').textContent]), [true, '']);
  check('...무대는 화면을 통째로 쓴다', await p.evaluate(() => {
    const r = document.getElementById('fp-photo-stage').getBoundingClientRect();
    return [Math.round(r.top), Math.round(window.innerHeight - r.bottom)];
  }), [0, 0]);
  /* 여기가 그녀가 본 그 화면이다 — 사진 한 장짜리 기록. 예전에는 여기서만
     사진이 아래로 쏠렸다(2026-11-11). */
  check('...사진 한 장짜리도 화면 한가운데 선다', await p.evaluate(() => {
    const r = document.querySelector('#fp-photo-track img').getBoundingClientRect();
    return Math.round(((r.top + r.bottom) / 2) - window.innerHeight / 2);
  }), 0);

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
