/* 한 마디 — 길게, 줄 바꿔서.

   "요즘 이렇게 메모를 길게 남길 일이 많은데 글자 수 제한이 없었으면 좋겠고
   줄바꿈 가능하게. 그리고 입력할 때 인풋 필드 높이 좀 높게 해줘.
   입력하고 나서 기록 목록에 왼쪽 아이콘이 가운데 있으니까 뭔가 이상해 —
   시간, 아이콘, 항목명 상단정렬, 그 밑에 메모 나오는게 나은듯?" (2026-11-02)

   못 박는 것:
     - 한 마디 칸은 여러 줄짜리다(textarea). 글자 수 제한이 없다.
     - 처음부터 세 줄 높이로 서 있고, 길게 적으면 칸이 따라 늘어난다.
     - 줄바꿈이 그대로 저장되고, 목록에도 그대로 보인다.
     - 목록 줄의 시각·아이콘·항목명은 **윗줄에서 시작한다** — 메모가
       길어져도 가운데로 내려가지 않는다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160));
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.entries = d.entries||[]; return d; };
/* 그녀가 실제로 남긴 모양의 메모 — 두 문단, 줄바꿈 포함 */
const LONG = '이유식 먹다가 빨리 분유 내놓으라고 오열… 너무 배고팠나보다.\n'
  + '분유로 배 좀 채우고 다시 먹음.\n빨대컵으로 물먹기 성공';

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  let s = await st();
  for (const e of s.entries) await mut('deleteEntry', { id:e.id, actor:'엄마' });
  const now = new Date(); now.setHours(10, 30, 0, 0);
  const iso = now.toISOString();
  await mut('addEntry', { type:'feed', start:iso, end:iso, amount:175, author:'엄마' });

  await p.goto(BASE + '/'); await p.waitForTimeout(1900);
  const openRow = async (ko) => { await p.click(`.entry-row:has-text("${ko}") .e-time`); await p.waitForTimeout(800); };

  // ═══ 입력칸 ═══
  await openRow('분유');
  check('한 마디 칸이 여러 줄짜리다', await p.evaluate(()=>{
    const el = document.getElementById('f-note');
    return el ? el.tagName.toLowerCase() : null; }), 'textarea');
  check('...글자 수 제한이 없다', await p.evaluate(()=>{
    const el = document.getElementById('f-note');
    return el.maxLength; }), -1);
  check('...처음부터 세 줄 높이로 선다', await p.evaluate(()=>
    document.getElementById('f-note').getBoundingClientRect().height >= 88), true);
  check('...글씨는 16px 이다(iOS 확대 방지)', await p.evaluate(()=>
    parseFloat(getComputedStyle(document.getElementById('f-note')).fontSize)), 16);
  check('...테두리 있는 상자다', await p.evaluate(()=>
    parseFloat(getComputedStyle(document.getElementById('f-note')).borderTopWidth) > 0), true);

  /* 길게 적으면 칸이 따라 늘어난다 */
  const h0 = await p.evaluate(()=>document.getElementById('f-note').getBoundingClientRect().height);
  await p.fill('#f-note', LONG + '\n' + LONG);
  await p.waitForTimeout(300);
  const h1 = await p.evaluate(()=>document.getElementById('f-note').getBoundingClientRect().height);
  check('길게 적으면 칸이 늘어난다', h1 > h0 + 40, true);
  check('...스크롤 막대 안에 글이 숨지 않는다', await p.evaluate(()=>{
    const el = document.getElementById('f-note');
    return el.scrollHeight - el.clientHeight <= 2; }), true);

  /* 저장 — 줄바꿈이 그대로 남는다 */
  await p.fill('#f-note', LONG);
  await p.waitForTimeout(200);
  await p.click('#fp-entry-save'); await p.waitForTimeout(1600);
  const saved = (await st()).entries.filter(e=>e.type==='feed')[0];
  check('줄바꿈이 그대로 저장된다', saved.note, LONG);
  check('...세 줄이다', saved.note.split('\n').length, 3);

  /* 다시 열면 적은 그대로 */
  await openRow('분유');
  check('다시 열면 줄바꿈까지 그대로 있다', await p.evaluate(()=>
    document.getElementById('f-note').value), LONG);
  check('...들어 있던 메모만큼 칸이 서 있다', await p.evaluate(()=>
    document.getElementById('f-note').getBoundingClientRect().height >= 88), true);
  await p.click('#fp-entry-back'); await p.waitForTimeout(700);

  // ═══ 목록 줄 ═══
  check('목록에서도 줄바꿈이 보인다', await p.evaluate(()=>{
    const n = document.querySelector('.entry-row .e-note');
    return !!n && getComputedStyle(n).whiteSpace === 'pre-wrap'; }), true);
  /* 시각·아이콘·제목이 **윗줄에서 시작한다**: 메모가 길어 줄이 높아져도
     세 가지의 윗변이 서로 가깝고, 줄 한가운데로 내려가지 않는다. */
  const geom = await p.evaluate(()=>{
    const row = document.querySelector('.entry-row');
    const r = row.getBoundingClientRect();
    const g = (q) => { const e = row.querySelector(q); const b = e.getBoundingClientRect();
      return { top: Math.round(b.top - r.top), h: Math.round(b.height) }; };
    return { rowH: Math.round(r.height), time: g('.e-time'), icon: g('.e-icon'), title: g('.e-title') };
  });
  check('줄이 메모만큼 높아졌다 (검사가 의미 있는 상황이다)', geom.rowH > 110, true);
  check('시각이 줄 위쪽에 있다', geom.time.top <= 20, true);
  check('아이콘이 줄 위쪽에 있다', geom.icon.top <= 20, true);
  check('시각·아이콘·제목의 윗변이 6px 안에 모여 있다',
    Math.max(geom.time.top, geom.icon.top, geom.title.top) -
    Math.min(geom.time.top, geom.icon.top, geom.title.top) <= 6, true);
  check('아이콘이 줄 한가운데로 내려가 있지 않다',
    geom.icon.top < geom.rowH / 2 - 20, true);

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x => !x.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
