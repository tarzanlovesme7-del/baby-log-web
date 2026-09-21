/* 이름 없이 기록이 나가는 일이 없어야 한다.

   2026-09-21 아침 내니 폰에서 실제로 일어난 일: localStorage의 이름이 사라진
   채로 앱이 열렸고, 첫 실행 시트는 바깥을 누르면 닫히는 시트였다. 닫은 뒤로
   출근 도장 1건과 기록 11건이 전부 author:"" 로 저장됐다 — 누가 썼는지 영영
   알 수 없는 기록. 여기서 그 아침을 그대로 재현한다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return {status:r.status, body: await r.json().catch(()=>({}))};}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.entries=d.entries||[]; d.shifts=d.shifts||[]; return d; };
const D=d=>{const x=new Date();x.setDate(x.getDate()+d);
  return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  await mut('setPayroll',{actor:'엄마',startDate:D(-45)});
  for (const x of (await st()).shifts.filter(s=>s.date===D(0))) await mut('deleteShift',{id:x.id,actor:'엄마'});
  const before = (await st()).entries.length;

  /* 이름이 없는 폰 — 언어만 베트남어로 남아 있는 상태(그 아침 그대로) */
  const p = await b.newPage({ viewport:{width:390,height:844} });
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(()=>{ localStorage.removeItem('bbl_author');
    localStorage.setItem('bbl_lang','vi'); });
  await p.goto(BASE+'/'); await p.waitForTimeout(2200);

  const sheetUp = () => p.evaluate(()=>{
    const s = document.getElementById('profile-sheet');
    return !!s && s.classList.contains('show'); });

  check('이름이 없으면 첫 실행 시트가 뜬다', await sheetUp(), true);

  // ═══ 그 아침의 동작: 바깥을 눌러 닫는다 ═══
  await p.click('#scrim3', { force:true }); await p.waitForTimeout(600);
  check('바깥을 눌러도 닫히지 않는다', await sheetUp(), true);
  check('...왜 안 닫히는지 말해준다',
    await p.evaluate(()=>{const t=document.getElementById('toast');
      return !!t && /chọn tên|이름/.test(t.textContent||'');}), true);

  /* 시트를 강제로 치워도 기록은 나가지 않는다 — 두 번째 겹 */
  await p.evaluate(()=>{ document.getElementById('profile-sheet').classList.remove('show');
    document.querySelectorAll('.scrim').forEach(s=>s.classList.remove('show')); });
  await p.waitForTimeout(300);
  await p.click('.tab-btn[data-tab="record"]'); await p.waitForTimeout(400);
  const tile = await p.evaluate(()=>{ const b=document.querySelector('#qa-grid .qa-btn');
    if (b) b.click(); return !!b; });
  check('빠른 기록 타일을 누를 수 있다', tile, true);
  await p.waitForTimeout(2200);
  check('...그래도 기록이 저장되지 않는다', (await st()).entries.length, before);

  /* 출근 도장도 마찬가지 */
  await p.evaluate(()=>{ document.getElementById('profile-sheet').classList.remove('show');
    document.querySelectorAll('.scrim').forEach(s=>s.classList.remove('show')); });
  await p.click('.tab-btn[data-tab="pay"]'); await p.waitForTimeout(700);
  const hadStamp = await p.evaluate(()=>{ const b=document.getElementById('pay-stamp');
    if (b) b.click(); return !!b; });
  check('출근 도장 버튼이 있다', hadStamp, true);
  await p.waitForTimeout(2200);
  check('...이름 없이는 도장도 안 찍힌다',
    (await st()).shifts.filter(s=>s.date===D(0)).length, 0);
  check('...대신 이름을 고르라고 시트가 다시 뜬다', await sheetUp(), true);
  check('...낙관적으로 찍혔던 도장도 화면에서 물러난다',
    await p.evaluate(()=>!!document.getElementById('pay-stamp')), true);

  /* 헤더가 이름 없음을 눈에 띄게 말한다 */
  check('헤더 동그라미가 이름 없음을 표시한다',
    await p.evaluate(()=>{const b=document.getElementById('btn-profile');
      return b.classList.contains('no-author') && b.textContent.trim() === '!';}), true);

  // ═══ 이름을 고르면 정상으로 돌아온다 ═══
  await p.evaluate(()=>{ document.getElementById('btn-profile').click(); });
  await p.waitForTimeout(600);
  /* 칩의 data-name은 화면 언어와 무관하게 저장되는 원본 이름이다 */
  await p.click('#profile-chip-row .chip[data-name="내니"]'); await p.waitForTimeout(300);
  await p.click('#profile-save-btn'); await p.waitForTimeout(1600);
  check('이름을 고르면 시트가 닫힌다', await sheetUp(), false);
  check('...헤더 표시도 사라진다',
    await p.evaluate(()=>!document.getElementById('btn-profile').classList.contains('no-author')), true);

  /* 같은 동작(출근 도장)을 다시 — 이번엔 막히지 않고 이름이 붙는다 */
  await p.click('.tab-btn[data-tab="pay"]'); await p.waitForTimeout(700);
  await p.click('#pay-stamp'); await p.waitForTimeout(2000);
  const sh = (await st()).shifts.filter(s=>s.date===D(0));
  check('이름을 고른 뒤에는 도장이 찍힌다', sh.length, 1);
  check('...내니 이름이 붙는다', sh[0] && sh[0].by, '내니');

  /* 이름이 생긴 뒤에는 시트가 평소처럼 닫힌다 */
  await p.evaluate(()=>{ document.getElementById('btn-profile').click(); });
  await p.waitForTimeout(600);
  await p.click('#scrim3', { force:true }); await p.waitForTimeout(600);
  check('이름이 있으면 바깥을 눌러 닫을 수 있다', await sheetUp(), false);

  check('콘솔 에러 없음', errs, []);
  await p.close(); await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
})();
