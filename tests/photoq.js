/* 사진 오프라인 큐 — 신호 없는 데서 찍고 앱을 닫아도 사진이 살아남는가.

   고치기 전의 동작: 사진 바이트는 자바스크립트 변수 안에만 있었다. 업로드가
   세 번 실패하면 메모에서 떼어내고 "사진을 올리지 못했어요" 토스트를 띄웠다.
   글은 outbox 덕에 살아남는데 사진만 사라지는, 조용하고 되돌릴 수 없는 손실.

   여기서 확인하는 것:
     1) 네트워크가 죽은 채로 저장해도 메모에 사진 참조가 붙는다
     2) 사진 바이트가 IndexedDB에 남는다
     3) 앱을 완전히 닫았다 켜도(리로드) 큐에 그대로 있고, 아직 서버에 없는
        사진도 로컬 blob으로 화면에 보인다
     4) 연결이 돌아오면 저절로 올라가고 큐가 비워진다
     5) 서버가 '안 받는다'고 답한 건(413 등) 큐에 쌓아두지 않는다 */
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = 'http://localhost:3311';
const R = [];
function check(n, a, e) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n +
    (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n       want=' + JSON.stringify(e)));
}
const st = async () => { const j = await (await fetch(BASE + '/api/state')).json(); return j.data || j; };

/* 1×1 PNG. 진짜 사진일 필요는 없다 — 캔버스가 디코드하고 다시 인코드할 수만
   있으면 되고, 거쳐 가는 길은 4MB짜리 아이폰 사진과 똑같다. */
const PNG1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 880 } });
  const errs = [];

  /* 같은 컨텍스트를 계속 쓴다. IndexedDB가 리로드를 넘어 남는지가 핵심이라
     페이지는 닫았다 열어도 저장소는 같아야 한다. */
  const openPage = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(String(e)));
    /* 413은 이 테스트가 일부러 돌려주는 답이다 — 잡음이지 오류가 아니다 */
    p.on('console', m => { if (m.type() === 'error' && !/ERR_|favicon|404|413/.test(m.text())) errs.push('console: ' + m.text()); });
    await p.addInitScript(() => {
      localStorage.setItem('bbl_author', '엄마');
      localStorage.setItem('bbl_lang', 'ko');
      localStorage.setItem('bbl_memo_seen', new Date().toISOString());
    });
    await p.goto(BASE + '/');
    await p.waitForTimeout(2200);
    return p;
  };

  /* 업로드만 끊는다. 앱의 나머지(상태 폴링, 뮤테이션)는 살아 있어야
     "글은 갔는데 사진만 못 갔다"는 바로 그 상황이 재현된다. */
  let uploadsBlocked = true;
  let uploadAttempts = 0;
  await ctx.route('**/api/photo', route => {
    if (route.request().method() !== 'POST') return route.continue();
    uploadAttempts++;
    if (uploadsBlocked) return route.abort('internetdisconnected');
    return route.continue();
  });

  const qIds = p => p.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('bbl_photos', 1);
    req.onerror = () => resolve(['<open failed>']);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending')) return resolve([]);
      const g = db.transaction('pending', 'readonly').objectStore('pending').getAll();
      g.onsuccess = () => resolve(g.result.map(r => r.id).sort());
      g.onerror = () => resolve(['<read failed>']);
    };
  }));

  const addPhoto = async (p, bytes) => {
    await p.click('.tab-btn[data-tab="memo"]'); await p.waitForTimeout(800);
    await p.click('#memo-fab'); await p.waitForTimeout(600);
    await p.setInputFiles('#memo-photo-input', { name: 'z.png', mimeType: 'image/png', buffer: bytes });
    await p.waitForTimeout(1600);
  };

  // ═══ 1. 네트워크가 죽은 채로 사진 달린 메모를 저장한다 ═══
  let p = await openPage();
  await addPhoto(p, PNG1);
  check('사진 칩이 작성칸에 뜬다',
    await p.evaluate(() => document.querySelectorAll('#memo-photo-strip .mp-chip').length), 1);

  const queuedAfterPick = await qIds(p);
  check('고르자마자 큐에 적힌다(저장을 누르기도 전에)', queuedAfterPick.length, 1);
  const pid = queuedAfterPick[0];

  await p.fill('#memo-compose-text', '오프라인 사진 테스트');
  await p.click('#memo-compose-submit');
  await p.waitForTimeout(3500);

  const s1 = await st();
  const memo = (s1.memos || []).filter(m => m.text === '오프라인 사진 테스트')[0];
  check('메모 자체는 저장된다', !!memo, true);
  check('...사진 참조도 붙어 있다 (떼어내지 않는다)',
    memo && (memo.photos || []).map(x => x.id), [pid]);
  check('...서버엔 아직 바이트가 없다',
    (await fetch(BASE + '/api/photo/' + pid)).status, 404);
  check('...큐엔 남아 있다', await qIds(p), [pid]);

  // ═══ 2. 앱을 완전히 닫았다 켠다 ═══
  await p.close();
  p = await openPage();
  check('앱을 닫았다 켜도 큐에 그대로 있다', await qIds(p), [pid]);

  /* 아직 서버에 없는 사진이 화면에서 깨진 네모로 보이면 안 된다 —
     폰 안에 바이트가 있으니 그걸로 그린다. 큐 되살리기는 부팅 2초 뒤라
     그 뒤의 메모 목록을 본다. */
  await p.click('.tab-btn[data-tab="memo"]'); await p.waitForTimeout(2600);
  check('...올라가기 전에도 로컬 blob으로 보인다',
    await p.evaluate(() => {
      const im = document.querySelector('.m-photo img');
      return !!im && im.src.indexOf('blob:') === 0;
    }), true);

  // ═══ 3. 연결이 돌아온다 ═══
  uploadsBlocked = false;
  const before = uploadAttempts;
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(3000);

  check('연결이 돌아오면 스스로 다시 올린다', uploadAttempts > before, true);
  check('...서버에 사진이 들어왔다',
    (await fetch(BASE + '/api/photo/' + pid)).status, 200);
  check('...큐가 비워졌다', await qIds(p), []);

  // ═══ 4. 서버가 '안 받는다'고 답한 건 큐에 쌓지 않는다 ═══
  /* 다시 보내도 같은 답이 올 것을 매번 다시 보내면, 영영 비워지지 않는
     큐가 부팅 때마다 같은 실패를 반복한다. */
  await ctx.unroute('**/api/photo');
  await ctx.route('**/api/photo', route => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({ status: 413, contentType: 'application/json',
                           body: JSON.stringify({ error: 'image too large' }) });
  });
  await p.close();
  p = await openPage();
  await addPhoto(p, PNG1);
  await p.waitForTimeout(2500);
  check('413을 받은 사진은 큐에서 빠진다', await qIds(p), []);

  // ═══ 5. 콘솔이 조용한가 ═══
  check('페이지 오류 없음', errs, []);

  await p.close(); await b.close();
  const bad = R.filter(r => !r.ok).length;
  console.log('\n' + (R.length - bad) + '/' + R.length + (bad ? '  ❌ ' + bad + ' FAIL' : '  ✅'));
  process.exit(bad ? 1 : 0);
})();
