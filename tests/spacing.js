/* 여백을 눈으로 보지 말고 잰다.

   이유식 화면을 만들면서 여백을 손으로 넣었고, 눈으로 확인했다. 그래서
   지적이 한 번에 하나씩 왔다 — 오늘 줄이 오른쪽에서 16px 모자란 것, 카드
   사이가 0인 것, 제목이 흰 박스에 붙은 것, 목록 글자가 화면 끝에 붙은 것.
   전부 같은 종류의 실수이고 전부 재면 나온다.

   여기서 재는 것:
     1) 글자가 제 카드의 안쪽 가장자리에서 얼마나 떨어져 있나 (가로 14px 이상)
     2) 한 카드 안에서 왼쪽 들여쓰기와 오른쪽 들여쓰기가 같은가 (3px 이내)
     3) 카드의 첫 줄·마지막 줄 위아래로 숨 쉴 자리가 있나 (10px 이상)
     4) 배경을 칠한 줄이 제 카드를 정확히 덮나 (양쪽 같은 만큼)
     5) 카드와 카드 사이, 섹션 제목 위아래에 자리가 있나 (8px 이상)

   숫자는 앱이 이미 쓰는 값에서 왔다: 카드 가로 패딩 16, 줄 세로 패딩 11~13,
   급여 탭의 제목 위 16 / 아래 10. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  return { status:r.status, body: await r.json().catch(()=>({})) }; }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };
const p2 = n => String(n).padStart(2, '0');
const ds = x => x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate());
const TODAY = ds(new Date());
const dAdd = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ds(d); };

/* 브라우저 안에서 도는 측정기. 화면 하나를 통째로 훑어 어긋난 것만 돌려준다. */
const AUDIT = (rootSel) => {
  const MIN_SIDE = 14, MIN_END = 10, MAX_ASYM = 3, MIN_GAP = 8;
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const label = el => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName)
    + ' «' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18) + '»';

  const page = document.querySelector(rootSel || '.fullpage.show');
  if (!page) return [{ why: 'no page open' }];
  const cards = [...page.querySelectorAll('.card')].filter(vis);

  cards.forEach(card => {
    const cs = getComputedStyle(card);
    const cr = card.getBoundingClientRect();
    const inL = cr.left + parseFloat(cs.paddingLeft);
    const inR = cr.right - parseFloat(cs.paddingRight);
    const inT = cr.top + parseFloat(cs.paddingTop);
    const inB = cr.bottom - parseFloat(cs.paddingBottom);

    /* 1·2) 이 카드 안의 '글자 덩어리'들 */
    const leaves = [...card.querySelectorAll('*')].filter(el => {
      if (!vis(el)) return false;
      if (el.querySelector('*')) return false;              // 잎만
      return (el.textContent || '').trim().length > 0;
    });
    let minL = Infinity, minR = Infinity;
    leaves.forEach(el => {
      const r = el.getBoundingClientRect();
      /* 가로로 스크롤되는 줄(칩 목록 등)은 잘려 나가는 게 정상이라 뺀다 */
      let sc = el.parentElement, scrolls = false;
      while (sc && sc !== card){ if (getComputedStyle(sc).overflowX !== 'visible') scrolls = true; sc = sc.parentElement; }
      if (scrolls) return;
      minL = Math.min(minL, r.left - cr.left);
      minR = Math.min(minR, cr.right - r.right);
      if (r.left - cr.left < MIN_SIDE - 0.6)
        out.push({ card: label(card), el: label(el), why: 'left ' + Math.round(r.left - cr.left) });
      if (cr.right - r.right < MIN_SIDE - 0.6)
        out.push({ card: label(card), el: label(el), why: 'right ' + Math.round(cr.right - r.right) });
    });
    if (isFinite(minL) && isFinite(minR) && Math.abs(minL - minR) > MAX_ASYM)
      out.push({ card: label(card), why: 'asym L' + Math.round(minL) + ' R' + Math.round(minR) });

    /* 3) 카드의 위아래 숨통 — 첫/마지막 '자식 박스'가 아니라 첫/마지막 '글자'
       까지 잰다. 목록 카드는 세로 패딩이 0이고 숨통을 줄이 제 패딩(15px)으로
       만든다 — 박스로 재면 그걸 0으로 읽어 멀쩡한 카드를 물고, 반대로 세로
       패딩만 있고 줄이 글자를 가장자리까지 밀어놓은 카드는 놓친다. */
    if (leaves.length){
      let top = Infinity, bot = Infinity;
      leaves.forEach(el => { const r = el.getBoundingClientRect();
        top = Math.min(top, r.top - cr.top); bot = Math.min(bot, cr.bottom - r.bottom); });
      if (top < MIN_END - 0.6) out.push({ card: label(card), why: 'top ' + Math.round(top) });
      if (bot < MIN_END - 0.6) out.push({ card: label(card), why: 'bottom ' + Math.round(bot) });
    }
    const rows = [...card.children].filter(vis);

    /* 4) 배경을 칠한 줄은 카드를 양쪽 같은 만큼 덮어야 한다 */
    rows.forEach(row => {
      const rs = getComputedStyle(row);
      if (rs.backgroundImage === 'none' &&
          (rs.backgroundColor === 'rgba(0, 0, 0, 0)' || rs.backgroundColor === 'transparent')) return;
      const rr = row.getBoundingClientRect();
      const l = rr.left - cr.left, r2 = cr.right - rr.right;
      if (Math.abs(l - r2) > 1.5)
        out.push({ card: label(card), el: label(row), why: 'tint L' + Math.round(l) + ' R' + Math.round(r2) });
    });
  });

  /* 5) 카드·제목 사이의 자리 */
  const body = page.querySelector('.fp-body') || page;
  const flow = [];
  const walk = box => [...box.children].filter(vis).forEach(ch => {
    if (ch.classList.contains('card') || ch.classList.contains('section-title') ||
        ch.classList.contains('wn-weeknav')) flow.push(ch);
    else if (ch.id === 'wn-body' || ch.tagName === 'DIV') walk(ch);
  });
  if (body) walk(body);
  for (let i = 1; i < flow.length; i++){
    const a = flow[i - 1].getBoundingClientRect(), b = flow[i].getBoundingClientRect();
    const gap = b.top - a.bottom;
    if (gap < MIN_GAP - 0.6)
      out.push({ el: label(flow[i]), why: 'gap ' + Math.round(gap) + ' after ' + label(flow[i - 1]) });
  }
  return out;
};

