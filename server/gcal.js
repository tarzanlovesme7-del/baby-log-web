/* ================================================================
   구글 캘린더로 내보내기

   캘린더를 세 개 보고 있었다 — 지오로그 새싹 탭, 지오로그 이유식 탭,
   구글 캘린더("귀찮아죽겠음", 2026-10-27). 그래서 앱이 쓰는 것을 전부
   구글 쪽으로 밀어 넣는다. 읽기는 구글에서 한 번에.

   세 갈래로 나눠 보낸다 — 구글에서 캘린더마다 따로 껐다 켤 수 있어야
   이유식 90일치가 병원 일정을 덮지 않는다:
     이유식   그날 끼니와 재료
     지오 일정 새싹 탭에 적은 일정(한국 방문, 병원, 예방접종 …)
     내니     출근 도장, 오버타임, 연차, 급여일

   ---- 왜 서비스 계정인가 ----
   사용자 OAuth는 동의 화면을 거쳐 refresh token을 받아야 하고, 그 토큰은
   조용히 만료된다. 서버가 혼자 돌면서 계속 써야 하는 일에는 맞지 않는다.
   서비스 계정은 자기 키로 토큰을 직접 발급받으므로 만료가 없다. 대신
   캘린더 세 개를 그 계정과 '변경 권한'으로 공유해 줘야 한다.

   ---- 왜 googleapis 패키지를 안 쓰나 ----
   필요한 것이 토큰 하나와 REST 네 개(list/insert/patch/delete)뿐이다.
   JWT 서명은 node의 crypto로 열 줄이면 되고, 그만큼 의존성과 버전
   사고가 줄어든다.

   ---- 짝 맞추기는 별도 테이블에서 ----
   "이 기록 = 저 구글 일정"을 app_state에 적으면 동기화가 돌 때마다
   version이 올라가고, 폰 세 대가 그때마다 문서를 통째로 다시 받는다.
   동기화는 사람이 한 일이 아니므로 그 신호를 내보내면 안 된다.
   gcal_map 테이블에 따로 둔다.
   ================================================================ */
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
/* 지난 일까지 끝없이 올려 둘 이유가 없다. 오늘로부터 이만큼 뒤까지만
   본다 — 그보다 오래된 것은 손대지도, 지우지도 않는다. */
const BACK_DAYS = 45;

/* ---- 설정 ---------------------------------------------------- */
function conf(env){
  env = env || process.env;
  var email = env.GCAL_SA_EMAIL || '';
  var key = (env.GCAL_SA_KEY || '').replace(/\\n/g, '\n');
  /* 키 파일을 통째로 넣어 뒀으면 거기서 꺼낸다 — 줄바꿈 때문에 한 줄짜리
     환경변수에 넣다가 깨지는 일이 흔해서, 둘 중 편한 쪽을 쓰게 둔다 */
  if ((!email || !key) && env.GCAL_SA_JSON){
    try {
      var j = JSON.parse(env.GCAL_SA_JSON);
      email = email || j.client_email || '';
      key = key || (j.private_key || '');
    } catch (e) { /* 깨진 JSON은 아래에서 '꺼져 있음'으로 떨어진다 */ }
  }
  var cals = {
    wean: env.GCAL_ID_WEAN || '',
    zio: env.GCAL_ID_ZIO || '',
    nanny: env.GCAL_ID_NANNY || '',
  };
  var on = !!(email && key) && !!(cals.wean || cals.zio || cals.nanny);
  return { email: email, key: key, cals: cals, on: on };
}

