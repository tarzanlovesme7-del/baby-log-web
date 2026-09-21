/* 고른 칸이 고른 것처럼 보여야 한다.

   2026-09-21: 기록 상세의 '수면 종류'에서 무엇이 골라졌는지 읽히지 않았다.
   원인은 소스만 봐서는 안 보인다 — `#fp-entry-body .field input, .seg`가
   트랙을 희게 칠했고, 손잡이도 흰색이라 흰 위에 흰 게 얹혔다. 규칙 두 개는
   각각 멀쩡했고 겹쳤을 때만 틀렸다. 그래서 계산된 스타일로만 물어본다:
   손잡이 배경 ≠ 트랙 배경, 그리고 고른 글자 ≠ 안 고른 글자. 라이트·다크 둘 다. */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e))); }
async function mut(t,p){const r=await fetch(BASE+'/api/mutate',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t,payload:p})});
  return r.json().catch(()=>({}));}

/* 두 색이 눈에 띄게 다른가. rgb 문자열끼리 채널 차를 더해서 본다 —
   1~2 차이는 안티앨리어싱이지 구분이 아니다. */
function rgb(s){ const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0,3).map(Number) : null; }
function apart(a, b){ const x = rgb(a), y = rgb(b);
  if (!x || !y) return 999;
  return Math.abs(x[0]-y[0]) + Math.abs(x[1]-y[1]) + Math.abs(x[2]-y[2]); }
/* 안 칠한 칸은 보통 transparent다 — 알파가 0이면 트랙이 그대로 비친다 */
function clear(s){ const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const p = m[1].split(',').map(function(v){ return Number(v); });
  return p.length > 3 && p[3] === 0; }

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
  const now = new Date(), s = new Date(now.getTime() - 3600e3);
  const r = await mut('addEntry', { type:'sleep', start:s.toISOString(), end:now.toISOString(), author:'엄마' });
  const id = (r.entry && r.entry.id) || (r.result && r.result.entry && r.result.entry.id);

  for (const theme of ['light','dark']){
    const p = await b.newPage({ viewport:{width:390,height:844}, colorScheme: theme });
    await p.addInitScript(()=>{ localStorage.setItem('bbl_author','엄마'); localStorage.setItem('bbl_lang','ko'); });
    await p.goto(BASE + '/'); await p.waitForTimeout(1800);
    await p.click('.entry-row[data-id="'+id+'"]'); await p.waitForTimeout(900);

    /* 화면에 떠 있는 모든 .seg를 한 번에 본다 — 수면 종류, 기저귀 종류 */
    const segs = await p.evaluate(()=>{
      const out = [];
      document.querySelectorAll('.seg').forEach(function(seg){
        if (!seg.offsetParent) return;                   /* 안 보이는 건 건너뛴다 */
        const on  = seg.querySelector('[aria-pressed="true"]');
        const off = seg.querySelector('[aria-pressed="false"]');
        if (!on || !off) return;
        const cs = getComputedStyle;
        out.push({ id: seg.id || seg.className,
          track: cs(seg).backgroundColor,
          onBg: cs(on).backgroundColor,  offBg: cs(off).backgroundColor,
          onFg: cs(on).color,            offFg: cs(off).color,
          onW: cs(on).fontWeight,        offW: cs(off).fontWeight });
      });
      return out;
    });

    check(theme + ' — 기록 상세에 .seg가 보인다', segs.length > 0, true);
    for (const g of segs){
      check(theme + ' · ' + g.id + ' — 고른 칸 배경이 트랙과 다르다',
        apart(g.onBg, g.track) >= 8, true);
      check(theme + ' · ' + g.id + ' — 안 고른 칸은 트랙에 묻어 있다',
        clear(g.offBg) || apart(g.offBg, g.track) <= 2, true);
      check(theme + ' · ' + g.id + ' — 고른 글자색이 안 고른 것과 다르다',
        apart(g.onFg, g.offFg) >= 30, true);
      check(theme + ' · ' + g.id + ' — 고른 글자가 더 굵다',
        Number(g.onW) > Number(g.offW), true);
    }
    await p.close();
  }

  await b.close();
  const n = R.filter(x=>!x.ok).length;
  console.log('\n' + (R.length-n) + '/' + R.length + (n ? ' pass — ' + n + ' FAILED' : ' pass'));
  process.exit(n ? 1 : 0);
})();
