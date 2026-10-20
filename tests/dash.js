/* 첫 화면 — 오늘 이유식 띠 + 세 칸(다음 수유 · 마지막 잠 · 마지막 똥).

   이 화면은 1초에 한 번 다시 그려지고, 집 안의 세 사람이 하루에 수십 번
   들여다보는 유일한 요약이다. 그래서 묻는 것은 "그려지는가"가 아니라
   "값이 맞는가"와 "칸을 넘지 않는가" 둘이다. 390px 폰에서 한 칸은 안쪽
   118px뿐이라, 글자가 길어지면 옆 칸을 밟는다. */
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
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const D = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => (x < 10 ? '0' : '') + x;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errs = [];

  /* 깨끗한 바닥에서 시작한다 — 남의 기록이 섞이면 "2시간 전"이 누구의
     2시간인지 알 수 없다 */
  for (const e of (await st()).entries || []) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  for (const k of Object.keys((await st()).weanPlan || {})) await mut('deleteWeanDay', { date: k, actor: '엄마' });
  /* 재료 사전이 비어 있으면 띠에 id가 그대로 찍힌다. 실제 앱은 첫 실행 때
     씨앗을 심어 두므로, 테스트도 같은 조건에서 본다. */
  for (const [id, ko] of Object.entries({"pgyo": "쌀오트밀죽", "pgl": "현미죽", "beef": "소고기", "zucchini": "애호박", "chicken": "닭고기", "broccoli": "브로콜리", "egg": "달걀", "carrot": "당근"})) await mut('setWeanIng', { actor: '엄마', id, ko });

  const open = async () => {
    const p = await b.newPage({ viewport: { width: 390, height: 900 } });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errs.push('console: ' + m.text()); });
    await p.addInitScript(() => {
      localStorage.setItem('bbl_author', '엄마');
      localStorage.setItem('bbl_lang', 'ko');
    });
    await p.goto(BASE + '/');
    await p.waitForTimeout(2600);
    return p;
  };
  const cell = (p, k) => p.evaluate(key => {
    const el = document.querySelector('#dash4 [data-d4="' + key + '"]');
    if (!el) return null;
    const pick = s => { const x = el.querySelector(s); return x ? x.textContent.trim() : ''; };
    return { lab: pick('.d4-lab'), big: pick('.d4-big'), sub: pick('.d4-sub'),
             urgent: el.classList.contains('urgent') };
  }, k);
  const band = p => p.evaluate(() => {
    const el = document.getElementById('wean-row');
    if (!el) return null;
    return {
      hidden: el.hidden,
      meals: [...el.querySelectorAll('.wn-meal')].map(x => x.textContent.trim()),
      rows: el.querySelectorAll('.wn-mrow').length,
      icons: el.querySelectorAll('.wn-it').length,
      rowIcons: [...el.querySelectorAll('.wn-mrow')].map(r => r.querySelectorAll('.wn-it').length),
      emoji: !document.getElementById('wn-emoji').hidden,
      title: !document.getElementById('wn-dn-line').hidden,
      dn: (document.getElementById('wn-dn').textContent || '').trim(),
      news: el.querySelectorAll('.wn-new').length,
      firstIsNew: !!(el.querySelector('.wn-it') && el.querySelector('.wn-it .wn-new')),
      more: ((el.querySelector('.wn-soon') || {}).textContent || '').trim(),
      files: [...el.querySelectorAll('img.wi')].map(i =>
        i.getAttribute('src').replace('icons/', '').replace('.svg', '')).sort(),
    };
  });

  // ═══ 1. 칸 셋 ═══
  let p = await open();
  check('칸이 셋이다', await p.evaluate(() => document.querySelectorAll('#dash4 .d4').length), 3);
  check('순서는 수유 · 잠 · 똥',
    await p.evaluate(() => [...document.querySelectorAll('#dash4 .d4')].map(e => e.dataset.d4)),
    ['feed', 'sleep', 'poop']);
  check('라벨이 "다음/마지막"으로 방향을 말한다',
    await p.evaluate(() => [...document.querySelectorAll('#dash4 .d4-lab')]
      .map(e => e.textContent.replace(/[^가-힣 ]/g, '').trim())),
    ['다음 수유', '마지막 잠', '마지막 똥']);
  check('기록이 없으면 잠은 줄표', (await cell(p, 'sleep')).big, '—');
  check('기록이 없으면 똥도 줄표', (await cell(p, 'poop')).big, '—');
  await p.close();

  // ═══ 2. 잠 — 큰 글씨는 깬 뒤로, 작은 글씨는 얼마나 잤나 ═══
  await mut('addEntry', { type: 'sleep', start: iso(60), end: iso(7), by: '내니' });
  p = await open();
  let c = await cell(p, 'sleep');
  check('마지막 잠이 끝난 뒤로 센다', c.big, '7분 전');
  check('...작은 글씨는 그 잠의 길이', c.sub, '53분 잤음');
  /* 두 줄로 접히면 그 칸만 높아져서 세 칸의 밑선이 어긋난다 */
  check('...작은 글씨는 한 줄에 들어간다',
    await p.evaluate(() => [...document.querySelectorAll('#dash4 .d4-sub')]
      .map(e => Math.round(e.getBoundingClientRect().height))
      .filter(h => h > 26)), []);
  await p.close();

  /* 진행 중인 잠 = end가 start와 같은 기록 */
  const t0 = iso(32);
  await mut('addEntry', { type: 'sleep', start: t0, end: t0, by: '내니' });
  p = await open();
  c = await cell(p, 'sleep');
  check('자고 있으면 잠든 뒤로 센다', c.big, '32분째');
  check('...작은 글씨는 자는 중', c.sub, '자는 중');
  await p.close();
  for (const e of (await st()).entries || []) {
    if (e.type === 'sleep' && e.start === t0) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  }

  // ═══ 3. 똥 — 큰 글씨는 마지막 똥, 작은 글씨는 소변까지 포함한 기저귀 ═══
  await mut('addEntry', { type: 'diaper', diaper: 'dirty', start: iso(166), by: '내니' });
  await mut('addEntry', { type: 'diaper', diaper: 'wet', start: iso(13), by: '내니' });
  p = await open();
  c = await cell(p, 'poop');
  /* 분은 떼지 않는다 — 깨시가 한 시간 반이라 "1시간"과 "1시간 30분"은
     다른 말이다. 대신 글자가 칸을 넘지 않게 세 칸의 크기를 함께 줄인다. */
  check('마지막 똥은 분까지 적는다', c.big, '2시간 46분 전');
  check('...작은 글씨는 소변 포함 마지막 기저귀', c.sub, '기저귀 13분 전');
  await p.close();

  // ═══ 4. 수유 — 큰 글씨는 남은 시간, 작은 글씨는 그 시각 ═══
  p = await open();
  c = await cell(p, 'feed');
  check('수유 칸이 값을 말한다', /(후|지났어요|완료|ml|—)/.test(c.big), true);
  if (/후$/.test(c.big)) check('...작은 글씨는 그 시각', /\d{1,2}:\d{2}/.test(c.sub), true);

  // ═══ 5. 칸을 넘지 않는다 ═══
  const fit = await p.evaluate(() => {
    const row = document.getElementById('dash4');
    const bad = [];
    row.querySelectorAll('.d4').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      el.querySelectorAll('.d4-big, .d4-sub, .d4-lab').forEach(x => {
        const bb = x.getBoundingClientRect();
        if (bb.right > r.right + 0.5 || bb.left < r.left - 0.5) bad.push(i + ':' + x.className);
      });
    });
    return { bad, overflow: row.getBoundingClientRect().width > 390.5 };
  });
  check('칸 안의 글자가 칸을 넘지 않는다', fit.bad, []);
  check('줄 전체가 화면을 넘지 않는다', fit.overflow, false);

  /* 라벨과 값은 빠른기록의 '분유'(15px)보다 작아지지 않는다 */
  check('대시보드 라벨·값은 빠른기록 라벨보다 작지 않다',
    await p.evaluate(() => {
      const base = parseFloat(getComputedStyle(document.querySelector('.qa-label')).fontSize);
      return [...document.querySelectorAll('#dash4 .d4-lab, #dash4 .d4-big')]
        .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(v => v < base);
    }), []);
  /* 둘째 줄은 일부러 더 작다(회색·얇게). 대신 앱에 이미 있는 가장 작은
     크기(--fs-micro 12px)보다 더 내려가지는 않는다 — 거기부터는 이 화면에
     없던 글자 크기를 새로 만드는 일이다. */
  check('...둘째 줄은 12px보다 작지 않고 큰 글씨보다 작다',
    await p.evaluate(() => {
      const sub = [...document.querySelectorAll('#dash4 .d4-sub')]
        .map(e => parseFloat(getComputedStyle(e).fontSize));
      const big = parseFloat(getComputedStyle(document.querySelector('#dash4 .d4-big')).fontSize);
      return sub.every(v => v >= 12 && v < big);
    }), true);
  check('...둘째 줄은 회색이고 얇다', await p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#dash4 .d4-sub'));
    const d = document.createElement('div'); d.style.color = 'var(--muted)';
    document.body.appendChild(d); const want = getComputedStyle(d).color; d.remove();
    return cs.color === want && Number(cs.fontWeight) <= 400;
  }), true);
  /* 한 줄로 서야 한다 — '기저귀 12시간 42분 전'이 넘쳐 두 줄이 되면 칸
     높이가 밀려서 세 칸의 밑선이 어긋난다 */
  check('...둘째 줄이 한 줄에 선다', await p.evaluate(() => {
    return [...document.querySelectorAll('#dash4 .d4-sub')].every(e => {
      const lh = parseFloat(getComputedStyle(e).lineHeight);
      return e.getBoundingClientRect().height < lh * 1.6;
    });
  }), true);
  /* 크기는 가장 긴 값에 맞춰 함께 줄어든다 — 셋이 언제나 같은 크기여야 하고,
     빠른기록 라벨(15px)보다 작아지면 안 된다. */
  const bigSizes = await p.evaluate(() => [...new Set([...document.querySelectorAll('#dash4 .d4-big')]
    .map(e => getComputedStyle(e).fontSize))]);
  check('세 칸의 큰 글씨는 모두 같은 크기다', bigSizes.length, 1);
  check('...그리고 15px보다 작지 않다', parseFloat(bigSizes[0]) >= 15, true);
  await p.close();

  // ═══ 6. 이유식 띠 ═══
  p = await open();
  let w = await band(p);
  check('식단 시작 전에는 띠가 D-N을 센다', /^D-\d+$/.test(w.more), true);
  check('...그림은 없다', w.icons, 0);
  await p.close();

  await mut('setWeanDay', { actor: '엄마', date: D(-1), meals: [
    { name: '아침', base: [{ ing: 'pgyo', g: 40 }], tops: [{ ing: 'beef', g: 10 }] }] });
  await mut('setWeanDay', { actor: '엄마', date: D(0), meals: [
    { name: '아침', base: [{ ing: 'pgyo', g: 40 }],
      tops: [{ ing: 'beef', g: 10 }, { ing: 'zucchini', g: 10 }] }] });
  p = await open();
  w = await band(p);
  check('오늘 식단이 있으면 띠가 뜬다', w.hidden, false);
  check('...재료 그림이 선다', w.icons, 3);
  check('...그림은 파일에서 온다', w.files, ['beef', 'oatmeal', 'zucchini']);
  check('...오늘 처음 먹는 재료에만 느낌표', w.news, 1);
  check('...그 재료가 맨 앞에 선다', w.firstIsNew, true);
  check('한 끼뿐인 날엔 끼니 이름을 적지 않는다', w.meals, []);
  /* 식단이 서 있는 날에는 제목도 🍽️ 도 세우지 않는다 — 재료 그림이 이미
     무엇인지 말하고 있어서 둘 다 자리만 먹었다 */
  check('...제목과 이모지는 안 뜬다', [w.title, w.emoji], [false, false]);
  await p.click('#wean-row'); await p.waitForTimeout(900);
  check('띠를 누르면 이유식 화면이 열린다',
    await p.evaluate(() => { const f = document.getElementById('fp-wean'); return !!f && !f.hidden; }), true);
  await p.close();

  // ═══ 7. 두 끼인 날 — 하루를 통째로, 끼니마다 한 줄 ═══
  /* 예전에는 '다음 안 먹인 끼니' 하나만 보여줬는데, 아침을 먹이면 점심으로
     바뀌면서 아침에 뭘 줬는지 띠에서 사라졌다. 하루 식단은 하루 종일 같은
     자리에 있어야 한다. */
  await mut('setWeanDay', { actor: '엄마', date: D(0), meals: [
    { name: '아침', base: [{ ing: 'pgyo', g: 40 }], tops: [{ ing: 'beef', g: 10 }] },
    { name: '점심', base: [{ ing: 'pgl', g: 60 }],
      tops: [{ ing: 'chicken', g: 15 }, { ing: 'broccoli', g: 15 }] }] });
  p = await open();
  w = await band(p);
  check('두 끼인 날엔 두 줄이 선다', w.rows, 2);
  check('...앞에 끼니 이름이 붙는다', w.meals, ['아침', '점심']);
  check('...줄마다 그 끼니 재료만', w.rowIcons, [2, 3]);
  await p.click('.qa-btn[data-type="wean"]');
  await p.waitForTimeout(1800);
  w = await band(p);
  check('아침을 먹여도 두 줄 그대로다', w.rowIcons, [2, 3]);
  await p.close();

  // ═══ 8. 시작 전 — 한 줄, 그때만 🍽️ 과 제목이 선다 ═══
  /* 식단표를 통째로 비운다 — weanFirstDay()가 '식단표의 첫날'이라,
     지난 날이 하나라도 남아 있으면 '시작 전'이 되지 않는다 */
  for (const k of Object.keys((await st()).weanPlan || {}))
    await mut('deleteWeanDay', { actor: '엄마', date: k });
  await mut('setWeanDay', { actor: '엄마', date: D(20), meals: [
    { name: '아침', base: [{ ing: 'pgyo', g: 40 }], tops: [] }] });
  p = await open();
  w = await band(p);
  check('시작 전에는 한 줄만 뜬다', [w.hidden, w.rows], [false, 0]);
  check('...🍽️ 과 제목이 그때만 선다', [w.emoji, w.title], [true, true]);
  check('...D-N 을 센다', w.dn, 'D-20');
  await p.close();

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const bad = R.filter(r => !r.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  ❌ ' + bad + ' FAIL' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
