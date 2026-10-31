/* 내니가 둘이 된 뒤 (2026-10-27)

   11월 한 달은 업체를 통해 오신 분이 출근한다. 두 가지만 바뀌었다:
     1) 프로필이 '내니' 하나에서 '내니 Vi' · '내니 Linh' 둘로 갈라졌다.
        지난 두 달치 기록에는 그냥 '내니'라고 적혀 있는데, 그걸 전부
        고쳐 쓰지 않고 **같은 사람으로 읽기만** 한다(AUTHOR_ALIASES).
     2) 11/1~12/1 동안 '정산' 서브탭은 엄마 폰에서만 열린다. '출근 도장'은
        그대로 둔다 — 닫으면 본인이 출근을 찍을 길이 없다. */
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
}
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };

(async () => {
  for (const e of (await st()).entries || []) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  /* 9월에 적힌 기록처럼 — 그때는 이름이 그냥 '내니'였다 */
  const iso = new Date().toISOString();
  await mut('addEntry', { type: 'diaper', start: iso, end: iso, diaper: 'wet', author: '내니' });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errs = [];
  const open = async (who, when) => {
    const p = await b.newPage({ viewport: { width: 390, height: 900 } });
    p.on('pageerror', e => errs.push(String(e)));
    /* 11월로 시계를 옮겨 놓고 연다. 정산 가리기는 날짜가 조건이다. */
    if (when) await p.clock.install({ time: new Date(when) });
    await p.addInitScript(w => {
      localStorage.setItem('bbl_author', w); localStorage.setItem('bbl_lang', 'ko');
    }, who);
    await p.goto(BASE + '/'); await p.waitForTimeout(2200);
    return p;
  };

  /* ── 0. 11월 1일 전에는 아무것도 달라 보이지 않는다 ─────────
     오늘 올려도 10/31까지는 지금 화면 그대로여야 한다. 그래야 그 사이
     핫픽스를 자유롭게 올릴 수 있다(2026-10-27 "그 사이에 핫픽스 생김"). */
  let p = await open('엄마', '2026-10-29T09:00:00+07:00');
  check('갈라지기 전 — 지난 기록은 그냥 "내니"로 보인다', await p.evaluate(() => {
    const a = document.querySelector('.entry-row .e-author');
    return a ? a.textContent.trim() : null;
  }), '내니');
  await p.click('#btn-settings'); await p.waitForTimeout(700);
  await p.click('[data-set-go="who"]'); await p.waitForTimeout(700);
  check('갈라지기 전 — 칩은 셋, Linh는 없다', await p.evaluate(() =>
    [...document.querySelectorAll('#author-chip-row .chip')].map(c => c.textContent.trim())),
    ['엄마', '아빠', '내니']);
  await p.close();

  /* ── 1. 11월 1일부터 갈라진다 ──────────────────────────────── */
  p = await open('엄마', '2026-11-01T09:00:00+07:00');
  check('지난 기록의 "내니"가 "내니 Vi"로 보인다', await p.evaluate(() => {
    const a = document.querySelector('.entry-row .e-author');
    return a ? a.textContent.trim() : null;
  }), '내니 Vi');
  check('저장된 값은 그대로 "내니"다 (고쳐 쓰지 않았다)',
    ((await st()).entries[0] || {}).author, '내니');

  /* ── 2. 프로필이 넷 ─────────────────────────────────────── */
  await p.click('#btn-settings'); await p.waitForTimeout(700);
  await p.click('[data-set-go="who"]'); await p.waitForTimeout(700);
  check('프로필 칩이 넷이다', await p.evaluate(() =>
    [...document.querySelectorAll('#author-chip-row .chip')].map(c => c.textContent.trim())),
    ['엄마', '아빠', '내니 Vi', '내니 Linh']);
  await p.close();

  /* ── 3. 새 내니로 적으면 새 이름으로 저장된다 ─────────────── */
  p = await open('내니 Linh', '2026-11-01T09:00:00+07:00');
  /* 진짜 손가락으로 누른다 — 빠른기록 타일은 click 이 아니라 pointer 로 움직인다 */
  await p.locator('.qa-btn', { hasText: '기저귀' }).first().click();
  await p.waitForTimeout(1800);
  const authors = (await st()).entries.map(e => e.author);
  check('새 내니가 적은 기록은 "내니 Linh"로 저장된다',
    authors.indexOf('내니 Linh') >= 0, true);
  check('...Vi와 섞이지 않는다', authors.indexOf('내니 Vi') >= 0, false);
  check('...줄에도 그 이름으로 보인다', await p.evaluate(() =>
    [...document.querySelectorAll('.entry-row .e-author')].map(x => x.textContent.trim())
      .filter((v, i, a) => a.indexOf(v) === i).sort()), ['내니 Linh', '내니 Vi']);

  /* ── 4. 11월 · 내니 폰: 정산은 없고 도장은 있다 ───────────── */
  await p.close();
  p = await open('내니 Linh', '2026-11-15T09:00:00+07:00');
  await p.evaluate(() => document.querySelector('.tab-btn[data-tab="pay"]').click());
  await p.waitForTimeout(800);
  check('11월 내니 폰 — 정산 서브탭이 없다', await p.evaluate(() => {
    const s = document.querySelector('#pay-tabs [data-pv="settle"]');
    return [s.hidden, document.getElementById('pay-tabs').hidden];
  }), [true, true]);
  check('...출근 도장 화면은 그대로 열린다', await p.evaluate(() => [
    !document.querySelector('[data-pv-panel="stamp"]').hidden,
    document.querySelector('[data-pv-panel="settle"]').hidden]), [true, true]);
  check('...금액이 한 글자도 화면에 없다', await p.evaluate(() =>
    /₫/.test(document.getElementById('tab-pay').innerText)), false);
  await p.close();

  /* ── 5. 11월 · 엄마 폰: 둘 다 보인다 ──────────────────────── */
  p = await open('엄마', '2026-11-15T09:00:00+07:00');
  await p.evaluate(() => document.querySelector('.tab-btn[data-tab="pay"]').click());
  await p.waitForTimeout(800);
  check('11월 엄마 폰 — 정산 서브탭이 있다', await p.evaluate(() => [
    document.querySelector('#pay-tabs [data-pv="settle"]').hidden,
    document.getElementById('pay-tabs').hidden]), [false, false]);
  await p.evaluate(() => document.querySelector('#pay-tabs [data-pv="settle"]').click());
  await p.waitForTimeout(700);
  check('...눌러서 들어가진다', await p.evaluate(() =>
    !document.querySelector('[data-pv-panel="settle"]').hidden), true);
  await p.close();

  /* ── 6. 12월 1일 — Linh 마지막 근무일. 아직 다 그대로다 ───── */
  p = await open('내니 Vi', '2026-12-01T09:00:00+07:00');
  await p.evaluate(() => document.querySelector('.tab-btn[data-tab="pay"]').click());
  await p.waitForTimeout(800);
  check('12월 1일까지는 정산이 아직 가려져 있다', await p.evaluate(() =>
    document.querySelector('#pay-tabs [data-pv="settle"]').hidden), true);
  await p.evaluate(() => document.getElementById('btn-settings').click());
  await p.waitForTimeout(700);
  await p.click('[data-set-go="who"]'); await p.waitForTimeout(700);
  check('...Linh 칩도 아직 있다 (마지막 근무일)', await p.evaluate(() =>
    [...document.querySelectorAll('#author-chip-row .chip')].map(c => c.textContent.trim())),
    ['엄마', '아빠', '내니 Vi', '내니 Linh']);
  await p.close();

  /* ── 7. 12월 2일에 정산이 돌아온다 ────────────────────────── */
  p = await open('내니 Vi', '2026-12-02T09:00:00+07:00');
  await p.evaluate(() => document.querySelector('.tab-btn[data-tab="pay"]').click());
  await p.waitForTimeout(800);
  check('12월 2일부터 내니도 정산을 다시 본다', await p.evaluate(() =>
    document.querySelector('#pay-tabs [data-pv="settle"]').hidden), false);
  await p.close();

  /* ── 8. 12월부터 Linh 칩은 사라지고, 이름은 남는다 ─────────── */
  p = await open('엄마', '2026-12-02T09:00:00+07:00');
  await p.click('#btn-settings'); await p.waitForTimeout(700);
  await p.click('[data-set-go="who"]'); await p.waitForTimeout(700);
  check('12월 2일부터 Linh 칩은 사라진다', await p.evaluate(() =>
    [...document.querySelectorAll('#author-chip-row .chip')].map(c => c.textContent.trim())),
    ['엄마', '아빠', '내니 Vi']);
  await p.evaluate(() => document.querySelector('.tab-btn[data-tab="record"]').click());
  await p.waitForTimeout(800);
  check('...그래도 Linh가 적은 기록은 그 이름 그대로다', await p.evaluate(() =>
    [...document.querySelectorAll('.entry-row .e-author')].map(x => x.textContent.trim())
      .indexOf('내니 Linh') >= 0), true);
  await p.close();

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
