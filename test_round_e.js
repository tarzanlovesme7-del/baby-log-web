const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const BASE = 'http://localhost:3311';

function iso(daysAgo, hoursAgo) {
  const d = new Date();
  d.setDate(d.getDate() - (daysAgo || 0));
  d.setHours(d.getHours() - (hoursAgo || 0));
  return d.toISOString();
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  const seedTimes = [
    { d: 5, h: 4 }, { d: 4, h: 8 }, { d: 3, h: 2 }, { d: 2, h: 14 },
    { d: 1, h: 16 }, { d: 1, h: 0 }, { d: 0, h: 20 },
  ];
  for (const s of seedTimes) {
    await fetch(BASE + '/api/mutate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'addEntry', payload: { type: 'diaper', diaper: 'dirty', start: iso(s.d, s.h), end: iso(s.d, s.h), author: '엄마' } }),
    });
  }
  await fetch(BASE + '/api/mutate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'addEntry', payload: { type: 'feed', amount: 120, start: iso(0, 1), end: iso(0, 1), author: '아빠' } }),
  });
  await fetch(BASE + '/api/mutate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'addMemo', payload: { text: '테스트 메모입니다', lang: 'ko', translation: 'Ghi chú thử nghiệm', author: '내니' } }),
  });
  await fetch(BASE + '/api/mutate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'addMemo', payload: { text: '두번째 메모', lang: 'ko', translation: 'Ghi chú thứ hai', author: '엄마' } }),
  });

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('bbl_author', '엄마'); });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.appVersion !== undefined && window.appVersion > 0).catch(()=>{});
  await page.waitForTimeout(800);

  // ---- go to stats tab, screenshot the poop chart (KO) ----
  await page.click('[data-tab="stats"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/round_e_stats_ko.png', clip: { x: 0, y: 0, width: 390, height: 844 } });

  const badgeText = await page.textContent('#poop-recent-badge');
  const svgExists = await page.$('#poop-chart-wrap svg') !== null;
  const dayListText = await page.textContent('#poop-day-list');
  console.log('POOP BADGE:', badgeText, '| SVG EXISTS:', svgExists);
  console.log('DAY LIST HAS 대변:', dayListText.includes('대변'));

  // check stats section order: feed title should appear before poop title before sleep title
  const order = await page.evaluate(() => {
    const panel = document.getElementById('tab-stats');
    const feedIdx = panel.innerHTML.indexOf('수유 통계') === -1 ? panel.innerHTML.indexOf('id="stat-tiles"') : panel.innerHTML.indexOf('수유 통계');
    const poopIdx = panel.innerHTML.indexOf('poop-chart-card');
    const sleepIdx = panel.innerHTML.indexOf('수면 통계');
    return { feedIdx, poopIdx, sleepIdx };
  });
  console.log('SECTION ORDER (feed<poop<sleep expected):', JSON.stringify(order), order.feedIdx < order.poopIdx && order.poopIdx < order.sleepIdx);

  // ---- switch to VI, verify author names localize (record tab) ----
  await page.click('[data-tab="record"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/round_e_record_ko.png', clip: { x: 0, y: 0, width: 390, height: 844 } });
  await page.click('#lang-pill button[data-lang="vi"]');
  await page.waitForTimeout(300);
  const authorSpansVi = await page.$$eval('.e-author', els => els.map(e => e.textContent));
  console.log('AUTHOR SPANS AFTER VI SWITCH:', JSON.stringify(authorSpansVi));
  await page.screenshot({ path: '/tmp/round_e_record_vi.png', clip: { x: 0, y: 0, width: 390, height: 844 } });

  // pill contrast check: compute bg colors of header vs lang-pill/profile-pill
  const contrastInfo = await page.evaluate(() => {
    const header = getComputedStyle(document.querySelector('header.top'));
    const langPill = getComputedStyle(document.querySelector('.lang-pill'));
    const profilePill = getComputedStyle(document.querySelector('.profile-pill'));
    return { headerBg: header.backgroundColor, langPillBg: langPill.backgroundColor, profilePillBg: profilePill.backgroundColor, langPillShadow: langPill.boxShadow, profilePillShadow: profilePill.boxShadow };
  });
  console.log('CONTRAST INFO:', JSON.stringify(contrastInfo));

  // ---- memo tab: check flat list + border dividers, no card bg on rows ----
  await page.click('[data-tab="memo"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/round_e_memo_vi.png', clip: { x: 0, y: 0, width: 390, height: 844 } });
  const memoRowInfo = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.memo-row'));
    return rows.map(r => ({ bg: getComputedStyle(r).backgroundColor, borderBottom: getComputedStyle(r).borderBottomWidth }));
  });
  console.log('MEMO ROW INFO:', JSON.stringify(memoRowInfo));

  // author chip selection check in profile picker (VI mode, state.author was 엄마 -> should show Mẹ selected)
  await page.click('#btn-profile');
  await page.waitForTimeout(200);
  const pressedChip = await page.evaluate(() => {
    const box = document.getElementById('profile-chip-row');
    if (!box) return null;
    const btn = box.querySelector('.chip[aria-pressed="true"]');
    return btn ? btn.textContent : null;
  });
  console.log('PROFILE CHIP PRESSED (expect Mẹ):', pressedChip);
  await page.click('#scrim3').catch(()=>{});
  await page.waitForTimeout(150);

  // ---- horizontal scroll check at 320 and 390 across all tabs ----
  for (const w of [320, 390]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(150);
    for (const tabName of ['record', 'memo', 'stats', 'settings']) {
      await page.click('[data-tab="' + tabName + '"]').catch(()=>{});
      await page.waitForTimeout(150);
      const scroll = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      console.log('SCROLL CHECK w=' + w + ' tab=' + tabName + ':', JSON.stringify(scroll), scroll.scrollWidth > scroll.innerWidth ? 'OVERFLOW!' : 'ok');
    }
  }

  console.log('PAGE ERRORS:', JSON.stringify(errors));

  await browser.close();
})();
