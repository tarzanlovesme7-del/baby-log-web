/* 기록 상세 — 흰 종이 한 장.

   못 박는 것:
     - 바닥은 흰색이고, 테두리는 '값을 고르는 부품'에만 있다.
     - 날짜·시작·종료는 맨 윗줄 한 줄로 접혀 있고, 눌러서 펼친다.
     - 숫자는 전부 같은 부품(눈금 고르개)이다 — 분유 ml, 이유식 g, 체온 ℃.
       체온은 0.1 단위라 눈금이 부동소수점으로 어긋나면 안 된다.
     - 똥 상태는 응가가 있었을 때만 묻는다. 쉬로 바꾸면 값도 비워진다.
     - 투약은 약 이름(영문 그대로)과 양을 따로 든다 — 양을 메모에 글로 적게
       두면 '3,4'처럼 소수점이 언어마다 갈린다(베트남어는 쉼표가 소수점).
     - 사진은 모든 기록에 붙고, 메모·일기와 같은 저장소를 쓴다.
     - 바닥 왼쪽 버튼의 말은 종류마다 다르다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t, p){ const r = await fetch(BASE + '/api/mutate', { method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:t, payload:p }) });
  return { status: r.status, body: await r.json().catch(()=>({})) }; }
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json();
  const d = j.data || j; d.entries = d.entries || []; return d; };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('bbl_author', '엄마'); localStorage.setItem('bbl_lang', 'ko');
  });

  /* 깨끗한 바닥에서 — 종류별로 한 건씩 */
  let s = await st();
  for (const e of s.entries) await mut('deleteEntry', { id: e.id, actor: '엄마' });
  const now = new Date(); now.setHours(10, 30, 0, 0);
  const iso = now.toISOString();
  await mut('addEntry', { type:'feed',   start: iso, end: iso, amount: 120, author:'엄마' });
  await mut('addEntry', { type:'diaper', start: iso, end: iso, diaper:'dirty', author:'내니' });
  await mut('addEntry', { type:'temp',   start: iso, end: iso, temp: 37.2, author:'아빠' });
  await mut('addEntry', { type:'med',    start: iso, end: iso, author:'엄마' });
  const later = new Date(now.getTime() + 90*60000).toISOString();
  await mut('addEntry', { type:'sleep',  start: iso, end: later, sleepKind:'nap', author:'아빠' });

  await p.goto(BASE + '/');
  await p.waitForTimeout(1900);

  /* 줄의 한가운데가 아니라 **시각 칸**을 누른다. 사진이 붙은 줄은 한가운데가
     섬네일이고, 섬네일을 누르면 기록이 아니라 사진이 열린다(2026-10-26). */
  const openRow = async (ko) => {
    await p.click(`.entry-row:has-text("${ko}") .e-time`);
    await p.waitForTimeout(800);
  };
  const back = async () => { await p.click('#fp-entry-back'); await p.waitForTimeout(500); };
  const txt = (sel) => p.evaluate((q)=>{ const e=document.querySelector(q); return e?e.textContent.replace(/\s+/g,' ').trim():null; }, sel);

  // ═══ 흰 종이 ═══
  await openRow('분유');
  check('기록 상세 바닥이 흰색이다', await p.evaluate(()=>{
    const d=document.createElement('div'); d.style.background='var(--surface)';
    document.body.appendChild(d); const want=getComputedStyle(d).backgroundColor; d.remove();
    return getComputedStyle(document.getElementById('fp-entry')).backgroundColor === want;
  }), true);
  /* 제목은 회색 작은 글씨 — 칸마다 흰 카드를 쌓지 않는다 */
  check('...제목이 회색 작은 글씨다', await p.evaluate(()=>{
    const h=document.querySelector('#fp-entry-body .ent-h');
    const cs=getComputedStyle(h);
    return !!h && parseFloat(cs.fontSize) <= 14;
  }), true);

  // ═══ 언제 / 누가 ═══
  check('맨 윗줄에 언제와 누가가 있다', /10:30/.test(await txt('.ent-when')) && /엄마/.test(await txt('.ent-when')), true);
  /* 시각은 칸 하나다. 예전에는 '시작 시간'·'종료 시간'·'언제부터 언제까지'
     셋이 같이 서 있었다 — 앞의 둘은 편집기고 마지막은 요약인데 둘 다 띄워
     놨던 탓이다. */
  check('...시각 칸은 하나다', await p.evaluate(()=>
    [document.querySelectorAll('.tbox').length,
     !!document.getElementById('f-when-box'),
     !!document.getElementById('f-times')]), [1, false, false]);
  check('...평소엔 눈금자가 닫혀 있다', await p.evaluate(()=>
    ['start','end'].every(k=>{ const e=document.getElementById('f-tedit-'+k); return !e || e.hidden; })), true);
  /* 날짜는 접어 둔다 — iOS 가 date 칸을 자기 컨트롤로 그리는데 그 폭이
     상자를 넘겨 화면이 가로로 밀렸다. 고칠 일도 드물다. */
  check('...날짜는 접혀 있다',
    await p.evaluate(()=>document.getElementById('f-date-box').hidden), true);
  check('...맨 윗줄을 누르면 날짜가 나온다', await p.evaluate(async ()=>{
    document.getElementById('f-when').click();
    await new Promise(r=>setTimeout(r,250));
    return !document.getElementById('f-date-box').hidden && !!document.getElementById('f-date');
  }), true);
  /* 어느 폭에서도 가로로 밀리지 않는다 */
  check('...가로 스크롤이 생기지 않는다', await p.evaluate(()=>{
    const b2 = document.getElementById('fp-entry-body');
    return b2.scrollWidth <= b2.clientWidth + 0.5 &&
           document.documentElement.scrollWidth <= window.innerWidth + 0.5;
  }), true);
  /* 한쪽을 누르면 그 쪽만 열린다 — 편집기는 화면에 언제나 하나뿐 */
  await p.click('[data-tslot="start"]'); await p.waitForTimeout(400);
  check('...시각을 누르면 그 쪽만 열린다', await p.evaluate(()=>
    [!document.getElementById('f-tedit-start').hidden,
     document.getElementById('f-tedit-end').hidden,
     document.querySelector('[data-tslot="start"]').classList.contains('on')]), [true, true, true]);
  /* 눈금에 진짜 시각이 적힌다 — 예전엔 '−3 −2 −1 0 +1'(지금 값에서 몇 분)
     이라 어느 눈금이 몇 시인지 읽을 수가 없었다 */
  check('...눈금에 진짜 시각이 적힌다', await p.evaluate(()=>
    [...document.querySelectorAll('#f-tedit-start .tv.maj b')]
      .map(x=>x.textContent).filter(Boolean).every(x=>/^\d{1,2}:[0-5]\d$/.test(x))), true);
  /* 10분마다 — 30분마다로는 한 화면에 시각이 한 개뿐이라 지금 몇 시 언저리인지
     눈으로 못 짚는다(2026-10-20, 한 칸 4px→12px 과 함께) */
  check('...10분마다 적힌다', await p.evaluate(()=>{
    const v=[...document.querySelectorAll('#f-tedit-start .tv.maj b')].map(x=>x.textContent).filter(Boolean);
    return v.length > 2 && v.every(x=>/:[0-5]0$/.test(x)); }), true);
  /* 한 칸 12px — 4px이던 때는 엄지를 조금만 밀어도 10분이 날아갔다 */
  check('...한 칸은 12px이다', await p.evaluate(()=>{
    const c=document.querySelector('#f-tedit-start .tv[data-m]');
    return c ? Math.round(c.getBoundingClientRect().width) : 0; }), 12);
  check('...−10분과 +10분이 둘 다 있다', await p.evaluate(()=>
    [...document.querySelectorAll('#f-tedit-start [data-scrub-nudge]')].map(b=>b.dataset.scrubNudge).sort()),
    ['-10','10']);
  check('...지금 버튼은 끝말 줄에 있다', await p.evaluate(()=>
    !!document.querySelector('#f-tedit-start .scrub-ends [data-scrub-now]')), true);
  /* 다시 누르면 접힌다 — 눈금자가 자리를 많이 쓴다 */
  await p.click('[data-tslot="start"]'); await p.waitForTimeout(350);
  check('...다시 누르면 접힌다',
    await p.evaluate(()=>document.getElementById('f-tedit-start').hidden), true);

  // ═══ 분유 — 같은 숫자 부품 + 오늘 먹은 양 ═══
  check('분유는 ml 눈금 고르개다', await p.evaluate(()=>{
    const box=document.querySelector('.amt [data-scrub="ruler"]');
    return box && box.dataset.for==='f-amount' && box.dataset.step==='5';
  }), true);
  check('...눈금 끝이 1회 기준을 말한다', /1회 기준/.test(await txt('.amt-ends')), true);
  check('...오늘 먹은 양과 목표가 있다', await p.evaluate(()=>{
    const g=document.querySelector('.ent-goal');
    return !!g && !!g.querySelector('.bar i');
  }), true);
  check('...오늘 먹은 양이 실제 합계다', /120/.test(await txt('.ent-goal b')), true);
  await back();

  // ═══ 기저귀 — 똥 상태는 응가일 때만 ═══
  await openRow('대변');
  check('기저귀는 칩 줄이다 (세그먼트가 아니다)', await p.evaluate(()=>
    !!document.querySelector('#f-diaper .chip') && !document.querySelector('#f-diaper.seg')), true);
  check('...응가면 똥 상태를 묻는다',
    await p.evaluate(()=>document.getElementById('f-poop-wrap').hidden), false);
  check('...똥 상태가 다섯 개다',
    await p.evaluate(()=>document.querySelectorAll('#f-poop .chip').length), 5);
  /* 제목이 제 부품에 덮이지 않는가.

     제목(.ent-h)의 아래 여백은 -11px 이다 — .fp-body 의 gap:20 과 더해서
     9px 이 되라는 뜻이다. '똥 상태'는 응가일 때만 묻느라 감싸개 안에
     들어 있었고, 감싸개 안에는 그 gap 이 없어서 칩 줄이 제목 위로 11px
     올라타 글자를 덮었다(2026-10-25). 색이 같아 눈으로는 잘 안 보인다.
     그래서 **모든** 제목에 대해 바로 아래 부품과의 간격을 잰다. */
  check('제목이 아래 부품에 덮이지 않는다', await p.evaluate(()=>{
    const bad = [];
    document.querySelectorAll('#fp-entry-body .ent-h').forEach(h => {
      const n = h.nextElementSibling;
      if (!n || n.hidden || !n.getClientRects().length) return;
      const gap = Math.round(n.getBoundingClientRect().top - h.getBoundingClientRect().bottom);
      if (gap < 4) bad.push([h.textContent.trim(), gap]);
    });
    return bad;
  }), []);
  await p.evaluate(()=>document.querySelector('#f-poop [data-val="mucus"]').click());
  await p.click('#fp-entry-save'); await p.waitForTimeout(1400);
  s = await st();
  check('똥 상태가 저장된다', s.entries.filter(e=>e.type==='diaper')[0].poop, 'mucus');

  await openRow('대변');
  check('다시 열면 고른 것이 걸려 있다',
    await p.evaluate(()=>document.querySelector('#f-poop [aria-pressed="true"]').dataset.val), 'mucus');
  /* 쉬로 바꾸면 대답할 수 없는 질문이 화면에 남지 않는다 */
  await p.evaluate(()=>document.querySelector('#f-diaper [data-val="wet"]').click());
  await p.waitForTimeout(300);
  check('쉬로 바꾸면 똥 상태 질문이 사라진다',
    await p.evaluate(()=>document.getElementById('f-poop-wrap').hidden), true);
  await p.click('#fp-entry-save'); await p.waitForTimeout(1400);
  s = await st();
  check('...값도 함께 비워진다', s.entries.filter(e=>e.type==='diaper')[0].poop, undefined);

  // ═══ 체온 — 0.1 단위 ═══
  await openRow('체온');
  check('체온도 같은 숫자 부품이다', await p.evaluate(()=>{
    const box=document.querySelector('.amt [data-scrub="ruler"]');
    return box && box.dataset.for==='f-temp' && box.dataset.step==='0.1';
  }), true);
  /* 0.1씩 더하면 36.300000000000004 같은 눈금이 생긴다 — 한 칸마다 끊어 맞춘다 */
  check('...눈금에 부동소수점 오차가 없다', await p.evaluate(()=>
    [...document.querySelectorAll('.amt .sv[data-v]')].every(c=>/^\d+(\.\d)?$/.test(c.dataset.v))), true);
  check('...눈금이 35.0부터 41.0까지다', await p.evaluate(()=>{
    const c=[...document.querySelectorAll('.amt .sv[data-v]')];
    return [c[0].dataset.v, c[c.length-1].dataset.v, c.length];
  }), ['35', '41', 61]);
  const amtVal = () => txt('[data-scrub="ruler"] .scrub-val');
  check('...지금 값이 걸려 있다', await amtVal(), '37.2℃');
  check('...끝에 열 기준이 적힌다', /37.5 이상이면 열/.test(await txt('.amt-ends')), true);
  check('...어디서 쟀는지도 묻는다',
    await p.evaluate(()=>document.querySelectorAll('#f-tsite .chip').length), 3);
  await p.evaluate(()=>{ const i=document.getElementById('f-temp');
    i.value='38.4'; i.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(400);
  check('직접 적은 소수도 눈금에 걸린다', await amtVal(), '38.4℃');
  await p.evaluate(()=>document.querySelector('#f-tsite [data-val="arm"]').click());
  await p.click('#fp-entry-save'); await p.waitForTimeout(1400);
  s = await st();
  check('체온이 소수 그대로 저장된다', s.entries.filter(e=>e.type==='temp')[0].temp, 38.4);
  check('...잰 자리도', s.entries.filter(e=>e.type==='temp')[0].tempSite, 'arm');

  // ═══ 투약 — 이름은 영문, 양은 숫자 칸 ═══
  await openRow('투약');
  check('약 이름이 칩으로 나온다',
    await p.evaluate(()=>[...document.querySelectorAll('#f-med .chip')].map(x=>x.textContent)),
    ['Hemangiol', '+ 직접 적기']);
  check('...양은 숫자 칸이다', await p.evaluate(()=>{
    const i=document.getElementById('f-amount');
    return i && i.type==='number' && i.step==='0.1';
  }), true);
  check('...단위가 ml로 적혀 있다', await txt('.ent-unit'), 'ml');
  await p.evaluate(()=>document.querySelector('#f-med [data-val="Hemangiol"]').click());
  await p.fill('#f-amount', '3.4');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1400);
  s = await st();
  const med = s.entries.filter(e=>e.type==='med')[0];
  check('약 이름이 영문 그대로 저장된다', med.med, 'Hemangiol');
  /* 쉼표가 들어갈 자리가 없다 — 숫자 칸은 숫자만 받는다 */
  check('...양이 점 소수로 저장된다', med.amount, 3.4);
  check('...단위도', med.medUnit, 'ml');
  await openRow('투약');
  check('직접 적기를 고르면 이름 칸이 열린다', await p.evaluate(async ()=>{
    document.getElementById('f-med-other').click();
    await new Promise(r=>setTimeout(r,200));
    return !document.getElementById('f-med-name').hidden;
  }), true);
  await p.fill('#f-med-name', 'Tylenol');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1400);
  s = await st();
  check('...직접 적은 이름이 저장된다', s.entries.filter(e=>e.type==='med')[0].med, 'Tylenol');

  // ═══ 수면 — 시각 둘이 한 칸 ═══
  await openRow('수면');
  check('수면은 시각 둘이 한 줄이다', await p.evaluate(()=>
    document.querySelectorAll('#f-tslots [data-tslot]:not([hidden])').length), 2);
  check('...잠든 시각과 깬 시각이 다 적힌다',
    /10:30/.test(await txt('#f-tslots')) && /12:00/.test(await txt('#f-tslots')), true);
  check('...길이는 읽기만 하는 칩이다', await txt('#f-dur'), '1시간 30분');
  /* 두 시각이 탭처럼 — 누른 쪽이 고쳐지는 쪽이고 편집기는 하나뿐이다 */
  await p.click('[data-tslot="end"]'); await p.waitForTimeout(400);
  check('...깬 시각을 누르면 그 쪽으로 넘어간다', await p.evaluate(()=>
    [document.getElementById('f-tedit-start').hidden,
     !document.getElementById('f-tedit-end').hidden]), [true, true]);
  /* 고치면 길이가 바로 따라온다 */
  await p.evaluate(()=>{ const i=document.getElementById('f-end');
    i.value='13:00'; i.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(400);
  check('...고치면 길이가 바로 따라온다', await txt('#f-dur'), '2시간 30분');
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  s = await st();
  check('...고친 끝 시각이 저장된다',
    new Date(s.entries.filter(e=>e.type==='sleep')[0].end).getHours(), 13);
  await openRow('수면');
  check('...어떤 잠인지는 칩 줄이다',
    await p.evaluate(()=>document.querySelectorAll('#f-sleep .chip').length), 3);
  await back();

  // ═══ 사진 — 모든 기록에 ═══
  for (const row of ['분유', '수면', '체온', '투약']){
    await openRow(row);
    check(row + ' 기록에도 사진 줄이 있다',
      await p.evaluate(()=>!!document.getElementById('f-pics') && !!document.getElementById('f-pic-add')), true);
    await back();
  }
  await openRow('분유');
  await p.setInputFiles('#f-photo-input', {
    name: 'z.png', mimeType: 'image/png',
    /* 1×1 PNG — 사진큐 시험이 쓰는 것과 같은 것 */
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  await p.waitForTimeout(1600);
  check('사진을 고르면 타일이 선다',
    await p.evaluate(()=>document.querySelectorAll('#f-pics .ep').length), 1);
  await p.click('#fp-entry-save'); await p.waitForTimeout(1600);
  s = await st();
  const feed = s.entries.filter(e=>e.type==='feed')[0];
  check('...기록에 사진 참조가 붙는다', (feed.photos || []).length, 1);
  check('...서버에 바이트도 있다',
    (await fetch(BASE + '/api/photo/' + feed.photos[0].id)).status, 200);

  /* 목록 줄의 섬네일 — 44px이던 것을 키웠고(2026-10-26 "크기 키워주고"),
     누르면 그 기록이 아니라 **사진이 전체 화면으로** 열린다. 줄 전체가
     버튼이라 섬네일은 span 이고, 줄은 click 이 아니라 pointerup 으로
     움직인다 — 그래서 '어디를 눌렀나'를 손가락 댄 자리로 본다. */
  check('목록 줄의 섬네일이 커졌다', await p.evaluate(()=>{
    const e = document.querySelector('.e-pic[data-epic]');
    return e ? Math.round(e.getBoundingClientRect().width) >= 64 : 0;
  }), true);
  check('...줄 밖으로 삐져나가지 않는다', await p.evaluate(()=>{
    const pics = document.querySelector('.e-pics');
    const main = pics.closest('.e-main');
    return [...pics.children].every(c =>
      c.getBoundingClientRect().right <= main.getBoundingClientRect().right + 0.5);
  }), true);
  await p.click('.e-pic[data-epic="0"]'); await p.waitForTimeout(900);
  check('...누르면 기록이 아니라 사진이 열린다', await p.evaluate(()=>[
    document.getElementById('fp-photo').classList.contains('show'),
    document.getElementById('fp-entry').classList.contains('show')]), [true, false]);
  await p.click('#fp-photo-back'); await p.waitForTimeout(700);
  check('...닫으면 목록으로 돌아온다', await p.evaluate(()=>[
    document.getElementById('fp-photo').classList.contains('show'),
    document.body.classList.contains('fp-open')]), [false, false]);

  await openRow('분유');
  check('다시 열면 사진이 그대로 있다',
    await p.evaluate(()=>document.querySelectorAll('#f-pics .ep').length), 1);
  await p.click('#f-pics [data-ent-drop]'); await p.waitForTimeout(400);
  check('...빼면 타일이 사라진다',
    await p.evaluate(()=>document.querySelectorAll('#f-pics .ep').length), 0);
  await p.click('#fp-entry-save'); await p.waitForTimeout(1500);
  s = await st();
  check('...저장하면 참조도 빠진다',
    (s.entries.filter(e=>e.type==='feed')[0].photos || []).length, 0);

  /* 바닥은 저장 하나. '다시 먹이기 / 이어서 재우기'를 저장 옆에 두니 둘 다
     똑같이 크게 서서 나가는 길이 두 개로 보였다. */
  await openRow('분유');
  check('바닥 버튼은 저장 하나다', await p.evaluate(()=>
    [...document.querySelectorAll('#fp-entry .fp-foot .btn')].map(b=>b.id)), ['fp-entry-save']);
  /* 기록자 칩은 뺐다 — 맨 윗줄이 이미 누가 적었는지 말한다 */
  check('...기록자 칩은 없다', await p.evaluate(()=>!document.getElementById('f-author')), true);
  check('...그래도 기록자는 안 바뀐다', await p.evaluate(async ()=>{
    document.getElementById('fp-entry-save').click();
    await new Promise(r=>setTimeout(r,1400));
    return 1; }) && (await st()).entries.filter(e=>e.type==='feed')[0].author, '엄마');
  /* 눈금자는 목업 모양 — 틱이 줄줄이 서고 다섯 칸마다 숫자 */
  await openRow('체온');
  check('눈금자가 틱으로 그려진다', await p.evaluate(()=>{
    const c=[...document.querySelectorAll('[data-scrub="ruler"] .sv[data-v]')];
    return [c.length, c.filter(x=>x.querySelector('i')).length,
            c.filter(x=>x.classList.contains('maj')).length]; }), [61, 61, 13]);
  check('...숫자는 긴 틱에만 붙는다', await p.evaluate(()=>
    [...document.querySelectorAll('[data-scrub="ruler"] .sv[data-v]')]
      .every(x => !!x.querySelector('b') === x.classList.contains('maj'))), true);
  await back();

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
