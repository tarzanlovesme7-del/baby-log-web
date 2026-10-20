/* 이유식.

   못 박는 것:
     - 아이콘 한 번 = 바로 저장. 먹은 양은 비어 있다("안 적음"), '다 먹음'을
       임의로 채우지 않는다 — 안 적은 것과 다 먹은 것은 다른 사실이다.
     - 그날 메뉴는 식단표에서 읽어 기록에 사본으로 붙는다. 식단표를 나중에
       고쳐도 그날 기록은 안 흔들린다.
     - 기록하면 그날 재료의 냉동 큐브가 한 칸씩 빠지고, 지우면 돌아온다.
     - 장보기는 계산값 위에 차이만 얹는다. "늘 이만큼"은 재료에 붙어 다음
       주에도 살아남고, 이번 주만 고친 값은 그 주에만 산다.
     - 내니 폰은 읽고 기록만 한다 — 식단표·장보기·재료는 서버가 막는다.
     - 식단이 없는 날엔 띠가 뜨지 않는다(11/6 전에는 매일이 그렇다).
       그 동안의 입구는 설정 목차의 이유식 줄이다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  return { status: r.status, body: await r.json().catch(()=>({})) }; }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json();
  const d = j.data || j; d.entries = d.entries || []; d.weanCubes = d.weanCubes || [];
  d.weanShop = d.weanShop || []; d.weanIngs = d.weanIngs || []; d.weanPlan = d.weanPlan || {};
  return d; };

const p2 = n => String(n).padStart(2, '0');
const ds = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const TODAY = ds(new Date());
const dAdd = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ds(d); };
/* 월요일 기준 주 — 장보기가 그렇게 센다 */
const weekOf = (s) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ds(d); };