/* ---- 토큰 ---------------------------------------------------- */
var cachedToken = null, cachedUntil = 0;
function b64url(buf){
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function accessToken(c, fetchFn){
  var now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedUntil - 60) return cachedToken;
  var header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claim = b64url(JSON.stringify({
    iss: c.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  var signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  var jwt = header + '.' + claim + '.' + b64url(signer.sign(c.key));
  var res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt,
  });
  var body = await res.json().catch(function(){ return {}; });
  if (!res.ok || !body.access_token){
    throw new Error('gcal token ' + res.status + ' ' + JSON.stringify(body).slice(0, 200));
  }
  cachedToken = body.access_token;
  cachedUntil = now + (Number(body.expires_in) || 3600);
  return cachedToken;
}
function resetToken(){ cachedToken = null; cachedUntil = 0; }

/* ---- 날짜 ---------------------------------------------------- */
function p2(n){ return (n < 10 ? '0' : '') + n; }
function ds(d){ return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
function dAdd(s, n){
  var d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ds(d);
}
function today(){ return ds(new Date()); }

/* ---- 이유식 이름 ---------------------------------------------- */
function ingName(state, id){
  var g = (state.weanIngs || []).filter(function(x){ return x.id === id; })[0];
  return g ? (g.ko || id) : id;
}
function mealLine(state, m){
  var base = (m.base || []).map(function(x){
    return ingName(state, x.ing) + (x.g ? ' ' + x.g + 'g' : ''); });
  var tops = (m.tops || []).map(function(x){
    return ingName(state, x.ing) + (x.g ? ' ' + x.g + 'g' : ''); });
  return base.concat(tops).join(' · ');
}
function mealShort(state, m){
  var items = (m.base || []).concat(m.tops || []);
  return items.map(function(x){ return ingName(state, x.ing); }).join(' + ');
}

function fmtVnd(n){
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ₫';
}

/* ---- 무엇을 보낼 것인가 (순수 함수) ---------------------------
   상태를 받아 "있어야 할 구글 일정" 목록을 만든다. 네트워크도 DB도 안
   건드리므로 그대로 시험할 수 있다 — 동기화에서 제일 틀리기 쉬운 곳이
   여기라서 일부러 떼어 놓았다. */
function buildEvents(state, from){
  from = from || dAdd(today(), -BACK_DAYS);
  var out = [];
  function push(key, cal, date, ev){
    if (date < from) return;
    out.push({ key: key, cal: cal, date: date, ev: ev });
  }
  /* 하루짜리 종일 일정 — 구글의 end.date 는 '그 날은 빼고'라서 하루 더 */
  function allDay(a, b){ return { start: { date: a }, end: { date: dAdd(b || a, 1) } }; }

  /* ── 새싹 탭 일정 ── */
  (state.schedules || []).forEach(function(s){
    if (!s || !s.date) return;
    var end = (s.endDate && s.endDate > s.date) ? s.endDate : s.date;
    var ev = { summary: s.text || '(제목 없음)' };
    if (s.translation && s.translation !== s.text) ev.description = s.translation;
    if (s.time && /^\d{2}:\d{2}$/.test(s.time)){
      /* 시각이 적힌 일정은 그 시각에. 끝을 안 적으므로 한 시간으로 둔다 */
      ev.start = { dateTime: s.date + 'T' + s.time + ':00', timeZone: 'Asia/Ho_Chi_Minh' };
      var hh = p2((Number(s.time.slice(0, 2)) + 1) % 24);
      ev.end = { dateTime: s.date + 'T' + hh + ':' + s.time.slice(3) + ':00',
                 timeZone: 'Asia/Ho_Chi_Minh' };
    } else {
      var span = allDay(s.date, end);
      ev.start = span.start; ev.end = span.end;
    }
    push('sched:' + s.id, 'zio', s.date, ev);
  });

  /* ── 이유식 식단 ──
     하루 한 건으로 묶는다. 끼니마다 한 건씩 내면 90일치가 270건이 되고,
     구글 월간 화면이 이유식으로 덮인다. */
  var plan = state.weanPlan || {};
  Object.keys(plan).forEach(function(date){
    var day = plan[date];
    var meals = (day && day.meals) || [];
    if (!meals.length) return;
    var ev = {
      summary: meals.map(function(m){ return mealShort(state, m); }).join(' / '),
      description: meals.map(function(m){
        return (m.name || '') + ' — ' + mealLine(state, m);
      }).join('\n'),
    };
    var span = allDay(date);
    ev.start = span.start; ev.end = span.end;
    push('wean:' + date, 'wean', date, ev);
  });

  /* ── 내니 ── */
  (state.shifts || []).forEach(function(s){
    if (!s || !s.date) return;
    var ev = { summary: '내니 출근' + (s.status === 'pending' ? ' (승인 대기)' : '') };
    var span = allDay(s.date);
    ev.start = span.start; ev.end = span.end;
    push('shift:' + s.id, 'nanny', s.date, ev);
  });
  (state.ot || []).forEach(function(o){
    if (!o || !o.date) return;
    var ev = { summary: '오버타임' + (o.status === 'pending' ? ' (승인 대기)' : '') };
    if (/^\d{2}:\d{2}$/.test(o.start || '') && /^\d{2}:\d{2}$/.test(o.end || '')){
      ev.start = { dateTime: o.date + 'T' + o.start + ':00', timeZone: 'Asia/Ho_Chi_Minh' };
      ev.end = { dateTime: o.date + 'T' + o.end + ':00', timeZone: 'Asia/Ho_Chi_Minh' };
    } else {
      var sp = allDay(o.date); ev.start = sp.start; ev.end = sp.end;
    }
    push('ot:' + o.id, 'nanny', o.date, ev);
  });
  (state.leaves || []).forEach(function(l){
    if (!l || !l.date) return;
    var ev = { summary: '내니 연차' + (l.status === 'pending' ? ' (승인 대기)' : '') };
    var sp = allDay(l.date); ev.start = sp.start; ev.end = sp.end;
    push('leave:' + l.id, 'nanny', l.date, ev);
  });
  (state.payPeriods || []).forEach(function(p){
    if (!p || !p.payday) return;
    var ev = {
      summary: '급여일 · ' + fmtVnd(p.amount) + (p.paidAt ? ' (입금 완료)' : ''),
      description: (p.from || '') + ' ~ ' + (p.to || ''),
    };
    var sp = allDay(p.payday); ev.start = sp.start; ev.end = sp.end;
    push('pay:' + p.id, 'nanny', p.payday, ev);
  });

  return out;
}

/* 내용이 바뀌었는지만 보면 되므로 짧은 해시로 충분하다 */
function hashOf(ev){
  return crypto.createHash('sha1').update(JSON.stringify([
    ev.summary || '', ev.description || '', ev.start, ev.end,
  ])).digest('hex').slice(0, 16);
}

/* ---- 짝 맞추기 테이블 ------------------------------------------ */
async function initTable(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gcal_map (
      key TEXT PRIMARY KEY,
      cal TEXT NOT NULL,
      ev_date DATE NOT NULL,
      event_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/* ---- 구글 호출 ------------------------------------------------ */
function makeApi(c, fetchFn){
  async function call(method, path, body){
    var tok = await accessToken(c, fetchFn);
    var res = await fetchFn(API + path, {
      method: method,
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401){
      /* 토큰이 먼저 죽은 경우 — 한 번만 새로 받아 다시 건다 */
      resetToken();
      tok = await accessToken(c, fetchFn);
      res = await fetchFn(API + path, {
        method: method,
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    if (res.status === 404 || res.status === 410) return null;  /* 이미 없는 것 */
    if (!res.ok){
      var t = await res.text().catch(function(){ return ''; });
      throw new Error('gcal ' + method + ' ' + path + ' → ' + res.status + ' ' + t.slice(0, 200));
    }
    if (res.status === 204) return null;
    return res.json().catch(function(){ return null; });
  }
  return {
    insert: function(calId, ev){
      return call('POST', '/calendars/' + encodeURIComponent(calId) + '/events', ev);
    },
    patch: function(calId, evId, ev){
      return call('PATCH', '/calendars/' + encodeURIComponent(calId) +
        '/events/' + encodeURIComponent(evId), ev);
    },
    remove: function(calId, evId){
      return call('DELETE', '/calendars/' + encodeURIComponent(calId) +
        '/events/' + encodeURIComponent(evId));
    },
  };
}

/* ---- 한 번 돌리기 ---------------------------------------------
   있어야 할 것과 이미 올라간 것을 맞춰 본다. 새 것은 만들고, 내용이
   달라진 것은 고치고, 사라진 것은 지운다. 지우는 범위는 창 안으로
   제한한다 — 오래된 기록까지 훑어 지우면 한 번의 사고가 과거 전체를
   날린다. */
async function syncOnce(opts){
  var pool = opts.pool;
  var state = opts.state;
  var c = opts.conf || conf(opts.env);
  if (!c.on) return { skipped: 'off' };
  var api = opts.api || makeApi(c, opts.fetch || fetch);
  var from = opts.from || dAdd(today(), -BACK_DAYS);

  await initTable(pool);
  var rows = (await pool.query(
    'SELECT key, cal, to_char(ev_date, \'YYYY-MM-DD\') AS ev_date, event_id, hash' +
    ' FROM gcal_map WHERE ev_date >= $1', [from])).rows;
  var have = {};
  rows.forEach(function(r){ have[r.key] = r; });

  var want = buildEvents(state, from).filter(function(w){ return c.cals[w.cal]; });
  var seen = {};
  var made = 0, fixed = 0, gone = 0;

  for (var i = 0; i < want.length; i++){
    var w = want[i];
    seen[w.key] = true;
    var h = hashOf(w.ev);
    var row = have[w.key];
    if (row && row.hash === h && row.cal === w.cal) continue;
    if (row && row.cal === w.cal){
      var patched = await api.patch(c.cals[w.cal], row.event_id, w.ev);
      if (patched === null){
        /* 구글 쪽에서 손으로 지웠다 — 다시 만든다 */
        var again = await api.insert(c.cals[w.cal], w.ev);
        if (!again || !again.id) continue;
        await pool.query(
          'UPDATE gcal_map SET event_id=$2, hash=$3, ev_date=$4, updated_at=now() WHERE key=$1',
          [w.key, again.id, h, w.date]);
        made++;
      } else {
        await pool.query(
          'UPDATE gcal_map SET hash=$2, ev_date=$3, updated_at=now() WHERE key=$1',
          [w.key, h, w.date]);
        fixed++;
      }
      continue;
    }
    if (row && row.cal !== w.cal){
      /* 가는 캘린더가 바뀌었다 — 옛 자리에서 지우고 새로 만든다 */
      await api.remove(c.cals[row.cal], row.event_id);
      await pool.query('DELETE FROM gcal_map WHERE key=$1', [w.key]);
    }
    var created = await api.insert(c.cals[w.cal], w.ev);
    if (!created || !created.id) continue;
    await pool.query(
      'INSERT INTO gcal_map (key, cal, ev_date, event_id, hash) VALUES ($1,$2,$3,$4,$5)' +
      ' ON CONFLICT (key) DO UPDATE SET cal=$2, ev_date=$3, event_id=$4, hash=$5, updated_at=now()',
      [w.key, w.cal, w.date, created.id, h]);
    made++;
  }

  for (var j = 0; j < rows.length; j++){
    var r = rows[j];
    if (seen[r.key]) continue;
    if (!c.cals[r.cal]) continue;
    await api.remove(c.cals[r.cal], r.event_id);
    await pool.query('DELETE FROM gcal_map WHERE key=$1', [r.key]);
    gone++;
  }
  return { made: made, fixed: fixed, gone: gone, want: want.length };
}

/* ---- 언제 돌리나 ----------------------------------------------
   쓰기 한 번에 한 번씩 돌리면, 도장 찍고 메모 고치는 몇 초 사이에
   구글을 여러 번 두드린다. 마지막 쓰기로부터 잠깐 조용해지면 그때
   한 번 돈다. 그래도 놓치는 것이 있을 수 있어 30분마다 한 번 더. */
var pending = null;
function scheduleSync(getState, pool, delayMs){
  var c = conf();
  if (!c.on) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(function(){
    pending = null;
    runSync(getState, pool).catch(function(e){ console.error('[gcal]', e.message); });
  }, delayMs == null ? 8000 : delayMs);
  if (pending.unref) pending.unref();
}
async function runSync(getState, pool){
  var s = await getState();
  var r = await syncOnce({ pool: pool, state: s.data || s });
  if (r && !r.skipped && (r.made || r.fixed || r.gone)){
    console.log('[gcal] +' + r.made + ' ~' + r.fixed + ' -' + r.gone + ' / ' + r.want);
  }
  return r;
}
function start(getState, pool){
  var c = conf();
  if (!c.on){
    console.log('[gcal] 꺼져 있음 — GCAL_SA_EMAIL / GCAL_SA_KEY / GCAL_ID_* 를 넣으면 켜진다');
    return;
  }
  console.log('[gcal] 켜짐 — ' + Object.keys(c.cals)
    .filter(function(k){ return c.cals[k]; }).join(', '));
  setTimeout(function(){
    runSync(getState, pool).catch(function(e){ console.error('[gcal]', e.message); });
  }, 15000).unref?.();
  var t = setInterval(function(){
    runSync(getState, pool).catch(function(e){ console.error('[gcal]', e.message); });
  }, 30 * 60 * 1000);
  if (t.unref) t.unref();
}

module.exports = {
  conf, buildEvents, hashOf, syncOnce, scheduleSync, runSync, start,
  initTable, makeApi, _resetToken: resetToken, BACK_DAYS,
};