const MEALS = [{ name:'아침',
  base:[{ing:'pgyo',g:40}],
  tops:[{ing:'beef',g:10},{ing:'zucchini',g:10},{ing:'egg',g:10}] }];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];

  /* 볼 것이 있어야 잰다 — 식단·기록·큐브를 채워 둔다 */
  let p0 = await b.newPage({ viewport:{ width:390, height:900 } });
  await p0.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await p0.goto(BASE + '/'); await p0.waitForTimeout(2200); await p0.close();
  for (let i = -3; i <= 2; i++) await mut('setWeanDay', { date: dAdd(TODAY, i), meals: MEALS, actor:'엄마' });
  for (const [ing, n, ago] of [['pgyo',6,2],['beef',2,16],['beef',3,1],['egg',1,1]])
    await mut('addWeanCubes', { ing, n, madeOn: dAdd(TODAY, -ago), actor:'엄마' });
  for (let i = 3; i >= 1; i--){
    const t0 = new Date(new Date(dAdd(TODAY, -i) + 'T09:40:00')).toISOString();
    await mut('addEntry', { type:'wean', start:t0, end:t0, author:'엄마',
      ate:['full','half','little'][i - 1], react:'none', amount:35, ings:[{ing:'beef',g:10}] });
  }
  await mut('setWeanShop', { week: TODAY, ing:'beef', amount: 200, actor:'엄마' });
  await mut('setWeanShop', { week: TODAY, ing:'큐브 트레이', extra: true, amount: 2, unit:'ea', actor:'엄마' });

  const open = async (lang) => {
    const p = await b.newPage({ viewport:{ width:390, height:1400 } });
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(l => {
      localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang', l);
    }, lang || 'ko');
    await p.goto(BASE + '/'); await p.waitForTimeout(2000);
    await p.click('#wean-row'); await p.waitForTimeout(900);
    return p;
  };

  for (const lang of ['ko', 'vi']){
    const p = await open(lang);
    for (const view of ['plan', 'shop', 'cubes', 'ings']){
      await p.click('#wn-tabs [data-wn="' + view + '"]');
      await p.waitForTimeout(700);
      check(lang + ' · ' + view + ' — 여백이 모자란 곳 없음', await p.evaluate(AUDIT), []);
    }
    /* 제목 리듬은 앱이 이미 정해 놓은 것을 그대로 쓴다 — 설정 목차·급여 탭에서
       잰 값이 '카드 밖, 위 20 / 아래 10'이다. 새 화면이 저 혼자 다른 간격을
       쓰기 시작하면 화면끼리 어긋나므로 숫자로 묶어 둔다. */
    await p.click('#wn-tabs [data-wn="cubes"]'); await p.waitForTimeout(700);
    check(lang + ' · 섹션 제목 리듬이 앱과 같다(위 20 / 아래 10)',
      await p.evaluate(() => [...document.querySelectorAll('.fullpage.show .section-title')]
        .filter(t => t.getBoundingClientRect().height)
        .map(t => ({ inCard: !!t.closest('.card'),
          above: Math.round(t.getBoundingClientRect().top - t.previousElementSibling.getBoundingClientRect().bottom),
          below: Math.round(t.nextElementSibling.getBoundingClientRect().top - t.getBoundingClientRect().bottom) }))
        .filter(x => x.inCard || x.above !== 20 || x.below !== 10)), []);

    /* 하루 고치기와 재료 상세도 같은 자로 잰다 */
    await p.click('#wn-tabs [data-wn="plan"]'); await p.waitForTimeout(600);
    /* 달력에서 오늘(없으면 아무 날)을 펼치고, 그 끼니 카드로 하루 고치기 */
    await p.evaluate(()=>{ const d=new Date(); const p2=x=>(x<10?'0':'')+x;
      const ds=d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
      const t=[...document.querySelectorAll('.wc-pill')].find(e=>e.dataset.wnPick===ds)
           || document.querySelector('.wc-pill');
      if (t) t.click(); });
    await p.waitForTimeout(800);
    check(lang + ' · 고른 날 — 여백이 모자란 곳 없음', await p.evaluate(AUDIT), []);
    await p.locator('.wd-card').first().click(); await p.waitForTimeout(800);
    check(lang + ' · 하루 고치기 — 여백이 모자란 곳 없음', await p.evaluate(AUDIT), []);
    await p.click('#fp-weanday-back'); await p.waitForTimeout(500);
    await p.click('#wn-tabs [data-wn="ings"]'); await p.waitForTimeout(700);
    await p.locator('[data-wn-ing]').first().click(); await p.waitForTimeout(800);
    check(lang + ' · 재료 상세 — 여백이 모자란 곳 없음', await p.evaluate(AUDIT), []);
    await p.close();
  }

  /* 기록 상세(이유식 칸이 붙는 화면)도 같은 자로 */
  const p = await b.newPage({ viewport:{ width:390, height:1600 } });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await p.goto(BASE + '/'); await p.waitForTimeout(2000);
  await p.click('.qa-btn[data-type="wean"]'); await p.waitForTimeout(1400);
  await p.locator('.entry-row:has-text("이유식")').first().click(); await p.waitForTimeout(900);
  check('기록 상세 — 여백이 모자란 곳 없음', await p.evaluate(AUDIT), []);
  await p.close();

  /* 설정 목차·하위 화면. 여기 줄들도 .row-item이라 위의 전폭 규칙을 같이
     탄다 — 폭을 손으로 달고 있던 걸 뺐으니 여기서 지켜본다. */
  const ps = await b.newPage({ viewport:{ width:390, height:1600 } });
  ps.on('pageerror', e => errs.push(String(e)));
  await ps.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await ps.goto(BASE + '/'); await ps.waitForTimeout(2000);
  await ps.click('#btn-settings'); await ps.waitForTimeout(800);
  check('설정 목차 — 여백이 모자란 곳 없음', await ps.evaluate(AUDIT, '#tab-settings'), []);
  await ps.click('[data-set-go="who"]'); await ps.waitForTimeout(700);
  check('설정 · 누구로 쓰나 — 여백이 모자란 곳 없음', await ps.evaluate(AUDIT, '#tab-settings'), []);
  await ps.click('#set-back'); await ps.waitForTimeout(500);
  await ps.click('[data-set-go="trash"]'); await ps.waitForTimeout(700);
  check('설정 · 휴지통 — 여백이 모자란 곳 없음', await ps.evaluate(AUDIT, '#tab-settings'), []);
  await ps.close();

  /* 앱이 원래 쓰던 화면도 같은 자로 — 새 화면만 다른 리듬을 쓰고 있지 않은지 */
  const p2p = await b.newPage({ viewport:{ width:390, height:1400 } });
  p2p.on('pageerror', e => errs.push(String(e)));
  await p2p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await p2p.goto(BASE + '/'); await p2p.waitForTimeout(2000);
  await p2p.click('.tab-btn[data-tab="pay"]'); await p2p.waitForTimeout(800);
  await p2p.click('#pay-tabs button[data-pv="settle"]'); await p2p.waitForTimeout(800);
  const byd = await p2p.$('#pay-bydays');
  if (byd){
    await byd.click(); await p2p.waitForTimeout(800);
    check('정산 날짜별 — 여백이 모자란 곳 없음', await p2p.evaluate(AUDIT), []);
  } else console.log('SKIP  이번 기간엔 정산 날짜별 화면이 없다');
  await p2p.close();

  for (const k of Object.keys((await st()).weanPlan || {})) await mut('deleteWeanDay', { date:k, actor:'엄마' });
  for (const e of ((await st()).entries || []).filter(e => e.type === 'wean'))
    await mut('deleteEntry', { id:e.id, actor:'엄마' });
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