const MEALS = [{ name:'아침', base:[{ing:'pgyo',g:40}],
                 tops:[{ing:'beef',g:10},{ing:'zucchini',g:10},{ing:'egg',g:10}] }];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const open = async (who, lang) => {
    const p = await b.newPage({ viewport:{ width:390, height:900 } });
    p.on('pageerror', e => errs.push(who + ': ' + String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(who+': '+m.text()); });
    await p.addInitScript(([w, l]) => {
      localStorage.setItem('bbl_author', w); localStorage.setItem('bbl_lang', l);
    }, [who, lang || 'ko']);
    await p.goto(BASE + '/');
    await p.waitForTimeout(1800);
    return p;
  };
  const clearWean = async () => {
    const s = await st();
    for (const e of s.entries.filter(e => e.type === 'wean'))
      await mut('deleteEntry', { id: e.id, actor: '엄마' });
    for (const k of Object.keys(s.weanPlan)) await mut('deleteWeanDay', { date: k, actor: '엄마' });
    for (const g of s.weanIngs) await mut('deleteWeanIng', { id: g.id, actor: '엄마' });
  };

  // ═══ 엄마 폰이 처음 열면 식단표가 심어진다 ═══
  await clearWean();
  let p = await open('엄마');
  await p.waitForTimeout(1500);
  let s = await st();
  /* 초기 30일(11/6~12/5) + 중기 60일(12/6~2027-02-03) */
  check('첫 실행에 90일 식단표가 심어진다', Object.keys(s.weanPlan).length, 90);
  check('...초기 끝과 중기 첫날이 이어진다',
    ['2026-12-05','2026-12-06','2027-02-03'].map(d => !!s.weanPlan[d]), [true, true, true]);
  check('...중기는 하루 두 끼다',
    s.weanPlan['2026-12-06'].meals.map(m => m.name), ['아침','점심']);
  check('...큐브 사전도 같이', s.weanIngs.length, 39);
  check('...베이스죽도 큐브다', s.weanIngs.filter(g => g.isBase).length, 9);
  /* 재료(사 오는 것)와 큐브(얼리는 것)는 다른 사전이다. 쌀오트밀죽 한 칸에
     재료는 쌀과 오트밀 둘이라 1:1이 아니다. 가르기는 엄마 폰이 한 번 한다. */
  check('...재료 사전이 따로 선다', s.weanRaw.length, 37);
  check('...곡물 큐브는 재료로 쪼개진다',
    (s.weanRaw || []).filter(g => g.cat === 'grain').map(g => g.id).sort(),
    ['r_barley','r_black','r_brown','r_oat','r_quinoa','r_rice','r_sorghum','r_wheat']);
  check('...쌀오트밀죽은 쌀과 오트밀로 만든다',
    (s.weanIngs.find(g => g.id === 'pgyo') || {}).raw, ['r_rice', 'r_oat']);
  check('...토핑은 1:1 그대로다',
    (s.weanIngs.find(g => g.id === 'beef') || {}).raw, ['beef']);
  check('...달걀은 알레르기 주의로 들어간다',
    (s.weanRaw.find(g => g.id === 'egg') || {}).allergen, true);
  check('...달걀은 개 단위에 늘 2개',
    [(s.weanRaw.find(g => g.id === 'egg') || {}).unit, (s.weanRaw.find(g => g.id === 'egg') || {}).always], ['ea', 2]);
  check('...알레르기·늘 이만큼은 큐브에 남지 않는다',
    [(s.weanIngs.find(g => g.id === 'egg') || {}).allergen,
     (s.weanIngs.find(g => g.id === 'egg') || {}).always], [undefined, undefined]);

  // ═══ 오늘 식단이 없으면 띠가 뜨지 않는다 ═══
  /* 씨앗 식단은 11/6부터라, 오늘이 그 안이 아니면 띠는 숨어 있는 게 맞다 */
  const seeded = Object.keys(s.weanPlan).sort();
  const todayInSeed = seeded.indexOf(TODAY) >= 0;
  /* 띠는 식단이 없는 날에도 떠 있다 — 시작 전이면 D-N을 센다.
     그림이 서는 건 그날 식단이 있을 때뿐이다. */
  check('오늘 식단이 없으면 띠에 그림이 없다',
    await p.evaluate(()=>document.querySelectorAll('#wean-row .wn-it').length > 0),
    todayInSeed);
  /* 그 동안의 입구: 설정 목차의 이유식 줄 */
  await p.click('#btn-settings'); await p.waitForTimeout(700);
  check('설정 목차에 이유식 줄이 있다', await p.evaluate(()=>!!document.getElementById('set-wean')), true);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  check('...누르면 이유식 화면이 열린다',
    await p.evaluate(()=>document.getElementById('fp-wean').classList.contains('show')), true);
  /* '오늘' 탭은 없앴다 — 식단표에서 날짜를 고르면 그날의 식단·먹은 양·
     지켜보는 중이 한자리에 펴지므로 같은 날을 두 화면에서 찾을 이유가 없다. */
  check('...서브탭이 넷이다', await p.evaluate(()=>document.querySelectorAll('#wn-tabs button').length), 4);
  check('...열면 식단표가 켜져 있다',
    await p.evaluate(()=>(document.querySelector('#wn-tabs button[aria-pressed="true"]')||{}).dataset.wn), 'plan');
  /* 켜진 탭이 눈에 보이는가. t-screen 토큰을 달았더니 그 id 규칙이
     .htabs button[aria-pressed] 을 이겨서 다섯 개가 똑같이 보였다. */
  check('...켜진 탭이 나머지와 다른 색이다', await p.evaluate(()=>{
    const on = document.querySelector('#wn-tabs button[aria-pressed="true"]');
    const off = document.querySelector('#wn-tabs button[aria-pressed="false"]');
    return getComputedStyle(on).color !== getComputedStyle(off).color;
  }), true);
  check('...켜진 탭에 밑줄이 보인다', await p.evaluate(()=>{
    const on = document.querySelector('#wn-tabs button[aria-pressed="true"]');
    const cs = getComputedStyle(on);
    const tabs = document.getElementById('wn-tabs');
    /* 밑줄이 스크롤 박스 밖으로 밀리면 잘려서 안 보인다 */
    return cs.borderBottomWidth === '3px' &&
      on.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().bottom + 0.5;
  }), true);
  await p.close();

  // ═══ 오늘 식단을 넣으면 첫 화면 이유식 칸에 그림이 선다 ═══
  /* 2026-10-19 전까지는 여기에 '오늘 이유식' 띠가 떴다. 띠는 하루 종일
     자리를 차지해서 네 칸 대시보드로 합쳐졌고, 이제 글자 대신 그날 쓰는
     재료 그림이 선다. 메뉴 글자는 이유식 화면 안에서 본다. */
  await mut('setWeanDay', { date: TODAY, meals: MEALS, actor: '엄마' });
  p = await open('엄마');
  check('오늘 식단이 있으면 띠에 그림이 선다',
    await p.evaluate(()=>document.querySelectorAll('#wean-row .wn-it').length), 4);
  check('...쓰는 재료만큼 (죽 + 토핑 셋)',
    (await p.evaluate(()=>[...document.querySelectorAll('#wean-row img.wi')]
      .map(i=>i.getAttribute('src').replace('icons/','').replace('.svg','')))).sort(),
    ['beef','egg','oatmeal','zucchini']);

  // ═══ 큐브를 채워두고 ═══
  for (const ing of ['pgyo','beef','zucchini','egg'])
    await mut('addWeanCubes', { ing, n: 5, madeOn: TODAY, actor: '엄마' });
  await p.reload(); await p.waitForTimeout(1800);

  // ═══ 아이콘 한 번 = 바로 저장 ═══
  await p.click('.qa-btn[data-type="wean"]');
  await p.waitForTimeout(1500);
  s = await st();
  const rec = s.entries.filter(e => e.type === 'wean')[0];
  check('아이콘을 한 번 누르면 바로 저장된다', !!rec, true);
  check('...먹은 양은 비어 있다 (다 먹음을 임의로 넣지 않는다)', rec.ate, '');
  check('...그날 메뉴가 사본으로 붙는다', /쌀오트밀죽 40g/.test(rec.menu || ''), true);
  check('...재료 목록도 붙는다', (rec.ings || []).map(x => x.ing).sort(),
    ['beef','egg','pgyo','zucchini']);
  check('...냉동 큐브가 한 칸씩 빠졌다',
    ['pgyo','beef','zucchini','egg'].map(i => (s.weanCubes.find(c=>c.ing===i)||{}).n), [4,4,4,4]);
  check('로그에 이유식 줄이 선다',
    await p.evaluate(()=>[...document.querySelectorAll('.entry-row')]
      .some(x=>/이유식/.test(x.textContent))), true);
  /* 안 적었으면 그 말을 줄에 적지 않는다 — 양을 안 적은 분유가 그냥 '분유'인 것과 같다 */
  check('...먹은 양을 안 적었으면 줄에 아무 말도 안 붙는다',
    await p.evaluate(()=>{ const r=[...document.querySelectorAll('.entry-row')]
      .find(x=>/이유식/.test(x.textContent)); return /안 적음/.test(r.textContent); }), false);
  /* 먹였는지 여부는 띠가 사라지면서 첫 화면에서 빠졌다 — 이유식 화면의
     '오늘' 탭이 그 말을 맡는다. 칸의 그림은 먹이기 전후로 바뀌지 않는다. */
  check('먹인 뒤에도 띠의 그림은 그대로다',
    await p.evaluate(()=>document.querySelectorAll('#wean-row .wn-it').length), 4);

  // ═══ 기록 상세에서 먹은 양을 채운다 ═══
  /* .entry-row는 포인터 이벤트로 열린다(스와이프 삭제와 한 몸이다) —
     evaluate 안에서 el.click()을 부르면 아무 일도 일어나지 않는다. */
  await p.click('.entry-row:has-text("이유식")');
  await p.waitForTimeout(900);
  /* 먹은 양은 g 고르개 하나다 — '다 먹음/반/조금/거부' 세그먼트는 없앴다.
     같은 질문을 두 부품으로 묻고 있었고(세그먼트 + 잰 무게 눈금자), 둘이
     다른 값을 들고 있으면 어느 쪽이 참인지 아무도 모른다. */
  check('기록 상세가 흰 종이다 (회색 바닥이 아니다)',
    await p.evaluate(()=>{
      const d = document.createElement('div');
      d.style.background = 'var(--surface)';
      document.body.appendChild(d);
      const want = getComputedStyle(d).backgroundColor; d.remove();
      return getComputedStyle(document.getElementById('fp-entry')).backgroundColor === want;
    }), true);
  check('...먹은 양이 g 고르개 하나다', await p.evaluate(()=>
    !document.getElementById('f-ate') && !!document.querySelector('.amt #f-amount')), true);
  check('...이상 반응은 칩 줄이다', await p.evaluate(()=>
    !!document.querySelector('#f-react .chip')), true);
  check('...먹인 것이 적혀 있다',
    /쌀오트밀죽/.test(await p.evaluate(()=>{ const el=document.querySelector('.wn-menu-box'); return el?el.textContent:''; })), true);
  /* 눈금 오른쪽 끝은 그 끼니의 총 그램 — '다 먹음'이 몇 g인지가 거기 적힌다 */
  check('...눈금 끝에 다 먹음 그램이 적힌다',
    /70/.test(await p.evaluate(()=>document.querySelector('.amt-ends').textContent)), true);
  check('...언제/누가가 맨 윗줄에 있다',
    /내니|엄마|아빠/.test(await p.evaluate(()=>{ const e=document.querySelector('.ent-when'); return e?e.textContent:''; })), true);
  check('...사진 줄이 있다', await p.evaluate(()=>!!document.getElementById('f-pics')), true);
  /* 바닥은 저장 하나. '다시 먹이기'를 저장 옆에 두니 둘 다 똑같이 크게 서서
     나가는 길이 두 개로 보였다 — 한 번 더 먹이는 길은 빠른기록이 맡는다. */
  check('...바닥 버튼은 저장 하나다', await p.evaluate(()=>
    [...document.querySelectorAll('#fp-entry .fp-foot .btn')].map(b=>b.id)), ['fp-entry-save']);
  await p.evaluate(()=>{ const i=document.getElementById('f-amount');
    i.value='45'; i.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(400);
  await p.evaluate(()=>document.querySelector('#f-react [data-val="rash"]').click());
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  s = await st();
  const rec2 = s.entries.filter(e => e.type === 'wean')[0];
  check('먹은 양이 g으로 저장된다', rec2.amount, 45);
  check('...이상 반응도', rec2.react, 'rash');
  check('...로그 줄에도 나온다',
    await p.evaluate(()=>{ const r=[...document.querySelectorAll('.entry-row')]
      .find(x=>/이유식/.test(x.textContent)); return /45/.test(r.textContent) && /발진/.test(r.textContent); }), true);

  // ═══ 지우면 큐브가 돌아온다 ═══
  await mut('deleteEntry', { id: rec2.id, actor: '엄마' });
  s = await st();
  check('기록을 지우면 큐브가 돌아온다',
    ['pgyo','beef'].map(i => (s.weanCubes.find(c=>c.ing===i)||{}).n), [5,5]);
  await p.close();

  // ═══ 먹인 것 고치기 ═══
  /* 식단표와 다르게 준 날. 고친 값은 이 기록에만 붙고 식단표는 안 건드린다. */
  p = await open('엄마');
  /* 앞 절에서 기록을 지웠으니 하나 새로 남긴다 */
  await p.click('.qa-btn[data-type="wean"]'); await p.waitForTimeout(1400);
  await p.locator('.entry-row:has-text("이유식")').first().click();
  await p.waitForTimeout(900);
  /* 기록 상세의 '먹인 것'은 식단표의 끼니 카드와 같은 컴포넌트다 */
  check('먹인 것이 식단 카드로 나온다',
    await p.evaluate(()=>{
      const b = document.getElementById('f-menu-box');
      return !!b && !!b.querySelector('.wd-thumb .wi') && !!b.querySelector('.wd-t b');
    }), true);
  /* 누르면 식단표에서 쓰는 것과 **같은** 먹은 양 시트가 올라온다.
     재료를 통째로 고치던 시트는 뺐다 — 재료 사전 전체가 칩으로 깔려
     화면이 어지러웠고, 식단을 고치는 자리는 식단표 한 곳이면 된다. */
  await p.click('#f-menu-box'); await p.waitForTimeout(700);
  check('...누르면 먹은 양 시트가 열린다 (식단표와 같은 시트)',
    await p.evaluate(()=>document.getElementById('wn-ate-sheet').classList.contains('show')), true);
  await p.click('#wn-ate-seg [data-wn-atev="little"]');
  await p.click('#wn-ate-save'); await p.waitForTimeout(1600);
  s = await st();
  const rec3 = s.entries.filter(e => e.type === 'wean')[0];
  check('...고른 값이 그 기록에 저장된다', rec3.ate, 'little');
  check('...식단표는 안 건드린다',
    s.weanPlan[TODAY].meals[0].tops.some(x=>x.ing==='egg'), true);
  await mut('deleteEntry', { id: rec3.id, actor: '엄마' });
  await p.close();

  // ═══ 식단표 ═══
  p = await open('엄마');
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  /* 서브탭 줄이 눌리지 않고 제 높이를 지키는가 — 오늘 화면이 길면 세로
     flex가 이 줄부터 줄여서, 내용이 많은 날에만 탭이 안 눌렸다. */
  check('오늘 화면이 길어도 서브탭 줄이 안 눌린다',
    await p.evaluate(()=>document.querySelector('#wn-tabs button').getBoundingClientRect().height) > 40, true);
  await p.click('#wn-tabs button[data-wn="plan"]'); await p.waitForTimeout(700);
  /* 같은 메뉴가 이어지는 날이 있어야 '알약이 며칠을 가로지른다'를 물을 수
     있다. 책 식단은 사흘씩 같은 메뉴라 실제로 늘 그렇다. */
  await mut('setWeanDay', { date: dAdd(TODAY, 1), meals: MEALS, actor: '엄마' });
  /* 새로고침하면 이유식 화면이 닫힌다 — 폴링을 깨워 상태만 받아온다 */
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1500);
  await p.click('#wn-tabs button[data-wn="ings"]'); await p.waitForTimeout(400);
  await p.click('#wn-tabs button[data-wn="plan"]'); await p.waitForTimeout(700);

  /* 2026-10-19: 주 목록 → 월 캘린더. 같은 메뉴가 이어지면 알약 하나가
     며칠을 가로지른다 — 알약이 끊기는 자리가 메뉴가 바뀌는 날이다. */
  check('식단표가 달력으로 그려진다',
    await p.evaluate(()=>document.querySelectorAll('.wcal .wc-wk').length) >= 4, true);
  check('...이번 달에 알약이 선다',
    await p.evaluate(()=>document.querySelectorAll('.wc-pill').length) > 0, true);
  check('...오늘 날짜에 표시가 붙는다',
    await p.evaluate(()=>!!document.querySelector('.wc-dn.today')), true);
  /* 목업대로 년월은 왼쪽 정렬이고, 오른쪽에 며칠차 배지가 선다.
     달은 제목을 눌러 나오는 목록으로 고른다 — iOS 사파리가
     <input type="month">를 안 받으므로 네이티브 입력은 못 쓴다. */
  const monLabel = await p.evaluate(()=>document.querySelector('.wc-mo').textContent);
  check('...제목이 그 달이다', /\d{4}년 \d{1,2}월/.test(monLabel), true);
  check('...제목이 왼쪽에 선다',
    await p.evaluate(()=>{
      const a = document.querySelector('.wc-mo').getBoundingClientRect();
      const b = document.querySelector('.wcal').getBoundingClientRect();
      return a.left - b.left < 20;
    }), true);
  check('...오른쪽에 며칠차 배지가 있다',
    await p.evaluate(()=>{
      const e = document.querySelector('.wc-badge');
      return !!e && /시작/.test(e.textContent);
    }), true);
  const startMonth = await p.evaluate(()=>{
    const e = document.querySelector('.wc-pill');
    return e ? e.dataset.wnPick.slice(0, 7) : '';
  });
  await p.click('.wc-mo'); await p.waitForTimeout(500);
  const months = await p.evaluate(()=>[...document.querySelectorAll('[data-wn-mo]')].map(e=>e.dataset.wnMo));
  check('...달 목록이 뜬다', months.length > 1, true);
  const other = months.find(m => m !== startMonth);
  await p.click('[data-wn-mo="' + other + '"]'); await p.waitForTimeout(600);
  check('...고른 달로 넘어간다',
    await p.evaluate(()=>document.querySelector('.wc-mo').textContent) !== monLabel, true);
  /* 아래 검사들이 오늘이 보이는 달을 기대하므로 돌아온다 */
  await p.click('.wc-mo'); await p.waitForTimeout(400);
  await p.click('[data-wn-mo="' + startMonth + '"]'); await p.waitForTimeout(600);
  /* 같은 메뉴가 사흘씩 이어지는 식단이라, 알약 하나가 여러 날을 덮어야 한다.
     날마다 한 칸씩 끊기면 캘린더로 바꾼 뜻이 없다. */
  check('...같은 메뉴는 한 알약으로 이어진다',
    await p.evaluate(()=>[...document.querySelectorAll('.wc-pill')]
      .some(e=>/span [2-9]/.test(e.style.gridColumn))), true);
  /* 달력 바탕은 흰 카드다. 회색 바닥이 비쳐 보이면 목업과 전혀 다른 화면이
     된다 — 한 번 그렇게 내보냈다가 바로 지적받았다. */
  check('...달력 바탕이 흰 카드다',
    await p.evaluate(()=>{
      /* 목업에는 회색 바닥이 아예 없다 — 이유식 화면은 전체가 흰 종이다.
         한 번 회색 위에 얹어 내보냈다가 바로 지적받았다. */
      const m = getComputedStyle(document.getElementById('fp-wean'))
        .backgroundColor.match(/\d+/g).map(Number);
      return m[0] > 240 && m[1] > 240 && m[2] > 240;
    }), true);
  check('...상단 탭 밑줄이 이유식 초록이다',
    await p.evaluate(()=>{
      const b = document.querySelector('#wn-tabs button[aria-pressed="true"]');
      const c = getComputedStyle(b).borderBottomColor.match(/\d+/g).map(Number);
      return c[1] > c[0] + 40 && c[1] > c[2] + 40;   /* 파랑이 아니라 초록 */
    }), true);
  /* 알약에는 새 재료 띠를 붙이지 않는다. 90일 식단에선 열넷 중 열하나에
     붙어서 신호가 아니라 무늬가 됐다. */
  check('...알약에 군더더기 표시가 없다',
    await p.evaluate(()=>document.querySelectorAll('.wc-pill.is-new').length), 0);
  /* 캘린더를 보려고 더한 내일치는 여기서 다시 뺀다 — 안 빼면 아래 장보기
     계산(한 주치 합계)이 하루분 더 커진다. */
  await mut('deleteWeanDay', { date: dAdd(TODAY, 1), actor: '엄마' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1500);
  await p.click('#wn-tabs button[data-wn="ings"]'); await p.waitForTimeout(400);
  await p.click('#wn-tabs button[data-wn="plan"]'); await p.waitForTimeout(700);

  /* 날짜를 누르면 달력이 접히고 아래에 그날 끼니가 펼쳐진다 (목업 2번 화면).
     한 번 이 화면을 안 만들고 넘어갔다가 "목업이랑 달라"는 말을 들었다. */
  const pickDs = await p.evaluate(()=>{
    const e = document.querySelectorAll('.wc-pill');
    return e.length > 3 ? e[3].dataset.wnPick : (e[0] ? e[0].dataset.wnPick : '');
  });
  await p.click('[data-wn-pick="' + pickDs + '"]'); await p.waitForTimeout(700);
  check('날짜를 누르면 달력이 접힌다',
    await p.evaluate(()=>!!document.querySelector('.wcal.is-mini')), true);
  check('...고른 날에 고리가 붙는다',
    await p.evaluate(()=>!!document.querySelector('.wc-ring')), true);
  check('...아래에 그날 끼니 카드가 선다',
    await p.evaluate(()=>document.querySelectorAll('.wd-card').length) > 0, true);
  check('...카드에 끼니·그램·큐브 칸수가 적힌다',
    await p.evaluate(()=>/\d+g/.test((document.querySelector('.wd-t span')||{}).textContent||'')), true);
  check('...머리줄에 며칠차가 적힌다',
    await p.evaluate(()=>/일차/.test((document.querySelector('.wd-nav span')||{}).textContent||'')), true);
  /* › 로 다음 날 */
  const navWas = await p.evaluate(()=>document.querySelector('.wd-nav span').textContent);
  await p.click('[data-wn-pickadd="1"]'); await p.waitForTimeout(600);
  check('...화살표로 하루씩 넘긴다',
    await p.evaluate(()=>document.querySelector('.wd-nav span').textContent) !== navWas, true);
  /* 먹은 양은 끼니마다 따로 붙는다. 중기부터 하루 두 끼라 하루 한 줄로는
     "아침은 다 먹고 점심은 반 먹었다"를 적을 수가 없다. */
  /* 앞에서 › 로 하루 넘겼으므로 지금 펼쳐진 날을 화면에서 읽어 쓴다 */
  const mealDs = await p.evaluate(()=>{
    const e = document.querySelector('.wc-ring');
    return e ? e.parentElement.dataset.wnPick : '';
  });
  const mealPrev = (await st()).weanPlan[mealDs] || null;
  await mut('setWeanDay', { date: mealDs, actor: '엄마', meals: [
    { name: '아침', base: [{ ing: 'pgyo', g: 60 }], tops: [{ ing: 'beef', g: 15 }] },
    { name: '점심', base: [{ ing: 'pgl',  g: 60 }], tops: [{ ing: 'broccoli', g: 15 }] } ] });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);
  check('끼니마다 먹은 양 칩이 하나씩 있다',
    await p.evaluate(()=>[document.querySelectorAll('.wd-card').length,
                          document.querySelectorAll('.wd-ate').length]), [2, 2]);
  check('...아직 적지 않은 칩은 비어 있다',
    await p.evaluate(()=>[...document.querySelectorAll('.wd-ate')].every(e=>!e.classList.contains('on'))), true);
  /* 점심 칩을 눌러 반 · 45g */
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('[data-wn-ate]')]; if(b[1]) b[1].click(); });
  await p.waitForTimeout(700);
  check('...칩을 누르면 먹은 양 시트가 열린다 (전체화면으로 안 보낸다)',
    await p.evaluate(()=>document.getElementById('wn-ate-sheet').classList.contains('show')), true);
  await p.click('#wn-ate-seg [data-wn-atev="half"]');
  await p.fill('#wn-ate-g', '45');
  await p.click('#wn-ate-save'); await p.waitForTimeout(1800);
  check('...이유식 화면에 그대로 남는다',
    await p.evaluate(()=>document.getElementById('fp-wean').classList.contains('show')), true);
  /* 그램이 적혀 있으면 상태 라벨보다 그램이 먼저다 — 그게 더 정확한 말이다 */
  check('...칩에 그램이 먼저 나온다',
    await p.evaluate(()=>[...document.querySelectorAll('.wd-ate')].map(e=>e.textContent)),
    ['아직 안 먹였어요', '45g 먹음']);
  s = await st();
  const dayOf = iso => { const d = new Date(iso), z = x => (x < 10 ? '0' : '') + x;
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
  const wrec = s.entries.filter(e => e.type === 'wean' && dayOf(e.start) === mealDs);
  check('...적은 끼니 이름이 기록에 남는다', wrec.map(e => e.mealName), ['점심']);
  check('...그 끼니의 재료만 사본으로 붙는다',
    (wrec[0].ings || []).map(x => x.ing), ['pgl', 'broccoli']);
  await p.evaluate(()=>{ const x=document.querySelector('#fp-entry .fp-back'); if(x) x.click(); });
  await p.waitForTimeout(900);
  /* 지켜보는 중은 재료 탭과 같은 말씨의 카드 — 그림이 먼저 온다 */
  check('...지켜보는 중이 그림 카드로 선다',
    await p.evaluate(()=>{
      const c = document.querySelector('.wn-watch');
      return !!c && !!c.querySelector('.ww-ico .wi');
    }), true);
  /* 되돌린다 — 아래 장보기 계산이 이 날을 쓴다 */
  await mut('deleteEntry', { id: wrec[0].id, actor: '엄마' });
  /* 건드리기 전 그대로 되돌린다 — 아래 장보기(한 주치 합계)가 이 날을 센다 */
  if (mealPrev) await mut('setWeanDay', { date: mealDs, meals: mealPrev.meals, actor: '엄마' });
  else await mut('deleteWeanDay', { date: mealDs, actor: '엄마' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1600);

  /* 여닫는 길은 아래 손잡이 하나뿐이다 — 날짜를 다시 눌러도 접히지 않는다 */
  check('...손잡이가 있다',
    await p.evaluate(()=>!!document.querySelector('[data-wn-grab]')), true);
  /* 접힌 달력은 고른 날이 든 **한 주만** 그린다. 예전에는 250px짜리 스크롤
     상자였는데, 그 상자가 화면을 덮어 손가락이 거기 닿으면 페이지가 아니라
     상자 안이 스크롤돼서 아래 식단으로 내려갈 수가 없었다. */
  check('...접히면 한 주만 남는다',
    await p.evaluate(()=>document.querySelectorAll('.wcal.is-mini .wc-wk').length), 1);
  check('...안쪽에 따로 스크롤되는 상자가 없다',
    await p.evaluate(()=>{ const c=getComputedStyle(document.querySelector('.wcal.is-mini'));
      return c.overflowY === 'visible' || c.overflowY === 'clip'; }), true);
  await p.click('[data-wn-grab]'); await p.waitForTimeout(600);
  check('...손잡이를 누르면 달력이 펴진다',
    await p.evaluate(()=>!!document.querySelector('.wcal.is-mini')), false);
  /* 펴도 보고 있던 날은 놓지 않는다 — 예전엔 손잡이가 weanPick 을 비워서
     달력을 펴면 그날 식단이 같이 사라졌고, 다시 접을 길도 없었다. */
  check('...펴도 그날 식단은 그대로 있다',
    await p.evaluate(()=>!!document.querySelector('.wd-panel')), true);
  check('...달이 통째로 보인다',
    await p.evaluate(()=>document.querySelectorAll('.wcal .wc-wk').length > 1), true);
  check('...손잡이가 그대로 있다',
    await p.evaluate(()=>!!document.querySelector('[data-wn-grab].is-open')), true);
  await p.click('[data-wn-grab]'); await p.waitForTimeout(600);
  check('...한 번 더 누르면 다시 접힌다',
    await p.evaluate(()=>document.querySelectorAll('.wcal.is-mini .wc-wk').length), 1);
  await p.click('[data-wn-grab]'); await p.waitForTimeout(600);

  // ═══ 하루 고치기 ═══
  /* 알약 자체는 누를 수 없다 — 달력에서 손가락이 닿는 곳은 '날짜' 하나뿐이다.
     알약 위를 눌러도 그 날이 펼쳐지고, 고치기는 아래 끼니 카드로 들어간다. */
  check('알약은 버튼이 아니다',
    await p.evaluate(()=>document.querySelector('.wc-pill').tagName), 'DIV');
  await p.evaluate(()=>{ const t=[...document.querySelectorAll('.wc-pill')]
    .find(e=>e.dataset.wnPick === new Date().toISOString().slice(0,10)); if(t) t.click(); });
  await p.waitForTimeout(700);
  check('알약 위를 눌러도 그 날이 펼쳐진다',
    await p.evaluate(()=>!!document.querySelector('.wd-panel')), true);
  await p.click('.wd-card'); await p.waitForTimeout(700);
  check('끼니 카드를 누르면 하루 고치기가 열린다',
    await p.evaluate(()=>document.getElementById('fp-weanday').classList.contains('show')), true);
  check('...재료가 칩으로 나온다',
    await p.evaluate(()=>document.querySelectorAll('#fp-weanday-body .wn-ing:not(.add)').length), 4);
  await p.click('#fp-weanday-body .wn-ing:not(.add):has-text("소고기")');
  await p.waitForTimeout(600);
  await p.fill('#wn-ing-g', '25');
  await p.click('#wn-ing-save'); await p.waitForTimeout(600);
  check('재료 양을 고치면 칩이 바뀐다',
    await p.evaluate(()=>{ const c=[...document.querySelectorAll('#fp-weanday-body .wn-ing')]
      .find(x=>/소고기/.test(x.textContent)); return /25g/.test(c.textContent); }), true);
  await p.click('#fp-weanday-save'); await p.waitForTimeout(1500);
  s = await st();
  check('...저장하면 식단표에 남는다',
    (s.weanPlan[TODAY].meals[0].tops.find(x=>x.ing==='beef')||{}).g, 25);

  // ═══ 기간 단위 편집 ═══
  /* 편집 단위는 '하루'가 아니라 '식단 한 덩어리'다. 사흘 같은 메뉴를
     먹이려면 세 번 입력하는 게 아니라 기간만 3일로 둔다. 덩어리는 쌓인
     날들 위에서 그때그때 계산하는 것이라(연달아 + 메뉴가 같음) 저장은
     여전히 하루 단위다 — 90일치가 통째로 밀릴 길이 없다. */
  const spanTxt = () => p.evaluate(()=>{
    const e = document.querySelector('#fp-weanday-body .wn-span');
    return e ? e.textContent.replace(/\s+/g,' ').trim() : null; });
  const setSpan = async (which, v) => {
    await p.fill('#wn-span-' + which, v);
    await p.waitForTimeout(400);
  };
  /* 식단표를 처음부터 다시 — 첫 화면 이유식 띠가 입구다 */
  const reopenPlan = async () => {
    await p.reload(); await p.waitForTimeout(1800);
    await p.click('#wean-row'); await p.waitForTimeout(800);
  };
  /* 오늘 알약을 눌러 그날을 펼친다 */
  const pickToday = async () => {
    await p.evaluate(()=>{ const t=[...document.querySelectorAll('[data-wn-pick]')]
      .find(e=>e.dataset.wnPick === new Date().toISOString().slice(0,10)); if(t) t.click(); });
    await p.waitForTimeout(800);
  };
  /* 편집 화면이 아직 열려 있다 — 방금 저장했으니 다시 들어간다 */
  await p.click('.wd-card'); await p.waitForTimeout(700);
  check('기간 칸이 있다', /시작/.test(await spanTxt()), true);
  check('...끼니 추가 버튼은 없다',
    await p.evaluate(()=>!!document.querySelector('#fp-weanday-body [data-wn-addmeal]')), false);

  /* 늘리기 — 오늘부터 이틀 뒤까지 */
  const T2 = dAdd(TODAY, 2);
  await setSpan('to', T2);
  check('기간을 늘리면 날수가 센다', /3일/.test(await spanTxt()), true);
  check('...저장 버튼이 3일을 말한다',
    /3일/.test(await p.evaluate(()=>document.getElementById('fp-weanday-save').textContent)), true);
  await p.click('#fp-weanday-save'); await p.waitForTimeout(1600);
  s = await st();
  check('...사흘에 한꺼번에 들어간다',
    [TODAY, dAdd(TODAY,1), T2].map(d=>(((s.weanPlan[d]||{}).meals||[])[0]||{}).name || null),
    ['아침','아침','아침']);
  check('...세 날 모두 같은 양이다',
    [TODAY, dAdd(TODAY,1), T2].map(d=>(s.weanPlan[d].meals[0].tops.find(x=>x.ing==='beef')||{}).g),
    [25,25,25]);

  /* 줄이기 — 덩어리에서 빠진 날은 비어야 한다 */
  await p.click('.wd-card'); await p.waitForTimeout(700);
  check('덩어리로 열린다 (사흘)', /3일/.test(await spanTxt()), true);
  await setSpan('to', dAdd(TODAY, 1));
  await p.click('#fp-weanday-save'); await p.waitForTimeout(1600);
  s = await st();
  check('기간을 줄이면 빠진 날이 빈다', !s.weanPlan[T2], true);
  check('...남은 이틀은 그대로',
    [TODAY, dAdd(TODAY,1)].every(d=>!!s.weanPlan[d]), true);

  /* 겹침 — 이미 식단이 있는 날 위로 늘리면 조용히 덮지 않고 먼저 묻는다.
     90일치가 한 번에 밀리는 사고를 막는 유일한 지점이다. */
  await mut('setWeanSpan', { from: dAdd(TODAY,4), to: dAdd(TODAY,4), actor:'엄마',
    meal: { name:'아침', base:[{ing:'pgyo',g:50}], tops:[{ing:'broccoli',g:10}] } });
  await reopenPlan(); await pickToday();
  await p.click('.wd-card'); await p.waitForTimeout(700);
  await setSpan('to', dAdd(TODAY, 5));
  check('겹치면 경고가 뜬다',
    await p.evaluate(()=>!!document.querySelector('#fp-weanday-body .wn-alert.warn')), true);
  check('...기간 칸도 경고색이 된다',
    await p.evaluate(()=>document.querySelector('#fp-weanday-body .wn-span')
      .classList.contains('warn')), true);
  check('...빈 날만 채우기와 덮어쓰기를 고르게 한다',
    await p.evaluate(()=>document.querySelectorAll('#wn-span-mode [data-wn-mode]').length), 2);

  /* 빈 날만 채우기 — 이미 있는 날은 손대지 않는다 */
  await p.click('#wn-span-mode [data-wn-mode="fill"]'); await p.waitForTimeout(400);
  await p.click('#fp-weanday-save'); await p.waitForTimeout(1800);
  s = await st();
  check('빈 날만 채우면 원래 식단은 살아 있다',
    (s.weanPlan[dAdd(TODAY,4)].meals[0].tops[0]||{}).ing, 'broccoli');
  check('...빈 날들은 채워졌다',
    [2,3,5].map(n=>!!s.weanPlan[dAdd(TODAY,n)]), [true,true,true]);

  /* 이 날만 따로 떼기 + 하루만 지우기 */
  await pickToday();
  await p.click('.wd-card'); await p.waitForTimeout(700);
  check('덩어리가 길면 이 날만 떼는 길이 있다',
    await p.evaluate(()=>!!document.querySelector('#fp-weanday-body [data-wn-split]')), true);
  await p.click('#fp-weanday-body [data-wn-delday]'); await p.waitForTimeout(500);
  await p.click('#confirm-yes'); await p.waitForTimeout(1600);
  s = await st();
  check('하루만 지우면 그 날만 빈다', !s.weanPlan[TODAY], true);
  check('...나머지 날은 그대로', !!s.weanPlan[dAdd(TODAY,1)], true);

  /* 덩어리 전체 지우기 — 머리말의 휴지통 */
  await pickToday();
  await p.evaluate(()=>{ const d=document.querySelector('[data-wn-pickadd="1"]'); if(d) d.click(); });
  await p.waitForTimeout(600);
  await p.click('.wd-card'); await p.waitForTimeout(700);
  await p.click('#fp-weanday-del'); await p.waitForTimeout(500);
  await p.click('#confirm-yes'); await p.waitForTimeout(1600);
  s = await st();
  check('덩어리를 지우면 그 기간이 다 빈다',
    [1,2,3].map(n=>!!s.weanPlan[dAdd(TODAY,n)]), [false,false,false]);
  check('...다른 덩어리는 살아 있다', !!s.weanPlan[dAdd(TODAY,4)], true);

  /* 새 식단은 하루부터 — 기간은 그녀가 정한다 */
  await p.click('#wn-add'); await p.waitForTimeout(800);
  check('새 식단은 1일로 열린다', /1일/.test(await spanTxt()), true);
  check('...빈 화면이다 (기존 재료가 안 보인다)',
    await p.evaluate(()=>document.querySelectorAll('#fp-weanday-body .wn-ing:not(.add)').length), 0);
  check('...재료 없이 저장하면 막는다',
    await p.evaluate(async ()=>{ document.getElementById('fp-weanday-save').click();
      await new Promise(r=>setTimeout(r,400));
      return document.getElementById('fp-weanday').classList.contains('show'); }), true);
  await p.click('#fp-weanday-back'); await p.waitForTimeout(600);
  /* 식단표를 원래대로 — 뒤 시험들이 오늘 식단을 본다 */
  await mut('deleteWeanSpan', { from: TODAY, to: dAdd(TODAY,6), name:'아침', actor:'엄마' });
  await mut('setWeanSpan', { from: TODAY, to: TODAY, actor: '엄마',
    meal: { name:'아침', base:[{ing:'pgyo',g:40}],
            tops:[{ing:'beef',g:25},{ing:'zucchini',g:10},{ing:'egg',g:10}] } });
  await reopenPlan();

  // ═══ 장보기 ═══
  await p.click('#wn-tabs button[data-wn="shop"]'); await p.waitForTimeout(800);
  const qty = async (ko) => p.evaluate((k)=>{
    const row=[...document.querySelectorAll('.wn-buy')].find(x=>x.textContent.indexOf(k)>=0);
    return row ? row.querySelector('.wn-qty').textContent.trim() : null; }, ko);
  check('장보기가 식단표에서 계산된다', await qty('소고기'), '25 g');
  check('...늘 이만큼이 걸린 달걀은 개 단위로 나온다', await qty('달걀'), '2 개');
  check('...늘 이만큼 표시가 붙는다',
    await p.evaluate(()=>{ const row=[...document.querySelectorAll('.wn-buy')]
      .find(x=>x.textContent.indexOf('달걀')>=0); return !!row.querySelector('.pay-chip'); }), true);

  /* 담기 체크 */
  await p.click('.wn-buy:has-text("소고기") .wn-check');
  await p.waitForTimeout(1200);
  s = await st();
  check('담기를 누르면 표시가 남는다',
    (s.weanShop.find(x=>x.ing==='beef')||{}).checked, true);
  check('...주 키는 월요일이다', (s.weanShop.find(x=>x.ing==='beef')||{}).week, weekOf(TODAY));

  /* 이번 주만 고치기 */
  await p.click('.wn-buy:has-text("소고기") .wn-qty');
  await p.waitForTimeout(700);
  check('양을 누르면 시트가 열린다',
    await p.evaluate(()=>document.getElementById('wn-amt-sheet').classList.contains('show')), true);
  check('...계산값을 먼저 보여준다',
    await p.evaluate(()=>document.getElementById('wn-amt-calc').textContent), '25 g');
  await p.fill('#wn-amt-input', '300');
  await p.click('#wn-amt-save'); await p.waitForTimeout(1500);
  check('이번 주만 고친 값이 반영된다', await qty('소고기'), '300 g');
  s = await st();
  check('...차이로만 저장된다 (재료의 늘 이만큼은 안 건드린다)',
    [(s.weanShop.find(x=>x.ing==='beef')||{}).amount, (s.weanIngs.find(g=>g.id==='beef')||{}).always],
    [300, null]);

  /* 늘 이만큼 */
  await p.click('.wn-buy:has-text("소고기") .wn-qty');
  await p.waitForTimeout(700);
  await p.fill('#wn-amt-input', '200');
  await p.click('#wn-amt-scope [data-scope="always"]');
  await p.click('#wn-amt-save'); await p.waitForTimeout(2000);
  s = await st();
  check('늘 이만큼은 재료에 저장된다', (s.weanRaw.find(g=>g.id==='beef')||{}).always, 200);
  check('...이번 주만 고쳤던 값은 치운다 (둘이 남으면 누가 이기는지 알 수 없다)',
    (s.weanShop.find(x=>x.ing==='beef')||{}).amount, undefined);
  /* 다음 주에도 살아남는가. 단, 그 주 식단에 소고기가 있어야 목록에 나온다 —
     안 먹이는 주에 사러 가지는 않으니까. 그래서 다음 주에 하루를 넣고 본다. */
  await mut('setWeanDay', { date: dAdd(weekOf(TODAY), 8), meals: MEALS, actor: '엄마' });
  /* 서버에 넣자마자 다음 주로 넘기면 폰은 아직 그 날을 모른다. 폴링은 25초라
     기다리지 말고, 진짜 폰이 하는 것과 같은 일을 시킨다 — 화면으로 돌아오면
     resyncNow가 즉시 받아 온다. 이쪽이 실제로 중요한 경로이기도 하다. */
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1400);
  await p.click('.wn-weeknav [data-wn-week="1"]'); await p.waitForTimeout(900);
  check('...다음 주에도 그 값이 나온다', await qty('소고기'), '200 g');
  check('...늘 이만큼이 없는 재료는 그 주 계산값 그대로', await qty('애호박'), '10 g');
  await p.click('.wn-weeknav [data-wn-week="-1"]'); await p.waitForTimeout(700);

  // ═══ 장보기에 직접 추가 ═══
  /* 식단표에 없는 것(큐브 트레이)도 목록에 들어가야 한다 */
  /* '+ 직접 추가' 텍스트 버튼은 뗐다 — 우하단 FAB 이 그 화면에서 '하나 더'가
     뜻하는 일을 한다(장보기에서는 살 것, 재고에서는 큐브, 재료에서는 새 재료). */
  check('장보기에서 FAB 이 직접 추가를 연다',
    await p.evaluate(()=>!!document.getElementById('wn-add')), true);
  await p.click('#wn-add'); await p.waitForTimeout(700);
  check('...직접 추가 시트가 열린다',
    await p.evaluate(()=>document.getElementById('wn-extra-sheet').classList.contains('show')), true);
  await p.fill('#wn-extra-name', '이유식 큐브 트레이');
  await p.fill('#wn-extra-qty', '2');
  await p.click('#wn-extra-unit [data-val="ea"]');
  await p.click('#wn-extra-save'); await p.waitForTimeout(1600);
  check('...사전에 없는 것도 줄이 선다', await qty('이유식 큐브 트레이'), '2 개');
  s = await st();
  check('...직접 넣은 줄로 저장된다',
    [(s.weanShop.find(x=>x.ing==='이유식 큐브 트레이')||{}).extra,
     (s.weanShop.find(x=>x.ing==='이유식 큐브 트레이')||{}).unit], [true, 'ea']);

  // ═══ 재고 ═══
  await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(800);
  check('재고에 재료별 칸 수가 나온다',
    await p.evaluate(()=>document.querySelectorAll('.wn-cube').length) >= 4, true);
  await p.click('.wn-cube:has-text("소고기") [data-d="1"]');
  await p.waitForTimeout(1200);
  s = await st();
  check('+ 를 누르면 한 칸 는다', (s.weanCubes.find(c=>c.ing==='beef')||{}).n, 6);
  check('...재고 줄마다 만든 날이 적힌다',
    await p.evaluate(()=>[...document.querySelectorAll('.wn-cube')]
      .every(x=>/\d\d\/\d\d 만든 것/.test(x.textContent))), true);
  /* '+ 큐브 만들었어요' 텍스트 버튼도 뗐다 — 재고 화면의 FAB 이 그 일을 한다 */
  await p.click('#wn-add'); await p.waitForTimeout(700);
  await p.fill('#wn-cube-n', '10');
  await p.click('#wn-cube-ings button:text-is("청경채")');
  await p.click('#wn-cube-save'); await p.waitForTimeout(1800);
  s = await st();
  const bok = s.weanCubes.filter(c=>c.ing==='bokchoy');
  check('큐브를 만들면 그만큼 는다', bok.reduce((n,c)=>n+c.n,0), 10);
  check('...만든 날이 찍힌다', bok[0].madeOn, TODAY);

  /* 큐브 줄에는 '무엇으로 만드는지'가 적힌다 — 쌀오트밀죽 = 쌀 + 오트밀.
     그게 재료(사 오는 것)와 큐브(얼리는 것)를 가른 이유 전체다. */
  await mut('setWeanCube', { ing: 'pgyo', n: 4, actor: '엄마' });
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(1500);
  check('큐브 줄에 무엇으로 만드는지가 적힌다',
    await p.evaluate(()=>{
      const r = [...document.querySelectorAll('.wn-cube')].find(x=>x.textContent.indexOf('쌀오트밀죽')>=0);
      return r ? r.querySelector('.wn-madeof').textContent.trim() : null;
    }), '쌀 + 오트밀');
  /* 이름을 누르면 그 큐브를 고친다 — 한 칸 용량과 무엇으로 만드는지 */
  await p.click('.wn-cube:has-text("쌀오트밀죽") [data-wn-cubedef]');
  await p.waitForTimeout(700);
  check('큐브 이름을 누르면 고치기가 열린다',
    await p.evaluate(()=>document.getElementById('wn-cubedef-sheet').classList.contains('show')), true);
  check('...무엇으로 만드는지가 골라져 있다',
    await p.evaluate(()=>[...document.querySelectorAll('#wcd-raw button[aria-pressed="true"]')]
      .map(e=>e.dataset.wcdRaw)), ['r_rice', 'r_oat']);
  await p.click('#wcd-raw button[data-wcd-raw="r_brown"]');
  await p.fill('#wcd-cubeg', '45');
  await p.click('#wn-cubedef-save'); await p.waitForTimeout(1800);
  s = await st();
  check('...고치면 저장된다',
    [(s.weanIngs.find(g=>g.id==='pgyo')||{}).raw, (s.weanIngs.find(g=>g.id==='pgyo')||{}).cubeG],
    [['r_rice','r_oat','r_brown'], 45]);
  await p.close();

  // ═══ 만든 날이 다르면 덩어리도 다르다 ═══
  /* 9/28에 만든 것과 9/30에 만든 것을 한 줄로 합치면, 앞의 것이 2주를
     넘겨도 아무 말이 없다. 먹일 때는 오래된 덩어리부터 빠져야 한다. */
  for (const c of (await st()).weanCubes) await mut('setWeanCube', { ing: c.ing, n: 0, actor: '엄마' });
  await mut('addWeanCubes', { ing: 'beef', n: 3, madeOn: dAdd(TODAY, -20), actor: '엄마' });
  await mut('addWeanCubes', { ing: 'beef', n: 5, madeOn: TODAY, actor: '엄마' });
  s = await st();
  const beefC = s.weanCubes.filter(c=>c.ing==='beef').sort((a,b)=>a.madeOn<b.madeOn?-1:1);
  check('만든 날이 다르면 덩어리가 둘로 남는다', beefC.map(c=>c.n), [3, 5]);
  await mut('addEntry', { type:'wean', start: new Date().toISOString(), author:'엄마',
    ings:[{ing:'beef',g:10}] });
  s = await st();
  check('...먹이면 오래된 덩어리부터 빠진다',
    s.weanCubes.filter(c=>c.ing==='beef').sort((a,b)=>a.madeOn<b.madeOn?-1:1).map(c=>c.n), [2, 5]);
  p = await open('엄마');
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(700);
  await p.click('#wn-tabs button[data-wn="cubes"]'); await p.waitForTimeout(800);
  /* 만든 날마다 한 줄 — 9/10 만든 2칸, 9/30 만든 5칸이 따로 선다 */
  check('...화면에 만든 날마다 한 줄이 선다',
    await p.evaluate(()=>[...document.querySelectorAll('.wn-cube')]
      .filter(x=>x.textContent.indexOf('소고기')>=0)
      .map(x=>x.querySelector('.wn-step b').textContent.trim())), ['2', '5']);
  check('...오래된 덩어리에만 지났다고 적힌다',
    await p.evaluate(()=>[...document.querySelectorAll('.wn-cube')]
      .filter(x=>x.textContent.indexOf('소고기')>=0)
      .map(x=>/지남/.test(x.textContent))), [true, false]);
  /* 그 줄의 -/+ 는 그 덩어리만 건드린다 — 합계에서 오래된 것부터 빠지면 안 된다 */
  await p.click('.wn-cube:has-text("소고기"):last-of-type [data-d="1"]');
  await p.waitForTimeout(1300);
  check('...줄의 +는 그 날짜의 덩어리만 늘린다',
    (await st()).weanCubes.filter(c=>c.ing==='beef')
      .sort((a,b)=>a.madeOn<b.madeOn?-1:1).map(c=>c.n), [2, 6]);
  /* '몇 칸 남았나'가 아니라 '무엇이 먼저 떨어지나' — 53칸이라는 합계는
     재료가 다른 것들을 더한 값이라 그렇게 먹을 수 있는 날이 하루도 없다 */
  check('먼저 떨어지는 재료를 짚어준다',
    await p.evaluate(()=>document.querySelector('#wn-body .t-money.big').textContent.trim().length) > 0, true);
  await p.close();
  p = await open('엄마');
  await p.click('#btn-settings'); await p.waitForTimeout(600);
  await p.click('#set-wean'); await p.waitForTimeout(700);

  // ═══ 재료 ═══
  await p.click('#wn-tabs button[data-wn="ings"]'); await p.waitForTimeout(800);
  /* 재료 탭은 '사 오는 것' 37가지를 종류별 격자로 보여준다 — 쌀죽이 아니라 쌀 */
  check('재료 격자가 그려진다',
    await p.evaluate(()=>document.querySelectorAll('.gcell[data-wn-ing]').length), 37);
  check('...종류별로 묶인다',
    await p.evaluate(()=>[...document.querySelectorAll('.wn-cat h3')].map(e=>e.textContent)),
    ['곡류','야채류','단백질류','과일류']);
  check('...쌀죽이 아니라 쌀이다',
    await p.evaluate(()=>[...document.querySelectorAll('.gcell span')].map(e=>e.textContent).indexOf('쌀') >= 0), true);
  await p.click('[data-wn-ing]:has-text("소고기")');
  await p.waitForTimeout(700);
  check('재료 상세가 열린다',
    await p.evaluate(()=>document.getElementById('fp-weaning').classList.contains('show')), true);
  check('...늘 이만큼이 채워져 있다', await p.evaluate(()=>document.getElementById('wi-always').value), '200');
  await p.fill('#wi-vi', 'thịt bò');
  await p.click('#fp-weaning-save'); await p.waitForTimeout(1500);
  s = await st();
  check('베트남어 이름이 저장된다', (s.weanRaw.find(g=>g.id==='beef')||{}).vi, 'thịt bò');
  await p.close();

  // ═══ 내니 폰 ═══
  p = await open('내니', 'vi');
  check('내니 폰에도 띠에 그림이 선다',
    await p.evaluate(()=>document.querySelectorAll('#wean-row .wn-it').length), 4);
  /* 식단이 서 있는 날에는 띠에 '이유식' 제목을 안 적는다(그림이 말한다).
     그러니 베트남어인지는 재료 이름으로 본다 — 내니가 실제로 읽는 글자다. */
  check('...띠에 제목을 적지 않는다',
    await p.evaluate(()=>document.getElementById('wn-dn-line').hidden), true);
  check('...재료 이름이 베트남어',
    /thịt bò/.test(await p.evaluate(()=>document.getElementById('wn-meals').textContent)), true);
  /* '보인다'는 건 hidden이 아니라는 것만으로는 모자라다 — 조상이 숨으면
     글자는 남고 상자는 사라진다. 실제로 그런 적이 있다(.announce-stack).
     눌러서 열리는지까지가 '보인다'이다. */
  check('...띠가 실제로 화면에 자리를 차지한다',
    await p.evaluate(()=>{ const r=document.getElementById('wean-row')
      .getBoundingClientRect(); return r.width > 0 && r.height > 0; }), true);
  await p.click('#wean-row'); await p.waitForTimeout(700);
  check('내니도 이유식 화면을 연다',
    await p.evaluate(()=>document.getElementById('fp-wean').classList.contains('show')), true);
  check('...내니 폰에는 + 가 없다',
    await p.evaluate(()=>document.getElementById('wn-add').hidden), true);
  await p.click('#wn-tabs button[data-wn="plan"]'); await p.waitForTimeout(700);
  await p.click('.wc-pill');
  await p.waitForTimeout(600);
  check('...내니는 식단표를 못 연다',
    await p.evaluate(()=>document.getElementById('fp-weanday').classList.contains('show')), false);
  await p.close();

  /* 서버도 막는다 — 화면만 막으면 오래된 페이지 하나가 뚫는다 */
  check('서버가 내니의 식단표 쓰기를 막는다',
    (await mut('setWeanDay', { date: TODAY, meals: MEALS, actor: '내니' })).status, 403);
  check('...장보기도', (await mut('setWeanShop', { week: TODAY, ing:'beef', amount: 1, actor:'내니' })).status, 403);
  check('...재료도', (await mut('setWeanIng', { id:'beef', ko:'X', actor:'내니' })).status, 403);
  check('...큐브도', (await mut('setWeanCube', { ing:'beef', n: 99, actor:'내니' })).status, 403);

  /* 식단표를 고쳐도 이미 남은 기록의 사본은 안 흔들린다 */
  await mut('addEntry', { type:'wean', start: new Date().toISOString(), author:'엄마',
    menu:'쌀오트밀죽 40g · 소고기', ings:[{ing:'beef',g:10}] });
  await mut('setWeanDay', { date: TODAY, meals: [{ name:'아침', base:[{ing:'pgy',g:40}], tops:[] }], actor:'엄마' });
  s = await st();
  check('식단표를 고쳐도 남은 기록의 사본은 그대로',
    (s.entries.filter(e=>e.type==='wean')[0]||{}).menu, '쌀오트밀죽 40g · 소고기');

  await clearWean();
  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
