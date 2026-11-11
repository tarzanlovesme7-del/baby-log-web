/* 재료 그림 — 미리 넣어 두고, 이름으로 붙는다.

   "내가 아이콘 svg로 전달해줬던 것들 있잖아, 식단표에 없는 재료라도 미리
   가지고 있을 수 없어?" (2026-11-02)

   재료를 새로 만들면 id 가 i_xxxx 로 생기므로 id 로는 그림을 미리 맞춰 둘
   수 없다. 그래서 **한글 이름**으로 한 번 더 찾는다 — public/icons 에 그림이
   있고 WEAN_ICON_BY_NAME 에 이름이 적혀 있으면, 같은 이름의 재료를 만드는
   순간 그림이 붙는다. */
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
const p2 = n => (n<10?'0':'')+n;
const today = (()=>{ const d=new Date();
  return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); })();

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const errs = [];
  const p = await b.newPage({ viewport:{ width:390, height:900 } });
  p.on('pageerror', e => errs.push(String(e)));
  /* 샌드박스는 바깥 호스트를 막는다 — 글꼴 요청 실패는 이 검사와 무관하다 */
  p.on('console', m => { if (m.type()==='error' &&
    !/favicon|ERR_TUNNEL|ERR_NAME|net::ERR/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });

  /* 깨끗한 바닥 — 재료 사전을 비우고 네 가지만 세운다 */
  const s0 = await st();
  for (const k of Object.keys(s0.weanPlan||{})) await mut('deleteWeanDay',{ date:k, actor:'엄마' });
  /* 아는 id(쌀죽·소고기) + id 로는 모르는 새 재료 셋 */
  await mut('setWeanIng', { actor:'엄마', id:'pgy',  ko:'쌀죽',  vi:'cháo gạo', cubeG:40, isBase:true });
  await mut('setWeanIng', { actor:'엄마', id:'beef', ko:'소고기', vi:'thịt bò', cubeG:10 });
  await mut('setWeanIng', { actor:'엄마', ko:'돼지고기',   vi:'thịt heo', cubeG:10 });   /* 이름으로 붙어야 함 */
  await mut('setWeanIng', { actor:'엄마', ko:'비타민 (다채)', vi:'cải ngọt', cubeG:10 }); /* 괄호 떼고 맞아야 함 */
  await mut('setWeanIng', { actor:'엄마', ko:'듣보잡재료',    vi:'x',       cubeG:10 }); /* 그림 없음 */
  const ings = (await st()).weanIngs;
  const idOf = (ko) => (ings.filter(x=>x.ko===ko)[0]||{}).id;
  check('새 재료의 id 는 i_ 로 생긴다 (id 로는 미리 맞출 수 없다)',
    /^i_/.test(idOf('돼지고기')), true);

  await mut('setWeanDay', { date: today, actor:'엄마', meals:[{ name:'아침',
    base:[{ ing:'pgy', g:40 }],
    tops:[{ ing:'beef', g:10 }, { ing:idOf('돼지고기'), g:10 },
          { ing:idOf('비타민 (다채)'), g:10 }, { ing:idOf('듣보잡재료'), g:10 }] }] });

  await p.goto(BASE + '/'); await p.waitForTimeout(2200);

  /* 첫 화면 이유식 띠가 오늘 끼니의 토핑을 스티커로 깐다 */
  const srcs = await p.evaluate(()=>
    [...document.querySelectorAll('#wean-row img.wi')].map(i=>i.getAttribute('src')));
  check('아는 id 는 그대로 붙는다 (소고기)', srcs.indexOf('icons/beef.svg') >= 0, true);
  /* 쌀죽은 쌀(rice.svg)이 아니라 흰죽 그릇이다 — 연두 띠 위에서 거의
     흰색인 쌀알이 안 보였다("쌀죽이 잘 안보여", 2026-11-10). 사 오는
     재료 '쌀'은 그대로 rice.svg 를 쓴다 — 죽이 아니라 쌀이니까. */
  check('쌀죽(pgy)은 흰죽 그릇', srcs.indexOf('icons/rice-porridge.svg') >= 0, true);
  check('...쌀알 그림이 아니다', srcs.indexOf('icons/rice.svg') >= 0, false);
  check('이름으로 붙는다 (돼지고기 → pork.svg)', srcs.indexOf('icons/pork.svg') >= 0, true);
  check('괄호는 떼고 맞춘다 (비타민 (다채) → tatsoi.svg)',
    srcs.indexOf('icons/tatsoi.svg') >= 0, true);
  check('이름도 모르면 그림 없이 조용히 넘어간다',
    srcs.filter(x=>/undefined|null/.test(x)).length, 0);

  /* 그림 파일이 실제로 다 있어야 한다 — 깨진 이미지가 하나라도 있으면 실패 */
  const broken = await p.evaluate(async ()=>{
    const out = [];
    for (const i of [...document.querySelectorAll('img.wi')]){
      const r = await fetch(i.getAttribute('src'));
      if (!r.ok) out.push(i.getAttribute('src'));
    }
    return out;
  });
  check('붙은 그림 파일이 전부 실제로 있다', broken, []);

  /* 미리 넣어 둔 그림이 몇 장인지 — 식단에 없는 재료까지 */
  const have = await p.evaluate(async ()=>{
    const names = ['pork','shrimp','salmon','mango','kale','strawberry','pear','corn',
                   'eggplant','cheese','yogurt','chickpea','oyster-mushroom','quail-egg'];
    const miss = [];
    for (const n of names){ const r = await fetch('icons/' + n + '.svg'); if (!r.ok) miss.push(n); }
    return miss;
  });
  check('아직 식단에 없는 재료 그림도 미리 들어 있다', have, []);

  check('페이지 오류 없음', errs, []);
  await b.close();
  const bad = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-bad) + '/' + R.length + (bad ? '  — ' + bad + ' FAILED' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
