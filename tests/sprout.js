/* 새싹 탭 — 캘린더 · 모아보기 · 그래프 (개편안 H·J·K).

   이 탭의 가장 큰 문제는 **빈 화면**이었다: 달력이 끝나고 900px이 회색이고,
   날짜를 누르면 다른 전체화면으로 나가는데 거기도 일기 한 줄 밑으로 비어
   있었다. 그래서 여기서 묻는 것은 "그려지는가"가 아니라
     1) 날짜를 누르면 **그 자리 아래**에 그날이 펴지는가(전체화면이 아니라),
     2) 일정이 칸 안에서 말줄임표가 되지 않고 달력 아래 줄로 다 보이는가,
     3) 그래프 화면 한가운데에 입력 폼이 서 있지 않은가. */
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
const D = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => (x < 10 ? '0' : '') + x;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const LONG = '내니 쉬는 날 — 오전에 소아과 다녀오기';

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errs = [];
  /* 깨끗한 바닥 */
  const s0 = await st();
  for (const x of s0.diaries || []) await mut('deleteDiary', { id: x.id, actor: '엄마' });
  for (const x of s0.milestones || []) await mut('deleteMilestone', { id: x.id, actor: '엄마' });
  for (const x of s0.weights || []) await mut('deleteWeight', { id: x.id, actor: '엄마' });
  for (const x of s0.heights || []) await mut('deleteHeight', { id: x.id, actor: '엄마' });
  for (const x of s0.schedules || []) await mut('deleteSchedule', { id: x.id, actor: '엄마' });

  await mut('addDiary', { date: D(0), text: '오늘 처음으로 "엄마" 비슷한 소리를 냈다.', author: '엄마', lang: 'ko' });
  await mut('addMilestone', { date: D(0), text: '배밀이로 방을 가로질렀다', author: '엄마' });
  for (const [o, kg] of [[-40, 8.4], [-30, 8.6], [-20, 8.8], [-10, 8.9], [0, 9.0]]) {
    await mut('addWeight', { date: D(o), kg, author: '엄마' });
  }
  await mut('addHeight', { date: D(0), cm: 71.5, author: '엄마' });
  await mut('addSchedule', { date: D(1), endDate: D(1), time: '10:30', text: LONG, color: 'rose', author: '엄마', lang: 'ko' });

  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko');
  });
  await p.goto(BASE + '/'); await p.waitForTimeout(2200);
  await p.click('.tab-btn[data-tab="growth"]'); await p.waitForTimeout(900);

  /* ── 달력 ────────────────────────────────────────────────── */
  check('달력 칸에는 점만 — 일정 알약이 칸 안에 없다',
    await p.evaluate(() => document.querySelectorAll('#gcal-grid .gcal-evt').length), 0);
  check('오늘 칸에 기록 점이 섰다',
    await p.evaluate(d => {
      const c = document.querySelector('[data-gday="' + d + '"]');
      return c ? c.querySelectorAll('.gcal-marks .gm').length : 0;
    }, D(0)) >= 3, true);
  /* 칸 안에서 '내니 …'로 잘리던 것 — 아래 줄에서는 끝까지 보인다 */
  check('일정은 달력 아래 줄로, 글자가 안 잘린다',
    await p.evaluate(t => {
      const e = document.querySelector('#gcal-sched .e');
      return !!e && e.textContent.indexOf(t) >= 0;
    }, LONG), true);
  check('...시각도 같이 적힌다',
    await p.evaluate(() => /10:30/.test(document.getElementById('gcal-sched').textContent)), true);

  /* ── 그날이 아래에 펴진다 ─────────────────────────────────── */
  check('누르기 전에는 그날 칸이 닫혀 있다',
    await p.evaluate(() => document.getElementById('gcal-day').hidden), true);
  await p.click('[data-gday="' + D(0) + '"]'); await p.waitForTimeout(600);
  check('날짜를 누르면 아래에 펴진다',
    await p.evaluate(() => document.getElementById('gcal-day').hidden), false);
  check('...전체화면으로 나가지 않는다',
    await p.evaluate(() => document.getElementById('fp-gday').classList.contains('show')), false);
  const lines = await p.evaluate(() =>
    [...document.querySelectorAll('#gcal-day .gline .bd > b')].map(x => x.textContent.trim()));
  check('...그날의 일기·발달·측정이 줄로 선다', lines.length, 4);
  check('...일기 본문이 보인다',
    await p.evaluate(() => /엄마" 비슷한 소리/.test(document.getElementById('gcal-day').textContent)), true);
  check('...몸무게와 키도 줄이다',
    lines.filter(x => /9kg|71\.5cm/.test(x)).length, 2);
  await p.click('[data-gday="' + D(0) + '"]'); await p.waitForTimeout(500);
  check('같은 날을 다시 누르면 접힌다',
    await p.evaluate(() => document.getElementById('gcal-day').hidden), true);

  /* ── 그래프 ──────────────────────────────────────────────── */
  await p.click('#growth-tabs [data-gv="graph"]'); await p.waitForTimeout(700);
  check('그래프 화면 한가운데에 입력 폼이 없다',
    await p.evaluate(() => document.getElementById('weight-form').hidden), true);
  check('...+ 를 누르면 펴진다', await (async () => {
    await p.click('#gw-fab'); await p.waitForTimeout(400);
    return p.evaluate(() => document.getElementById('weight-form').hidden);
  })(), false);
  check('발달 기록 목록은 그래프 탭에 없다 (모아보기와 같은 내용이었다)',
    await p.evaluate(() => !!document.getElementById('milestone-card')), false);
  check('측정 목록은 최근 셋만',
    await p.evaluate(() => document.querySelectorAll('#weight-list .weight-row').length), 3);
  check('...전부 보기를 누르면 다 나온다', await (async () => {
    await p.click('#gw-all'); await p.waitForTimeout(400);
    return p.evaluate(() => document.querySelectorAll('#weight-list .weight-row').length);
  })(), 5);

  /* ── 모아보기 ────────────────────────────────────────────── */
  await p.click('#growth-tabs [data-gv="album"]'); await p.waitForTimeout(700);
  check('모아보기는 날짜 묶음에만 선을 긋는다',
    await p.evaluate(() => {
      const g = document.querySelector('.galb-group');
      return g ? getComputedStyle(g).borderTopWidth : 'none';
    }), '0px');
  check('...날짜 줄에 가는 선이 흐른다',
    await p.evaluate(() => !!document.querySelector('.galb-date i')), true);

  check('콘솔 에러 없음', errs, []);
  await p.close();
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
})();
