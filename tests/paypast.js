/* 지난 기간에도 '입금 완료로 표시'.

   "10월 16일부터 일한거 입금 했는데 입금완료 어디서 누르냐" (2026-11-02)
   — 버튼이 '이번 기간' 카드 바닥에만 있어서, 달이 바뀌어 지난 기간이 목록으로
   내려가면 찍을 자리가 없었다. 지난 기간 상세(fp-payperiod)에도 같은 버튼을
   둔다. 엄마만, 줄 것이 있을 때만. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){ const r = await fetch(BASE+'/api/mutate',{ method:'POST',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:t,payload:p}) });
  if (!r.ok) console.log('!! ' + t + ' ' + (await r.text()).slice(0,160));
  return r.json().catch(()=>({})); }
const st = async () => { const j = await (await fetch(BASE+'/api/state')).json(); return j.data||j; };
const p2 = (n) => (n<10?'0':'')+n;
const ds = (d) => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  /* 지난 기간이 존재하려면 전 기간에 출근이 찍혀 있어야 한다.
     오늘이 며칠이든 '지난 기간'이 생기도록 지지난달까지 거슬러 찍는다. */
  const s0 = await st();
  for (const x of (s0.shifts || [])) await mut('deleteShift', { id:x.id, actor:'엄마' });
  for (const x of (s0.payPeriods || [])) await mut('unmarkPaid', { id:x.id, actor:'엄마' });
  const today = new Date();
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 20);
  const stamped = [];
  for (let i = 0; i < 4; i++){
    const d = new Date(prevMonth); d.setDate(16 + i);
    stamped.push(ds(d));
    await mut('stampIn', { date: ds(d), actor:'엄마', author:'엄마', at: ds(d) + 'T01:00:00.000Z' });
  }
  /* 근무 시작일을 그 전으로 — 앱은 시작일 전 기간을 세지 않는다 */
  await mut('setPayroll', { actor:'엄마', startDate: ds(new Date(today.getFullYear(), today.getMonth() - 2, 1)) });

  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !/favicon|net::ERR/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
  await p.goto(BASE+'/'); await p.waitForTimeout(2000);
  await p.evaluate(()=>document.querySelector('.tab-btn[data-tab="pay"]').click());
  await p.waitForTimeout(900);
  const settleTab = await p.evaluate(()=>{
    const b2 = document.querySelector('#pay-tabs [data-pv="settle"]');
    if (!b2 || b2.hidden) return false; b2.click(); return true;
  });
  check('엄마 폰에 정산 화면이 있다', settleTab, true);
  await p.waitForTimeout(900);

  /* 지난 기간 줄을 연다 */
  const opened = await p.evaluate(()=>{
    const row = document.querySelector('#pay-history [data-pp-open]');
    if (!row) return null; const label = row.innerText.replace(/\s+/g,' ').trim(); row.click(); return label;
  });
  check('지난 기간 줄이 있다', !!opened, true);
  await p.waitForTimeout(900);
  check('...누르면 그 기간 상세가 열린다', await p.evaluate(()=>
    !document.getElementById('fp-payperiod').hidden &&
    document.getElementById('fp-payperiod').classList.contains('show')), true);

  // ═══ 여기가 이번에 생긴 것 ═══
  check('지난 기간 상세에 입금 완료 버튼이 있다', await p.evaluate(()=>{
    const b3 = document.querySelector('#pp-foot [data-pay-mark]');
    return b3 ? b3.textContent.trim() : null; }), '입금 완료로 표시');
  await p.evaluate(()=>document.querySelector('#pp-foot [data-pay-mark]').click());
  await p.waitForTimeout(1600);
  const paid = (await st()).payPeriods || [];
  check('...누르면 그 기간이 입금 완료로 굳는다', paid.length, 1);
  check('...금액이 0 이 아니다', paid[0].amount > 0, true);
  check('...찍은 날짜가 남는다', /^\d{4}-\d{2}-\d{2}/.test(paid[0].paidAt), true);
  check('...화면이 바로 따라 바뀐다 (입금 취소 버튼으로)', await p.evaluate(()=>
    !!document.querySelector('#pp-foot [data-pay-undo]')), true);
  check('...상단에 입금 완료 칩이 선다', await p.evaluate(()=>
    !!document.querySelector('#pp-sum .pay-chip.ok')), true);

  /* 되돌리기도 그 자리에서 */
  await p.evaluate(()=>document.querySelector('#pp-foot [data-pay-undo]').click());
  await p.waitForTimeout(1500);
  check('입금 취소도 그 화면에서 된다', ((await st()).payPeriods||[]).length, 0);

  /* 내니 폰에서는 안 보인다 */
  await p.close();
  const p3 = await b.newPage({ viewport:{ width:390, height:900 } });
  p3.on('pageerror', e => errs.push(String(e)));
  await p3.addInitScript(()=>{ localStorage.setItem('bbl_author','내니 Vi'); localStorage.setItem('bbl_lang','ko'); });
  await p3.goto(BASE+'/'); await p3.waitForTimeout(2000);
  /* 가리는 기간(11/1~12/1)에는 **급여 탭 자체가 없다** — 서브탭만 숨기고
     '이번 기간 ₫' 카드를 남겨 뒀더니 그녀가 아빠 프로필 스크린샷으로
     잡아냈다 (2026-11-02 "아예 저 돼지저금통 메뉴가 안보이게"). */
  const hideWindow = (() => { const d = new Date();
    const p2n = (n)=> (n<10?'0':'')+n;
    const ds2 = d.getFullYear()+'-'+p2n(d.getMonth()+1)+'-'+p2n(d.getDate());
    return ds2 >= '2026-11-01' && ds2 <= '2026-12-01'; })();
  if (hideWindow){
    check('내니 폰에는 급여 탭(돼지저금통)이 아예 없다', await p3.evaluate(()=>{
      const b4 = document.querySelector('.tab-btn[data-tab="pay"]');
      return !b4 || b4.hidden; }), true);
    /* 앱이 그리는 자리(띠·카드·탭)에는 금액이 없어야 한다.
       **예외 하나 — 급여일 메모**: 지급일 오후 5시에 앱이 메모로 올리는
       '근무 4일 → 3,200,000 ₫' 한 줄은 메모 탭에 남아 모두가 본다. 급여 탭을
       가려도 이건 가려지지 않는다(2026-11-02 확인). 메모는 내니에게 알리려고
       만든 것이라 지우는 게 맞는지 그녀에게 물어둔 상태다 — 답이 오면 이
       검사를 금액 전체로 넓힌다. */
    check('...앱이 그리는 자리에는 금액이 없다 (급여일 메모는 예외)', await p3.evaluate(()=>{
      const skipMemo = (el) => !!el.closest('#memo-row, #tab-memo, .memo-row, .announce-row');
      const hits = [];
      document.querySelectorAll('#app *').forEach((el) => {
        if (el.children.length === 0 && /₫/.test(el.textContent) &&
            el.offsetParent !== null && !skipMemo(el)) hits.push(el.textContent.trim().slice(0, 30));
      });
      return hits;
    }), []);
    /* 그래도 출근 도장은 찍을 수 있어야 한다 — 첫 화면 띠가 하루 종일 선다 */
    check('...대신 첫 화면 도장 띠로 찍는다', await p3.evaluate(()=>{
      const row = document.getElementById('stamp-row');
      return !!(row && !row.hidden && document.getElementById('stamp-row-btn')); }), true);
  } else {
    check('SKIP 가리는 기간이 아니다 (11/1~12/1에만 도는 검사)', true, true);
  }
  /* 탭이 없으니 그 안쪽(정산 서브탭·이번 기간 카드)에는 닿을 길이 없다 */
  check('내니 폰에서는 급여 화면에 닿을 길이 없다', await p3.evaluate(()=>{
    const b5 = document.querySelector('.tab-btn[data-tab="pay"]');
    const panel = document.getElementById('tab-pay');
    return !!((!b5 || b5.hidden) && panel.hidden); }), true);
  await p3.close();

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
