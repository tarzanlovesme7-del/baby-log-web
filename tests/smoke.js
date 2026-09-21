/* 스모크 — 매일 쓰는 길이 막히지 않았는지만 빠르게 훑는다.

   2026-09-21에 컨테이너가 회수되면서 /tmp에 있던 스위트 전체(약 350개 검사)를
   잃었다. 앱 소스는 zip으로 살아남았고 테스트만 사라졌다. 그걸 다시 쌓는
   동안, 최소한 "앱이 서고 주요 화면이 그려지고 기록이 저장된다"는 이 한 벌은
   저장소 안에 둔다. 이건 잃은 스위트의 대체가 아니라 바닥이다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return {status:r.status, body: await r.json().catch(()=>({}))};}
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json();
  const d = j.data||j; d.entries=d.entries||[]; d.shifts=d.shifts||[]; d.leaves=d.leaves||[]; return d; };
const D=d=>{const x=new Date();x.setDate(x.getDate()+d);
  return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  await mut('setPayroll',{actor:'엄마',startDate:D(-45),leaveDays:11,leavePay:800000});
  const s0 = await st();
  for (const x of s0.shifts.filter(s=>s.date===D(0))) await mut('deleteShift',{id:x.id,actor:'엄마'});
  for (const x of s0.leaves) await mut('deleteLeave',{id:x.id,actor:'엄마'});

  const open = async (who, lang) => {
    const p = await b.newPage({ viewport:{width:390,height:880} });
    p.on('pageerror', e => errs.push(who + ': ' + String(e)));
    p.on('console', m => { if (m.type()==='error' && !/ERR_|favicon/.test(m.text())) errs.push(who+' console: '+m.text()); });
    await p.addInitScript(([a,l])=>{ localStorage.setItem('bbl_author',a); localStorage.setItem('bbl_lang',l);
      localStorage.setItem('bbl_memo_seen', new Date().toISOString()); }, [who,lang]);
    await p.goto(BASE+'/'); await p.waitForTimeout(2000);
    return p;
  };
  const drawn = (p, sel) => p.evaluate(s => { const el = document.querySelector(s);
    return !!el && el.textContent.trim().length > 0; }, sel);

  // ═══ 두 폰이 각자의 언어로 선다 ═══
  for (const [who, lang] of [['엄마','ko'], ['내니','vi']]){
    const p = await open(who, lang);
    check(who + ' 폰이 뜬다', await drawn(p, '#since-row'), true);
    check(who + ' — 빠른 기록 타일이 그려진다',
      await p.evaluate(()=>document.querySelectorAll('#qa-grid .qa-btn').length > 0), true);

    /* 다섯 탭이 전부 그려진다 */
    for (const [tab, sel] of [['record','#qa-grid'], ['memo','#tab-memo'],
                              ['stats','#tab-stats'], ['growth','#tab-growth'], ['pay','#pay-today']]){
      await p.click('.tab-btn[data-tab="'+tab+'"]'); await p.waitForTimeout(900);
      check(who + ' — ' + tab + ' 탭이 그려진다', await drawn(p, sel), true);
    }
    await p.close();
  }

  // ═══ 기록이 저장되고 이름이 붙는다 ═══
  const before = (await st()).entries.length;
  const nanny = await open('내니','vi');
  await nanny.click('.tab-btn[data-tab="pay"]'); await nanny.waitForTimeout(800);
  await nanny.click('#pay-stamp'); await nanny.waitForTimeout(1800);
  const sh = (await st()).shifts.filter(s=>s.date===D(0));
  check('출근 도장이 저장된다', sh.length, 1);
  check('...이름이 붙는다', sh[0] && sh[0].by, '내니');
  await nanny.close();

  // ═══ 엄마 화면: 설정 목차 · 정산 · 연차 ═══
  const mom = await open('엄마','ko');
  await mom.click('#btn-settings'); await mom.waitForTimeout(900);
  check('설정이 목차로 열린다',
    await mom.evaluate(()=>document.querySelectorAll('[data-set-go]').length), 9);
  await mom.click('[data-set-go="pay"]'); await mom.waitForTimeout(700);
  check('...급여 하위 화면이 열린다', await drawn(mom, '#pay-settings'), true);
  await mom.click('#set-back'); await mom.waitForTimeout(500);

  await mom.click('.tab-btn[data-tab="pay"]'); await mom.waitForTimeout(800);
  await mom.click('[data-payday="'+D(2)+'"]'); await mom.waitForTimeout(700);
  check('앞날 카드에 연차 버튼이 있다',
    await mom.evaluate(()=>!!document.getElementById('pay-day-leave')), true);
  await mom.click('#pay-day-leave'); await mom.waitForTimeout(1600);
  check('엄마가 넣은 연차는 바로 확정된다',
    (await st()).leaves.filter(l=>l.date===D(2)).map(l=>l.status), ['ok']);

  await mom.click('#pay-tabs button[data-pv="settle"]'); await mom.waitForTimeout(900);
  check('정산 화면이 그려진다', await drawn(mom, '#pay-period'), true);
  check('...연차가 금액에 들어간다', /연차 1일/.test(
    await mom.evaluate(()=>document.getElementById('pay-period').textContent)), true);
  await mom.close();

  const s9 = await st();
  for (const x of s9.shifts.filter(s=>s.date===D(0))) await mut('deleteShift',{id:x.id,actor:'엄마'});
  for (const x of s9.leaves) await mut('deleteLeave',{id:x.id,actor:'엄마'});
  check('기록이 늘어나지 않았다 (스모크가 남긴 쓰레기 없음)', (await st()).entries.length, before);

  check('콘솔 에러 없음', errs, []);
  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
})();
