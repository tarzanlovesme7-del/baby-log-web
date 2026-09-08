const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await page.addInitScript(() => { localStorage.setItem('bbl_author', '엄마'); });
  await page.goto(BASE + '/');
  await page.waitForTimeout(800);
  await page.click('[data-tab="stats"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/dark_stats.png', clip: { x: 0, y: 0, width: 390, height: 844 } });
  await page.click('[data-tab="memo"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/dark_memo.png', clip: { x: 0, y: 0, width: 390, height: 844 } });
  await browser.close();
})();
