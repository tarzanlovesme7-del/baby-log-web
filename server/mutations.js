// mutations.js — the authoritative reducer. Every write the app makes goes
// through applyMutation(state, type, payload) so concurrent edits from
// different family members/devices are serialized by the DB's optimistic
// version check in db.js rather than silently clobbering each other.
const crypto = require('crypto');

function uid(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// noteTranslated/noteLang: an entry's note gets the same auto-translation the
// memo tab does, so the Korean-speaking and Vietnamese-speaking members of the
// household both read every note. Stored alongside the note rather than
// re-translated on each render (translation is a network call, and the stored
// text is what every other viewer's poll picks up).
/* 이유식 기록이 더 얹는 것: 먹은 양(ate) · 이상 반응(react) · 그날 준 것의
   사본(menu 글자, ings 목록). 사본을 들고 있는 이유는 식단표를 나중에 고쳐도
   "그날 실제로 뭘 줬나"가 흔들리면 안 되기 때문이다. */
const ALLOWED_ENTRY_FIELDS = ['type', 'start', 'end', 'amount', 'diaper', 'temp', 'note', 'noteLang', 'noteTranslated', 'author', 'sleepKind', 'wakes', 'ate', 'react', 'menu', 'mealName', 'ings',
  /* 기록 화면 개편에서 들어온 칸들. photos 는 메모·일기와 같은 저장소를
     가리키는 참조만 담는다(바이트는 photos 테이블에 있다) — server.js 의
     고아 사진 청소기가 이 목록을 읽는다. */
  'poop', 'tempSite', 'med', 'medUnit', 'photos'];
const POOP_KINDS = ['', 'loose', 'normal', 'firm', 'mucus', 'blood'];
const TSITE_KINDS = ['ear', 'brow', 'arm'];

/* ---------------------------------------------------------------
   WHO MAY DELETE WHAT

   The nanny started using the app and deleted one of mom's records
   by accident on her first day. There are no accounts here — a phone
   is whoever it says it is in settings — so this is not security, it
   is a guard rail. It guards DELETION only: anyone may edit any
   record (the family hands care over mid-record all day), you may
   delete what you wrote, and mom may delete anything.

   Names are compared by WHICH of the three presets they are, not by
   their letters: the same person is '내니' on a Korean screen and
   'Bảo mẫu' on a Vietnamese one, and both must count as the same
   author. The lists are kept in step with the ones in the client.
   --------------------------------------------------------------- */
const PRESET_AUTHORS = [['엄마', 'Mẹ'], ['아빠', 'Bố'], ['내니', 'Bảo mẫu']];
const MASTER_INDEX = 0;   // 엄마

function authorIndex(name) {
  const n = (name || '').trim();
  for (let i = 0; i < PRESET_AUTHORS.length; i++) {
    if (PRESET_AUTHORS[i].indexOf(n) !== -1) return i;
  }
  return -1;
}
function sameAuthor(a, b) {
  const ia = authorIndex(a), ib = authorIndex(b);
  if (ia !== -1 || ib !== -1) return ia === ib;
  return (a || '').trim() !== '' && (a || '').trim() === (b || '').trim();
}
function isMaster(actor) {
  return authorIndex(actor) === MASTER_INDEX;
}
/* ONE PERSON, ONE STORED NAME.
   The name went onto the record in whatever language the phone was set to,
   so the nanny is '내니' on 21 records and 'Bảo mẫu' on 195 — one person
   filed as two, and every per-person view split down the middle with her.
   The comparisons above already knew the two were the same; what got
   STORED did not.

   The Korean preset is the stored form — arbitrarily, but consistently —
   and the screens translate it for whoever is reading. That is already
   what a custom name does: '외할머니' is stored once and shown with its
   Vietnamese form. Normalised here as well as on the phone, so an old page
   still open somewhere cannot go on writing the other spelling. */
function canonAuthor(state, name) {
  const n = (name || '').trim();
  if (!n) return n;
  const i = authorIndex(n);
  if (i !== -1) return PRESET_AUTHORS[i][0];
  const custom = (state.customAuthors || []).find((c) => c && (c.name === n || c.nameVi === n));
  return custom ? (custom.name || n) : n;
}
/* An actor is only trusted as far as the phone that claims it. Mutations
   carry it as payload.actor; a client that omits it gets the old
   everyone-can-do-everything behaviour, which is why the client always
   sends it. */
function assertMayTouch(actor, ownerName, what) {
  if (actor === undefined) return;            // pre-permissions client
  if (isMaster(actor)) return;
  if (sameAuthor(ownerName, actor)) return;
  throw httpError(403, 'not-owner:' + (what || 'entry'));
}
const TRASH_DAYS = 30;
/* the pastel voices a schedule may wear on the growth calendar */
const SCHED_COLORS = ['sky', 'mint', 'peach', 'lilac', 'lemon', 'rose'];
function pruneTrash(state) {
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  state.trash = (state.trash || []).filter((t) => {
    const at = new Date(t.deletedAt || 0).getTime();
    return !(at < cutoff);
  });
}

/* ================================================================
   내니 근무와 급여
   ================================================================
   도장 하나가 하루 일당이고, 오버타임은 시작·종료 시각으로 들어와 분 단위로
   값이 매겨진다. 105,000 ₫/h는 1,750 ₫/분이라 몇 분이 나오든 동 단위로 딱
   떨어져서 반올림 규칙이 없다.

   내니가 넣은 것 중 오늘 도장만 바로 반영되고, 지난 날짜 도장과 모든
   오버타임은 status:'pending'으로 들어와 엄마가 승인해야 금액이 된다. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/* 3분 안에 또 찍힌 깸은 같은 깸으로 본다 */
const WAKE_DEDUPE_MS = 3 * 60 * 1000;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* 0~6 정수만, 중복 없이, 정렬해서. 전부 쉬는 날로 두면 근무일이 0이 되어
   '정상 근무 시 금액'이 뜻을 잃으므로 그건 기본값으로 되돌린다. */
function cleanOffDays(v) {
  if (!Array.isArray(v)) return [0];
  const out = [...new Set(v.map((x) => Math.round(Number(x))).filter((x) => x >= 0 && x <= 6))].sort();
  return out.length && out.length < 7 ? out : [0];
}
function payrollOf(state) {
  const p = state.payroll || {};
  return {
    daily: Number(p.daily) || 800000,
    hourly: Number(p.hourly) || 70000,
    meal: Number(p.meal) || 100000,
    otMul: Number(p.otMul) || 1.5,
    startDate: DATE_RE.test(p.startDate || '') ? p.startDate : '2026-09-16',
    /* 계약상 근무는 07:00~17:00(10시간). 단축 근무한 날의 실근시간을 여기서부터
       센다 — 도장 찍은 시각부터 세면 깜빡하고 늦게 찍은 날 급여가 깎인다. */
    startTime: HM_RE.test(p.startTime || '') ? p.startTime : '07:00',
    /* 유급 연차. 계약은 원래 "일급제라 연차는 무급"이었고, 2026-09에 유급으로
       바꾸기로 했다. 일수는 근무 개월 비례가 아니라 합의한 고정값(11일)이고,
       하루 금액은 일당 그대로다 — 근무와 같은 금액이라 설명할 것이 없다. */
    leaveDays: Number.isFinite(Number(p.leaveDays)) && Number(p.leaveDays) >= 0 ? Number(p.leaveDays) : 11,
    leavePay: Number.isFinite(Number(p.leavePay)) && Number(p.leavePay) >= 0 ? Number(p.leavePay) : 800000,
    /* 주중 쉬는 요일(0=일 … 6=토). 내니는 월~토 근무라 기본은 일요일 하나.
       '정상 근무 시 얼마'를 세려면 어느 날이 원래 근무일인지 알아야 한다. */
    offDays: cleanOffDays(p.offDays),
  };
}
const FEED_PLAN_DEFAULT = {
  mode: 'fixed',
  times: ['07:00', '11:00', '15:00', '19:00'],
  startTime: '07:00',
  intervalMin: 240,
  count: 4,
  perFeed: 200,
  goal: 1000,
  maxGapMin: 240,
  quietFrom: '22:00',
  rateMl: 200,
  rateMin: 240,
  nightFrom: '23:00',
  nightTo: '06:00',
};
/* 어느 필드가 빠져 있어도 기본값으로 메워서 돌려준다. 클라이언트는 이걸
   그대로 믿고 그리므로, 여기서 걸러지지 않은 값은 화면에 나오지 않는다. */
function feedPlanOf(state) {
  const p = state.feedPlan || {};
  const times = Array.isArray(p.times)
    ? p.times.filter((x) => HM_RE.test(x || '')).slice(0, 12).sort()
    : [];
  const MODES = ['fixed', 'interval', 'amount'];
  return {
    mode: MODES.indexOf(p.mode) >= 0 ? p.mode : 'fixed',
    times: times.length ? times : FEED_PLAN_DEFAULT.times.slice(),
    startTime: HM_RE.test(p.startTime || '') ? p.startTime : FEED_PLAN_DEFAULT.startTime,
    intervalMin: clampNum(p.intervalMin, 30, 12 * 60, FEED_PLAN_DEFAULT.intervalMin),
    count: clampNum(p.count, 1, 12, FEED_PLAN_DEFAULT.count),
    perFeed: clampNum(p.perFeed, 0, 2000, FEED_PLAN_DEFAULT.perFeed),
    goal: clampNum(p.goal, 0, 5000, FEED_PLAN_DEFAULT.goal),
    maxGapMin: clampNum(p.maxGapMin, 30, 24 * 60, FEED_PLAN_DEFAULT.maxGapMin),
    quietFrom: HM_RE.test(p.quietFrom || '') ? p.quietFrom : FEED_PLAN_DEFAULT.quietFrom,
    /* 용량에 따라: 기준 용량 rateMl를 rateMin에 먹는 속도로 본다.
       200 ml = 240분이면 150 ml는 180분 뒤가 다음 차례다. */
    rateMl: clampNum(p.rateMl, 1, 2000, FEED_PLAN_DEFAULT.rateMl),
    rateMin: clampNum(p.rateMin, 10, 12 * 60, FEED_PLAN_DEFAULT.rateMin),
    /* 밤에는 안 먹인다 — 이 사이에 걸리는 차례는 끝 시각으로 미룬다 */
    nightFrom: HM_RE.test(p.nightFrom || '') ? p.nightFrom : FEED_PLAN_DEFAULT.nightFrom,
    nightTo: HM_RE.test(p.nightTo || '') ? p.nightTo : FEED_PLAN_DEFAULT.nightTo,
  };
}
function clampNum(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
/* 도장 하나 = 일당 전액. 퇴근 시각이 (승인된 채로) 들어와 있으면 그날만
   시급 × 실근시간 + 식대로 계산한다. 정상 근무 시간을 넘겨 적어도 일당을
   넘지는 않는다 — 그 위는 오버타임이 맡는 몫이다. */
const hm2min = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
/* 정상 근무가 몇 분인지는 계약에서 나온다: (일당 - 식대) / 시급.
   800,000 - 100,000 = 700,000 / 70,000 = 10시간. */
function stdMinutes(r) {
  if (!r.hourly) return 600;
  return Math.round(((r.daily - r.meal) / r.hourly) * 60);
}
/* 그날 실제로 일한 분. 손대지 않은 쪽은 계약상 시각을 쓴다 — 늦게 왔다고만
   적은 날에 퇴근까지 적게 만들 이유가 없다. */
function shiftMinutes(sh, r) {
  if (!sh || (!HM_RE.test(sh.start || '') && !HM_RE.test(sh.end || ''))) return null;
  const a = HM_RE.test(sh.start || '') ? hm2min(sh.start) : hm2min(r.startTime);
  const b = HM_RE.test(sh.end || '') ? hm2min(sh.end) : hm2min(r.startTime) + stdMinutes(r);
  return b > a ? b - a : 0;
}
function shiftWage(sh, r) {
  if (!sh || sh.status !== 'ok') return 0;
  if (sh.timeStatus !== 'ok') return r.daily;     /* 대기 중이면 아직 일당 */
  const mins = shiftMinutes(sh, r);
  if (mins === null) return r.daily;
  return Math.min(r.daily, Math.round(r.hourly * mins / 60) + r.meal);
}
function otMinutes(o) {
  if (!HM_RE.test(o.start || '') || !HM_RE.test(o.end || '')) return 0;
  const a = Number(o.start.slice(0, 2)) * 60 + Number(o.start.slice(3));
  let b = Number(o.end.slice(0, 2)) * 60 + Number(o.end.slice(3));
  /* 22:00 → 00:30 은 자정을 넘긴 것이지 음수가 아니다 */
  if (b <= a) b += 24 * 60;
  return b - a;
}
function assertMaster(actor, what) {
  if (actor === undefined) return;
  if (isMaster(actor)) return;
  throw httpError(403, 'not-owner: ' + what);
}

/* ================================================================
   이유식
   ================================================================
   식단표(weanPlan)가 단 하나의 출처다. 장보기는 거기서 계산하고, 저장하는
   것은 계산과의 차이(weanShop)뿐이다. 재료 사전(weanIngs)이 이름·단위·
   늘 이만큼·큐브 한 칸을 들고 있고 나머지 화면은 그걸 읽어 쓴다.

   ATE 값은 네 가지뿐이고 ''(안 적음)이 기본이다 — 빠른 기록으로 한 번
   눌러 저장하면 여기는 비어 있고, 나중에 기록 상세에서 채운다.
   '다 먹음'을 임의로 넣지 않는다: 안 적은 것과 다 먹은 것은 다른 사실이다. */
const ATE_KINDS = ['', 'full', 'half', 'little', 'refused'];
const REACT_KINDS = ['', 'none', 'rash', 'diarrhea', 'vomit', 'other'];
const WEAN_UNITS = ['g', 'ea', 'tbsp'];

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
/* 재료 목록은 {ing,g} 쌍만 통과시킨다. 통째로 받은 배열을 그대로 문서에
   넣으면 폰 하나가 보낸 아무 모양이나 공유 상태에 들어앉는다. */
function cleanIngList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const ing = String(raw.ing || '').trim();
    if (!ing) continue;
    out.push({ ing, g: Math.max(0, Math.round(num(raw.g, 0))) });
    if (out.length >= 24) break;
  }
  return out;
}
/* from..to 를 날짜 문자열로 편다. to 포함. 400일이 넘으면 자른다 —
   기간 칸에 손이 미끄러진 값이 들어와도 서버가 멈추지는 않게. */
function dateRange(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/* 그 날에서 이름이 같은 끼니 하나를 뺀다. 그 날에 아무것도 안 남으면 날 자체를
   지운다 — 빈 날이 남아 있으면 달력이 '식단 있음'으로 세어 버린다. */
function dropMealOn(state, ds, name) {
  const day = state.weanPlan && state.weanPlan[ds];
  if (!day || !Array.isArray(day.meals)) return false;
  const meals = day.meals.filter((m) => (m.name || '') !== name);
  if (meals.length === day.meals.length) return false;
  if (meals.length) state.weanPlan[ds] = { meals };
  else delete state.weanPlan[ds];
  return true;
}

function cleanMeals(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    out.push({
      name: String(raw.name || '').slice(0, 20),
      /* 베이스죽('쌀오트밀죽')은 그 자체가 재료다 — 곡물가루를 따로 재료로
         두고 이름을 덧붙이면 냉동실에 있는 것(쌀죽 큐브)과 재료 목록에 있는
         것(쌀가루)이 어긋나고, 식단표를 고칠 때마다 둘을 맞춰야 한다.
         그래서 base는 isBase 재료 한 칸이다. */
      base: cleanIngList(raw.base),
      tops: cleanIngList(raw.tops),
    });
    if (out.length >= 6) break;
  }
  return out;
}
const WEAN_CATS = ['grain', 'veg', 'protein', 'fruit', 'etc'];
const WEAN_REACTS = ['rash', 'diarrhea', 'vomit', 'other'];

function weanIngsOf(state) {
  return Array.isArray(state.weanIngs) ? state.weanIngs : [];
}
/* 큐브는 '만든 날'마다 한 덩어리다.

   한 재료에 한 줄만 두면 9/28에 만든 여덟 칸과 9/30에 만든 열 칸이 한 줄로
   합쳐지고, 만든 날은 나중 것으로 덮인다 — 그러면 9/28 것이 2주를 넘겨도
   아무 말이 없다. 오래된 큐브를 잡아내는 것이 이 화면이 하는 일의 절반이라
   덩어리째 들고 있는다. 먹일 때는 오래된 덩어리부터 빠진다. */
function cubesOf(state, ing) {
  state.weanCubes = Array.isArray(state.weanCubes) ? state.weanCubes : [];
  return state.weanCubes
    .filter((c) => c && c.ing === ing)
    .sort((a, b) => String(a.madeOn || '').localeCompare(String(b.madeOn || '')));
}
function defaultPerG(state, ing) {
  const meta = weanIngsOf(state).find((x) => x.id === ing);
  return meta ? Math.max(1, Math.round(num(meta.cubeG, 10))) : 10;
}
/* 오래된 덩어리부터 n칸 뺀다. 빈 덩어리는 치운다. */
function takeCubes(state, ing, n) {
  let left = Math.max(0, Math.round(n));
  for (const c of cubesOf(state, ing)) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, Math.round(num(c.n, 0))));
    c.n = Math.max(0, Math.round(num(c.n, 0))) - take;
    left -= take;
  }
  state.weanCubes = state.weanCubes.filter((c) => Math.round(num(c.n, 0)) > 0);
}
/* n칸 더한다. 같은 날 같은 용량이면 그 덩어리에 합치고, 아니면 새 덩어리. */
function addCubes(state, ing, n, perG, madeOn) {
  const add = Math.max(0, Math.round(n));
  if (!add) return null;
  state.weanCubes = Array.isArray(state.weanCubes) ? state.weanCubes : [];
  const g = Math.max(1, Math.round(num(perG, defaultPerG(state, ing))));
  const day = DATE_RE.test(madeOn || '') ? madeOn : new Date().toISOString().slice(0, 10);
  let row = state.weanCubes.find((c) => c.ing === ing && c.madeOn === day && Math.round(num(c.perG, 0)) === g);
  if (!row) { row = { id: uid('c_'), ing, n: 0, perG: g, madeOn: day }; state.weanCubes.push(row); }
  row.n = Math.max(0, Math.round(num(row.n, 0))) + add;
  return row;
}
/* 이유식을 한 건 기록하면 그날 쓴 재료가 한 칸씩 빠진다. 지우면 되돌아온다.
   수정(updateEntry)에서는 건드리지 않는다 — 재료가 바뀌는 일은 드물고,
   재고 화면의 − + 가 언제나 정답을 이긴다. */
function bumpCubesForEntry(state, entry, sign) {
  if (!entry || entry.type !== 'wean') return;
  const list = cleanIngList(entry.ings);
  for (const it of list) {
    if (sign < 0) takeCubes(state, it.ing, 1);
    else {
      /* 되돌릴 때는 가장 오래된 덩어리로 — 그게 빠졌던 자리다.
         남은 덩어리가 없으면 그날 만든 것으로 하나 세운다. */
      const olds = cubesOf(state, it.ing);
      if (olds.length) olds[0].n = Math.max(0, Math.round(num(olds[0].n, 0))) + 1;
      else addCubes(state, it.ing, 1, defaultPerG(state, it.ing), (entry.start || '').slice(0, 10));
    }
  }
}
/* 월요일 기준 주 키. 장보기는 주 단위다. */
function weekKey(ds) {
  if (!DATE_RE.test(ds || '')) return '';
  const d = new Date(ds + 'T00:00:00Z');
  const dow = d.getUTCDay();             /* 0=일 */
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function applyMutation(prevState, type, payload) {
  const state = clone(prevState);
  payload = payload || {};
  /* every write carries at most two names — who is doing it, and whose
     record it is filed under. Both arrive in the writer's language. */
  if (typeof payload.author === 'string' || typeof payload.actor === 'string') {
    payload = Object.assign({}, payload);
    if (typeof payload.author === 'string') payload.author = canonAuthor(state, payload.author);
    if (typeof payload.actor === 'string') payload.actor = canonAuthor(state, payload.actor);
  }

  switch (type) {
    case 'addEntry': {
      const entry = { id: uid('e_'), start: payload.start || new Date().toISOString() };
      entry.end = payload.end || entry.start;
      ALLOWED_ENTRY_FIELDS.forEach((f) => { if (payload[f] !== undefined) entry[f] = payload[f]; });
      if (!entry.type) throw httpError(400, 'entry requires a type');
      cleanEntryExtras(entry);
      if (entry.type === 'wean') {
        entry.ate = ATE_KINDS.indexOf(entry.ate) > 0 ? entry.ate : '';
        entry.react = REACT_KINDS.indexOf(entry.react) > 0 ? entry.react : '';
        entry.menu = String(entry.menu || '').slice(0, 200);
        entry.ings = cleanIngList(entry.ings);
      }
      state.entries.unshift(entry);
      bumpCubesForEntry(state, entry, -1);
      return { state, result: { entry } };
    }

    case 'updateEntry': {
      const idx = state.entries.findIndex((e) => e.id === payload.id);
      if (idx === -1) throw httpError(404, 'entry not found');
      const entry = state.entries[idx];
      /* EDITS ARE FREE, DELETES ARE NOT. The care hands over mid-record all
         day — mom starts the sleep, dad is holding him when he wakes, and
         the person closing the record is routinely not the person who
         opened it. Locking edits to the author made the app fight the
         handover. Deleting is the one thing that destroys information, so
         it alone stays owner-or-mom (see deleteEntry below). */
      ALLOWED_ENTRY_FIELDS.forEach((f) => { if (payload[f] !== undefined) entry[f] = payload[f]; });
      cleanEntryExtras(entry);
      if (entry.type === 'wean') {
        entry.ate = ATE_KINDS.indexOf(entry.ate) > 0 ? entry.ate : '';
        entry.react = REACT_KINDS.indexOf(entry.react) > 0 ? entry.react : '';
        if (entry.menu !== undefined) entry.menu = String(entry.menu || '').slice(0, 200);
        if (entry.ings !== undefined) entry.ings = cleanIngList(entry.ings);
      }
      return { state, result: { entry } };
    }

    /* Deleting moves the record to the bin instead of dropping it. The whole
       app is one JSON document overwritten in place, so before this a delete
       was final everywhere at once — there was nothing left to restore from,
       not even in the database. */
    /* DELETING SOMETHING ALREADY GONE IS NOT AN ERROR. Three phones share
       this log: 엄마 deletes a record, 아빠's screen still shows it for up
       to four seconds, he taps delete too — and used to be told "entry not
       found", with the row springing back onto his screen as if the delete
       had failed. It had not; it had already happened. The ask ("make this
       record not exist") is satisfied either way, so a delete that finds
       nothing to do answers quietly instead of raising. The same goes for a
       tap that lands twice on one phone. */
    /* ================================================================
       밤중에 깬 시각

       수면 기록 안의 문자열 배열(entry.wakes)이다. updateEntry로 배열째
       보내면 엄마 폰과 아빠 폰이 각자 자기가 들고 있던 배열로 덮어써서 서로의
       기록을 지운다 — 그래서 '하나 더한다/하나 뺀다'만 서버에서 한다.

       3분 규칙도 여기 있다. 새벽에 손이 미끄러져 두 번 눌리는 것과, 두 사람이
       같은 깸을 각자 찍는 것은 같은 사고이고 둘 다 폰 한 대에서는 막을 수
       없다. */
    case 'addWake': {
      const entry = state.entries.find((e) => e.id === payload.id);
      if (!entry) throw httpError(404, 'entry not found');
      if (entry.type !== 'sleep') throw httpError(400, 'wakes belong to a sleep record');
      const at = payload.at || new Date().toISOString();
      if (isNaN(new Date(at).getTime())) throw httpError(400, 'bad wake time');
      const list = (entry.wakes || []).filter((w) => !isNaN(new Date(w).getTime()));
      const t0 = new Date(at).getTime();
      const near = list.find((w) => Math.abs(new Date(w).getTime() - t0) < WAKE_DEDUPE_MS);
      if (near) return { state, result: { duplicate: true, at: near } };
      list.push(at);
      list.sort();
      entry.wakes = list;
      return { state, result: { entry, at } };
    }

    case 'deleteWake': {
      const entry = state.entries.find((e) => e.id === payload.id);
      if (!entry) throw httpError(404, 'entry not found');
      const before = (entry.wakes || []).length;
      entry.wakes = (entry.wakes || []).filter((w) => w !== payload.at);
      /* 이미 지워진 걸 또 지우는 건 오류가 아니다 — 폰 세 대가 같은 목록을 본다 */
      return { state, result: { removed: before - entry.wakes.length } };
    }

    case 'deleteEntry': {
      const entry = state.entries.find((e) => e.id === payload.id);
      if (!entry) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, entry.author, 'entry');
      state.entries = state.entries.filter((e) => e.id !== payload.id);
      bumpCubesForEntry(state, entry, +1);   /* 먹이지 않은 것이 되었으니 큐브도 돌아온다 */
      state.trash = state.trash || [];
      state.trash.unshift(Object.assign({}, entry, {
        deletedAt: new Date().toISOString(),
        deletedBy: payload.actor || '',
      }));
      pruneTrash(state);
      return { state, result: {} };
    }

    case 'restoreEntry': {
      state.trash = state.trash || [];
      const t = state.trash.find((x) => x.id === payload.id);
      if (!t) throw httpError(404, 'not in the bin');
      assertMayTouch(payload.actor, t.author, 'entry');
      const entry = Object.assign({}, t);
      delete entry.deletedAt; delete entry.deletedBy;
      state.trash = state.trash.filter((x) => x.id !== payload.id);
      state.entries.unshift(entry);
      bumpCubesForEntry(state, entry, -1);
      return { state, result: { entry } };
    }

    /* Emptying the bin for good — mom only, and never automatic. */
    case 'purgeTrash': {
      if (payload.actor !== undefined && !isMaster(payload.actor)) {
        throw httpError(403, 'not-owner:trash');
      }
      state.trash = payload.id
        ? (state.trash || []).filter((x) => x.id !== payload.id)
        : [];
      return { state, result: {} };
    }

    case 'startActive': {
      if (!payload.type) throw httpError(400, 'startActive requires a type');
      state.active = {
        type: payload.type,
        start: payload.start || new Date().toISOString(),
        name: payload.name || '',
        author: payload.author || '',
        paused: false,
        pausedAt: null,
      };
      return { state, result: { active: state.active } };
    }

    case 'togglePauseActive': {
      const a = state.active;
      /* 이미 끝난 스톱워치를 또 만지는 건 오류가 아니라 '이미 그렇게 됨'이다 —
         폰 세 대가 같은 화면을 보고 있고, 두 번째 손가락은 늘 늦게 닿는다.
         오류로 돌려보내면 그 쓰기가 아웃박스에 박혀서 뒤를 다 막는다. */
      if (!a) return { state, result: { alreadyFinished: true } };
      // The phone draws the result of this the instant it is tapped, so it
      // has to be able to work out the same answer we do. It sends the moment
      // of the tap; without one (an older tab) we fall back to our own clock
      // and the two may differ by the round trip.
      const at = payload.at ? new Date(payload.at) : new Date();
      if (Number.isNaN(at.getTime())) throw httpError(400, 'togglePauseActive: bad at');
      if (a.paused) {
        // resume: shift start forward by however long the pause lasted so
        // elapsed = now - start keeps excluding the paused span
        const pausedMs = at.getTime() - new Date(a.pausedAt).getTime();
        a.start = new Date(new Date(a.start).getTime() + pausedMs).toISOString();
        a.paused = false;
        a.pausedAt = null;
      } else {
        a.paused = true;
        a.pausedAt = at.toISOString();
      }
      return { state, result: { active: a } };
    }

    case 'adjustActiveStart': {
      const a = state.active;
      if (!a) return { state, result: { alreadyFinished: true } };
      if (!payload.start) throw httpError(400, 'adjustActiveStart requires start');
      a.start = payload.start;
      return { state, result: { active: a } };
    }

    case 'cancelActive': {
      state.active = null;
      return { state, result: {} };
    }

    case 'finishActive': {
      const a = state.active;
      if (!a) return { state, result: { alreadyFinished: true } };
      /* the phone may still owe the server a start-time nudge from the
         adjust ruler (those are sent once the ruler settles) — the finish
         carries the start the phone is showing, so what lands is what the
         family saw on screen */
      if (payload.start) {
        const st = new Date(payload.start);
        if (Number.isNaN(st.getTime())) throw httpError(400, 'finishActive: bad start');
        a.start = st.toISOString();
      }
      // same reason as togglePauseActive: the phone has already drawn this
      // record, so the end time it drew is the one that must be stored
      let end = a.paused && a.pausedAt ? a.pausedAt : new Date().toISOString();
      if (payload.end) {
        const t = new Date(payload.end);
        if (Number.isNaN(t.getTime())) throw httpError(400, 'finishActive: bad end');
        end = t.toISOString();
      }
      if (new Date(end) < new Date(a.start)) throw httpError(400, 'finishActive: end before start');
      const entry = {
        id: uid('e_'), type: a.type, start: a.start, end,
        author: a.author || payload.author || '', note: '',
      };
      state.entries.unshift(entry);
      state.active = null;
      return { state, result: { entry } };
    }

    /* A memo may carry photos. What is stored HERE is only which pictures
       belong to it and what shape they are — the bytes live in their own
       table (server/photos.js), because this document is re-sent to every
       phone whenever any part of it changes. */
    case 'addMemo': {
      if (!payload.text || !payload.text.trim()) throw httpError(400, 'memo text required');
      const memo = {
        id: uid('m_'),
        text: payload.text.trim(),
        lang: payload.lang || 'other',
        translation: payload.translation || '',
        author: payload.author || '',
        ts: new Date().toISOString(),
      };
      const photos = normalizePhotos(payload.photos);
      if (photos.length) memo.photos = photos;
      /* 지급일 요약 메모는 기간마다 딱 하나 — 어느 폰이 올렸든 같은 표식을
         달고 있어서, 이미 있는지 보고 두 번 올리지 않는다 */
      if (typeof payload.paydayKey === 'string' && payload.paydayKey) {
        if ((state.memos || []).some((m) => m.paydayKey === payload.paydayKey)) {
          return { state, result: { duplicate: true } };
        }
        memo.paydayKey = payload.paydayKey;
      }
      state.memos.unshift(memo);
      return { state, result: { memo } };
    }

    /* A memo is posted immediately and its translation — and its pictures,
       which have to finish uploading — are filled in afterwards, so both
       arrive as their own write rather than as part of the memo. Only those
       two may be set this way: the text a person typed is never rewritten by
       a background job. */
    case 'updateMemo': {
      const memo = state.memos.find((m) => m.id === payload.id);
      if (!memo) throw httpError(404, 'memo not found');
      /* a PERSON editing their words is allowed (text present) — what stays
         forbidden is a background job rewriting them; machine writes only
         ever carry translation/photos */
      if (payload.text !== undefined) {
        const text = String(payload.text || '').trim();
        if (!text && !(memo.photos || []).length) throw httpError(400, 'memo text required');
        memo.text = text;
        memo.lang = payload.lang || memo.lang || 'other';
        memo.translation = payload.translation || '';
      }
      if (payload.translation !== undefined) memo.translation = payload.translation;
      if (payload.photos !== undefined) {
        const photos = normalizePhotos(payload.photos);
        if (photos.length) memo.photos = photos; else delete memo.photos;
      }
      return { state, result: { memo } };
    }

    /* Replies live INSIDE their memo — one thread, one place. They ride the
       same document as everything else, so a reply is a few hundred bytes,
       and deleting the memo takes its thread with it with no orphan hunt. */
    case 'addMemoReply': {
      const memo = state.memos.find((m) => m.id === payload.memoId);
      if (!memo) throw httpError(404, 'memo not found');
      if (!payload.text || !payload.text.trim()) throw httpError(400, 'reply text required');
      const reply = {
        id: uid('r_'),
        text: String(payload.text).trim().slice(0, 2000),
        lang: payload.lang || 'other',
        translation: payload.translation || '',
        author: payload.author || '',
        ts: new Date().toISOString(),
      };
      memo.replies = memo.replies || [];
      memo.replies.push(reply);
      return { state, result: { reply } };
    }

    /* same contract as updateMemo: only the machine-written part (the
       translation) may be filled in afterwards — never the typed text */
    case 'updateMemoReply': {
      const memo = state.memos.find((m) => m.id === payload.memoId);
      if (!memo) throw httpError(404, 'memo not found');
      const reply = (memo.replies || []).find((r) => r.id === payload.id);
      if (!reply) throw httpError(404, 'reply not found');
      if (payload.text !== undefined) {
        const text = String(payload.text || '').trim().slice(0, 2000);
        if (!text) throw httpError(400, 'reply text required');
        reply.text = text;
        reply.lang = payload.lang || reply.lang || 'other';
        reply.translation = payload.translation || '';
      }
      if (payload.translation !== undefined) reply.translation = payload.translation;
      return { state, result: { reply } };
    }

    case 'deleteMemoReply': {
      const memo = state.memos.find((m) => m.id === payload.memoId);
      if (!memo) return { state, result: { alreadyGone: true } };
      const reply = (memo.replies || []).find((r) => r.id === payload.id);
      if (!reply) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, reply.author, 'reply');
      memo.replies = memo.replies.filter((r) => r.id !== payload.id);
      if (!memo.replies.length) delete memo.replies;
      return { state, result: {} };
    }

    case 'deleteMemo': {
      const memo = state.memos.find((m) => m.id === payload.id);
      if (!memo) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, memo.author, 'memo');
      state.memos = state.memos.filter((m) => m.id !== payload.id);
      /* the caller deletes the bytes once this write has actually landed —
         doing it first would lose the pictures on a version conflict */
      return { state, result: { removedPhotos: (memo.photos || []).map((p) => p.id) } };
    }

    /* WEIGHT — one number per day, so a second measurement on the same date
       REPLACES the first rather than drawing a zigzag through the chart.
       Kilograms, one decimal in practice; the range guard is generous
       (0.3–30) because it only exists to reject typos like 76 for 7.6. */
    case 'addWeight': {
      const kg = Number(payload.kg);
      if (!isFinite(kg) || kg < 0.3 || kg > 30) throw httpError(400, 'weight out of range');
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'bad date');
      state.weights = state.weights || [];
      const existing = state.weights.find((w) => w.date === date);
      let weight;
      if (existing) {
        existing.kg = Math.round(kg * 100) / 100;
        existing.author = payload.author || existing.author || '';
        weight = existing;
      } else {
        weight = { id: uid('w_'), date, kg: Math.round(kg * 100) / 100, author: payload.author || '' };
        state.weights.push(weight);
      }
      state.weights.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      return { state, result: { weight } };
    }

    case 'deleteWeight': {
      state.weights = state.weights || [];
      const w = state.weights.find((x) => x.id === payload.id);
      if (!w) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, w.author, 'weight');
      state.weights = state.weights.filter((x) => x.id !== payload.id);
      return { state, result: {} };
    }

    /* height: same contract as weight — one number per day, replace on the
       same date, a range guard that only exists to catch typos (665 for
       66.5). Centimetres. */
    case 'addHeight': {
      const cm = Number(payload.cm);
      if (!isFinite(cm) || cm < 20 || cm > 130) throw httpError(400, 'height out of range');
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'bad date');
      state.heights = state.heights || [];
      const existing = state.heights.find((h) => h.date === date);
      let height;
      if (existing) {
        existing.cm = Math.round(cm * 10) / 10;
        existing.author = payload.author || existing.author || '';
        height = existing;
      } else {
        height = { id: uid('h_'), date, cm: Math.round(cm * 10) / 10, author: payload.author || '' };
        state.heights.push(height);
      }
      state.heights.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      return { state, result: { height } };
    }

    case 'deleteHeight': {
      state.heights = state.heights || [];
      const h = state.heights.find((x) => x.id === payload.id);
      if (!h) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, h.author, 'height');
      state.heights = state.heights.filter((x) => x.id !== payload.id);
      return { state, result: {} };
    }

    /* milestones: the firsts — 뒤집기, 첫 웃음. Free text, several may share
       a day, and they are never overwritten, only added and deleted. */
    case 'addMilestone': {
      const text = String(payload.text || '').trim().slice(0, 120);
      if (!text) throw httpError(400, 'milestone text required');
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'bad date');
      state.milestones = state.milestones || [];
      const milestone = { id: uid('g_'), date, text, author: payload.author || '' };
      state.milestones.push(milestone);
      return { state, result: { milestone } };
    }

    /* the diary: a day's page — text and up to a few photos, several
       entries a day allowed (two parents write about the same afternoon).
       Photos ride the same store as memo photos; the text is posted first
       and the pictures attached by a second write, exactly like a memo. */
    case 'addDiary': {
      const text = String(payload.text || '').trim().slice(0, 4000);
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'bad date');
      if (!text && !normalizePhotos(payload.photos).length) throw httpError(400, 'diary needs text or a photo');
      state.diaries = state.diaries || [];
      const diary = { id: uid('d_'), date, text, lang: payload.lang || 'other',
        translation: payload.translation || '', author: payload.author || '', ts: new Date().toISOString() };
      const photos = normalizePhotos(payload.photos);
      if (photos.length) diary.photos = photos;
      state.diaries.push(diary);
      return { state, result: { diary } };
    }

    /* only the machine-written part — the uploaded photo refs — may be
       filled in afterwards; the words a person wrote are never rewritten
       by a background job */
    case 'updateDiary': {
      state.diaries = state.diaries || [];
      const diary = state.diaries.find((d) => d.id === payload.id);
      if (!diary) throw httpError(404, 'diary not found');
      /* a PERSON editing their words (text present) is allowed — what stays
         forbidden is a background job rewriting them; machine writes only
         ever carry translation/photos */
      if (payload.text !== undefined) {
        const text = String(payload.text || '').trim().slice(0, 4000);
        if (!text && !(diary.photos || []).length) throw httpError(400, 'diary needs text or a photo');
        diary.text = text;
        diary.lang = payload.lang || diary.lang || 'other';
        diary.translation = payload.translation || '';
      }
      if (payload.translation !== undefined) diary.translation = payload.translation;
      if (payload.photos !== undefined) {
        const photos = normalizePhotos(payload.photos);
        if (photos.length) diary.photos = photos; else delete diary.photos;
      }
      return { state, result: { diary } };
    }

    case 'deleteDiary': {
      state.diaries = state.diaries || [];
      const diary = state.diaries.find((d) => d.id === payload.id);
      if (!diary) return { state, result: { alreadyGone: true, removedPhotos: [] } };
      assertMayTouch(payload.actor, diary.author, 'diary');
      state.diaries = state.diaries.filter((d) => d.id !== payload.id);
      return { state, result: { removedPhotos: (diary.photos || []).map((p) => p.id) } };
    }

    /* ---- REACTIONS -------------------------------------------------
       The only message in this app that needs no translation. 엄마 can
       read what the nanny wrote but cannot answer without composing text
       that has to survive a round trip through a translator; a heart says
       "I saw this, thank you" and arrives whole.

       THE LINE IS "NOTHING THAT JUDGES A PERSON", not "only cheerful". A
       record wearing a thumbs-down is an appraisal, and once one of those
       is possible, silence becomes one too — every unreacted record starts
       to mean something. 😦 🤔 😥 answer the SITUATION instead: sympathy
       for a hard night, or "let me think about this". So they are in, and
       👎, ❌ and the angry faces stay out, as does any count that could be
       read as a score.

       Anyone may react to anyone's record: acknowledging someone else's
       work is the whole point, so this is NOT gated by assertMayTouch the
       way editing and deleting are. Toggling is idempotent — two phones
       racing on the same heart settle on the same answer — and a record
       that has since been deleted reports alreadyGone rather than 404,
       like every other write here. */
    /* ---------------- 내니 출석부 ---------------- */
    case 'stampIn': {
      const date = payload.date;
      if (!DATE_RE.test(date || '')) throw httpError(400, 'stampIn requires a date');
      state.shifts = state.shifts || [];
      /* 연차로 잡힌 날은 출근이 될 수 없다 — 하루가 두 번 계산된다 */
      if ((state.leaves || []).some((x) => x.date === date)) {
        throw httpError(409, 'that day is on leave');
      }
      /* 같은 날 도장은 하나. 두 번째는 '이미 찍혀 있다'는 사실을 돌려줄 뿐,
         오류가 아니다 — 두 번 누르는 건 사고가 아니라 흔한 일이다. */
      if (state.shifts.some((x) => x.date === date)) {
        return { state, result: { alreadyStamped: true } };
      }
      /* 오늘 것은 누구나 바로. 지난 날짜는 엄마만 — 내니는 requestStamp로. */
      const today = payload.today && DATE_RE.test(payload.today) ? payload.today : date;
      const status = (date === today || isMaster(payload.actor)) ? 'ok' : 'pending';
      const shift = { id: uid('s_'), date, at: payload.at || '', by: payload.author || payload.actor || '', status };
      state.shifts.push(shift);
      return { state, result: { shift } };
    }

    case 'requestStamp': {
      const date = payload.date;
      if (!DATE_RE.test(date || '')) throw httpError(400, 'requestStamp requires a date');
      state.shifts = state.shifts || [];
      /* 연차로 잡힌 날은 출근이 될 수 없다 — 하루가 두 번 계산된다 */
      if ((state.leaves || []).some((x) => x.date === date)) {
        throw httpError(409, 'that day is on leave');
      }
      /* 같은 날 도장은 하나. 두 번째는 '이미 찍혀 있다'는 사실을 돌려줄 뿐,
         오류가 아니다 — 두 번 누르는 건 사고가 아니라 흔한 일이다. */
      if (state.shifts.some((x) => x.date === date)) {
        return { state, result: { alreadyStamped: true } };
      }
      const shift = { id: uid('s_'), date, at: payload.at || '', by: payload.author || payload.actor || '', status: 'pending' };
      state.shifts.push(shift);
      return { state, result: { shift } };
    }

    /* ================================================================
       근무 시간 수정 (출근·퇴근)

       내니가 몇 시간만 일하고 가는 날이 있다. 매일 퇴근 도장을 찍게 하는 건
       번거로우니(정상 근무가 압도적으로 많다) 평소에는 출근 도장 하나로 두고,
       짧게 일한 날만 퇴근 시각을 적어 넣는다.

       출근·퇴근 어느 쪽이든 손댈 수 있고, 손대지 않은 쪽은 계약상 시각으로
       친다. 엄마가 넣으면 바로 반영되고, 내니가 넣으면 승인 대기다 — 자기
       급여를 스스로 깎거나 늘리는 입력이라 오버타임과 같은 규칙을 탄다. */
    case 'setShiftTimes': {
      const sh = (state.shifts || []).find((x) => x.id === payload.id);
      if (!sh) throw httpError(404, 'shift not found');
      const hasStart = payload.start !== undefined && payload.start !== '';
      const hasEnd = payload.end !== undefined && payload.end !== '';
      if (!hasStart && !hasEnd) throw httpError(400, 'setShiftTimes needs a start or an end');
      if (hasStart && !HM_RE.test(payload.start)) throw httpError(400, 'start must be HH:MM');
      if (hasEnd && !HM_RE.test(payload.end)) throw httpError(400, 'end must be HH:MM');
      const r = payrollOf(state);
      const next = { start: hasStart ? payload.start : '', end: hasEnd ? payload.end : '' };
      if (shiftMinutes(next, r) <= 0) throw httpError(400, 'end must be after start');
      if (hasStart) sh.start = payload.start; else delete sh.start;
      if (hasEnd) sh.end = payload.end; else delete sh.end;
      sh.timeStatus = isMaster(payload.actor) ? 'ok' : 'pending';
      sh.timeBy = payload.actor || '';
      return { state, result: { shift: sh } };
    }

    case 'approveShiftTimes': {
      assertMaster(payload.actor, 'shiftTimes');
      const sh = (state.shifts || []).find((x) => x.id === payload.id);
      if (!sh) throw httpError(404, 'shift not found');
      if (!sh.start && !sh.end) return { state, result: { alreadyGone: true } };
      sh.timeStatus = 'ok';
      return { state, result: { shift: sh } };
    }

    /* 거절도 지우기도 같은 동작 — 떼어내면 그날은 다시 정상 근무 */
    case 'clearShiftTimes': {
      const sh = (state.shifts || []).find((x) => x.id === payload.id);
      if (!sh) return { state, result: { alreadyGone: true } };
      /* 승인된 것을 되돌리는 건 엄마만. 내니는 자기가 올린 대기 건만 뗀다 */
      if (sh.timeStatus === 'ok') assertMaster(payload.actor, 'shiftTimes');
      else if (!isMaster(payload.actor) && !sameAuthor(sh.timeBy, payload.actor)) {
        throw httpError(403, 'not-owner:shiftTimes');
      }
      delete sh.start; delete sh.end; delete sh.timeStatus; delete sh.timeBy;
      return { state, result: { shift: sh } };
    }

    case 'approveShift': {
      assertMaster(payload.actor, 'shift');
      const sh = (state.shifts || []).find((x) => x.id === payload.id);
      if (!sh) return { state, result: { alreadyGone: true } };
      sh.status = 'ok';
      return { state, result: { shift: sh } };
    }

    case 'deleteShift': {
      const sh = (state.shifts || []).find((x) => x.id === payload.id);
      if (!sh) return { state, result: { alreadyGone: true } };
      /* 자기가 방금 찍은 것은 취소할 수 있고, 남의 것·승인된 것은 엄마만 */
      if (sh.status !== 'pending' || !sameAuthor(sh.by, payload.actor)) assertMaster(payload.actor, 'shift');
      state.shifts = (state.shifts || []).filter((x) => x.id !== payload.id);
      return { state, result: { removed: payload.id } };
    }

    /* ---------------- 유급 연차 ----------------
       출근 도장과 같은 길을 쓴다: 엄마가 넣으면 바로 확정, 내니가 넣으면
       승인 대기. 하루가 두 번 계산되는 일이 없도록 같은 날의 출근과 연차는
       서로를 막는다. */
    case 'addLeave': {
      const date = payload.date;
      if (!DATE_RE.test(date || '')) throw httpError(400, 'addLeave requires a date');
      state.leaves = state.leaves || [];
      /* 같은 날 두 번은 사고가 아니라 흔한 일이다 — 오류로 돌려보내지 않는다 */
      if (state.leaves.some((x) => x.date === date)) {
        return { state, result: { alreadyLeave: true } };
      }
      /* 이미 출근한 날은 연차가 될 수 없다. 이건 진짜 거절이라 오류로 말한다. */
      if ((state.shifts || []).some((x) => x.date === date)) {
        throw httpError(409, 'that day is already a work day');
      }
      const leave = {
        id: uid('lv_'), date,
        at: payload.at || '',
        by: payload.author || payload.actor || '',
        status: isMaster(payload.actor) ? 'ok' : 'pending',
      };
      state.leaves.push(leave);
      return { state, result: { leave } };
    }

    case 'approveLeave': {
      assertMaster(payload.actor, 'leave');
      const lv = (state.leaves || []).find((x) => x.id === payload.id);
      if (!lv) return { state, result: { alreadyGone: true } };
      lv.status = 'ok';
      return { state, result: { leave: lv } };
    }

    case 'deleteLeave': {
      const lv = (state.leaves || []).find((x) => x.id === payload.id);
      if (!lv) return { state, result: { alreadyGone: true } };
      /* 승인 전 자기 신청은 스스로 거둘 수 있고, 승인된 것은 엄마만 —
         이미 급여에 들어간 숫자이기 때문이다 */
      if (lv.status !== 'pending' || !sameAuthor(lv.by, payload.actor)) assertMaster(payload.actor, 'leave');
      state.leaves = (state.leaves || []).filter((x) => x.id !== payload.id);
      return { state, result: { removed: payload.id } };
    }

    /* ---------------- 오버타임 ---------------- */
    case 'addOt': {
      const date = payload.date;
      if (!DATE_RE.test(date || '')) throw httpError(400, 'addOt requires a date');
      if (!HM_RE.test(payload.start || '') || !HM_RE.test(payload.end || '')) {
        throw httpError(400, 'addOt requires start and end');
      }
      const o = { id: uid('o_'), date, start: payload.start, end: payload.end,
                  by: payload.author || payload.actor || '',
                  status: isMaster(payload.actor) ? 'ok' : 'pending' };
      if (otMinutes(o) <= 0) throw httpError(400, 'addOt: empty range');
      state.ot = state.ot || [];
      state.ot.push(o);
      return { state, result: { ot: o } };
    }

    case 'approveOt': {
      assertMaster(payload.actor, 'ot');
      const o = (state.ot || []).find((x) => x.id === payload.id);
      if (!o) return { state, result: { alreadyGone: true } };
      o.status = 'ok';
      return { state, result: { ot: o } };
    }

    case 'deleteOt': {
      const o = (state.ot || []).find((x) => x.id === payload.id);
      if (!o) return { state, result: { alreadyGone: true } };
      if (o.status !== 'pending' || !sameAuthor(o.by, payload.actor)) assertMaster(payload.actor, 'ot');
      state.ot = (state.ot || []).filter((x) => x.id !== payload.id);
      return { state, result: { removed: payload.id } };
    }

    /* ---------------- 정산 ---------------- */
    case 'markPaid': {
      assertMaster(payload.actor, 'payPeriod');
      const from = payload.from, to = payload.to;
      if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) throw httpError(400, 'markPaid requires from and to');
      state.payPeriods = state.payPeriods || [];
      if (state.payPeriods.some((p) => p.from === from && p.to === to)) {
        return { state, result: { alreadyPaid: true } };
      }
      /* 금액은 지금 이 순간의 계산으로 굳는다 — 나중에 일급이 올라도 지난
         급여는 움직이지 않는다 */
      const rate = payrollOf(state);
      const days = (state.shifts || []).filter((x) => x.status === 'ok' && x.date >= from && x.date <= to);
      /* 오버타임은 '다음 날이 속한 기간'으로 센다 — 지급일(기간의 마지막
         날) 오버타임은 퇴근 뒤 일이라 그날 오후 5시에 나간 급여 메모에
         담길 수 없다. 화면과 같은 규칙이어야 굳는 금액이 보여준 금액과 같다. */
      const nextDay = (ds) => {
        const d = new Date(ds + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      };
      const mins = (state.ot || [])
        .filter((x) => x.status === 'ok' && nextDay(x.date) >= from && nextDay(x.date) <= to)
        .reduce((n, x) => n + otMinutes(x), 0);
      const perMin = (rate.hourly * rate.otMul) / 60;
      /* 단축 근무한 날은 그날치만 — 굳는 금액이 화면이 보여준 금액과 같아야 한다 */
      const dayWages = days.reduce((n, sh) => n + shiftWage(sh, rate), 0);
      /* 승인된 연차도 하루치로 굳는다. 나중에 연차 금액을 바꿔도 지난 급여는
         움직이지 않는다 — 입금 완료가 금액을 굳히는 것과 같은 이유. */
      const leaves = (state.leaves || []).filter((x) => x.status === 'ok' && x.date >= from && x.date <= to);
      const leaveWages = leaves.length * rate.leavePay;
      const amount = dayWages + leaveWages + Math.round(mins * perMin);
      const period = {
        id: uid('pp_'), from, to, payday: payload.payday || to,
        days: days.length, otMin: mins, leaveDays: leaves.length, amount,
        paidAt: payload.paidAt || new Date().toISOString(),
        paidBy: payload.actor || '',
      };
      state.payPeriods.push(period);
      return { state, result: { period } };
    }

    case 'unmarkPaid': {
      assertMaster(payload.actor, 'payPeriod');
      const p0 = (state.payPeriods || []).find((x) => x.id === payload.id);
      if (!p0) return { state, result: { alreadyGone: true } };
      state.payPeriods = (state.payPeriods || []).filter((x) => x.id !== payload.id);
      return { state, result: { removed: payload.id } };
    }

    case 'setPayroll': {
      assertMaster(payload.actor, 'payroll');
      const cur = payrollOf(state);
      const next = {
        daily: payload.daily !== undefined ? Math.max(0, Math.round(Number(payload.daily) || 0)) : cur.daily,
        hourly: payload.hourly !== undefined ? Math.max(0, Math.round(Number(payload.hourly) || 0)) : cur.hourly,
        meal: payload.meal !== undefined ? Math.max(0, Math.round(Number(payload.meal) || 0)) : cur.meal,
        otMul: payload.otMul !== undefined ? Math.max(1, Number(payload.otMul) || 1.5) : cur.otMul,
        startDate: DATE_RE.test(payload.startDate || '') ? payload.startDate : cur.startDate,
        startTime: HM_RE.test(payload.startTime || '') ? payload.startTime : cur.startTime,
        leaveDays: payload.leaveDays !== undefined ? Math.max(0, Math.round(Number(payload.leaveDays) || 0)) : cur.leaveDays,
        leavePay: payload.leavePay !== undefined ? Math.max(0, Math.round(Number(payload.leavePay) || 0)) : cur.leavePay,
        offDays: payload.offDays !== undefined ? cleanOffDays(payload.offDays) : cur.offDays,
      };
      state.payroll = next;
      return { state, result: { payroll: next } };
    }

    /* 수유 계획은 엄마만 바꾼다 — 내니 폰에서는 읽기만 된다. 넘어온 필드만
       갈아끼우므로 설정 화면의 입력 하나가 바뀔 때마다 한 건씩 보내면 된다. */
    case 'setFeedPlan': {
      assertMaster(payload.actor, 'feed plan');
      const cur = feedPlanOf(state);
      const merged = Object.assign({}, cur);
      ['mode', 'startTime', 'quietFrom', 'nightFrom', 'nightTo'].forEach((k) => {
        if (payload[k] !== undefined) merged[k] = payload[k];
      });
      /* 최소 하루량(1회량 × 횟수)은 저장하지 않는다 — 화면에서 계산한다.
         goal은 보충 수유까지 더한 하루 목표라 따로 받는다. */
      ['intervalMin', 'count', 'perFeed', 'goal', 'maxGapMin', 'rateMl', 'rateMin'].forEach((k) => {
        if (payload[k] !== undefined) merged[k] = payload[k];
      });
      if (payload.times !== undefined) {
        if (!Array.isArray(payload.times) || !payload.times.length) {
          throw httpError(400, 'feed times required');
        }
        if (!payload.times.every((x) => HM_RE.test(x || ''))) {
          throw httpError(400, 'feed times must be HH:MM');
        }
        merged.times = payload.times;
      }
      const next = feedPlanOf({ feedPlan: merged });
      state.feedPlan = next;
      return { state, result: { feedPlan: next } };
    }

    case 'toggleReaction': {
      const KINDS = ['laugh', 'thumb', 'heart', 'clap', 'bow', 'fire', 'ok', 'worry', 'think', 'pity',
        'siren', 'muscle', 'eyes', 'melt', 'idea'];
      if (KINDS.indexOf(payload.kind) < 0) throw httpError(400, 'unknown reaction');
      const who = (payload.author || '').trim();
      if (!who) throw httpError(400, 'reaction needs an author');
      /* a reply is the one thing here that is not addressed by id alone —
         it lives inside a memo, so it takes both */
      let rec;
      if (payload.target === 'reply') {
        const memo = (state.memos || []).find((m) => m.id === payload.memoId);
        rec = memo && (memo.replies || []).find((r) => r.id === payload.id);
      } else {
        const list = payload.target === 'diary' ? (state.diaries || [])
          : payload.target === 'memo' ? (state.memos || [])
          : (state.entries || []);
        rec = list.find((x) => x.id === payload.id);
      }
      if (!rec) return { state, result: { alreadyGone: true } };
      const rx = rec.reactions || {};
      const had = (rx[payload.kind] || []).indexOf(who) >= 0;
      /* ONE PERSON MAY LEAVE SEVERAL. It started as one-per-person, the way
         Zalo does it, and that was wrong for this app: 웃기고 고맙고 대단한
         기록 is one record, and being made to choose between 😂 and 🙇‍♀️
         loses half of what she meant. Each mark toggles on its own. */
      if (had) {
        rx[payload.kind] = rx[payload.kind].filter((n) => n !== who);
        if (!rx[payload.kind].length) delete rx[payload.kind];
      } else {
        rx[payload.kind] = (rx[payload.kind] || []).concat([who]);
      }
      if (Object.keys(rx).length) rec.reactions = rx; else delete rec.reactions;
      return { state, result: { reactions: rec.reactions || {}, on: !had } };
    }

    /* schedules: appointments on the growth calendar — 예방접종, 검진,
       문화센터. A date, an optional time-of-day, free text. Translated in
       the background like memos and diary pages so the nanny can read
       them; several may share a day. */
    case 'addSchedule': {
      const text = String(payload.text || '').trim().slice(0, 120);
      if (!text) throw httpError(400, 'schedule text required');
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'bad date');
      let time = '';
      if (payload.time) {
        time = String(payload.time);
        /* a real clock time, not merely two digits, a colon and two digits */
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw httpError(400, 'bad time');
      }
      /* a stay of several nights: an end date, never earlier than the start */
      let endDate = '';
      if (payload.endDate) {
        endDate = String(payload.endDate).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw httpError(400, 'bad end date');
        if (endDate < date) throw httpError(400, 'end date before start');
        if (endDate === date) endDate = '';
      }
      const color = SCHED_COLORS.includes(payload.color) ? payload.color : 'sky';
      state.schedules = state.schedules || [];
      const schedule = { id: uid('s_'), date, time, endDate, color, text,
        lang: payload.lang || 'other', translation: payload.translation || '',
        author: payload.author || '' };
      state.schedules.push(schedule);
      return { state, result: { schedule } };
    }

    case 'updateSchedule': {
      state.schedules = state.schedules || [];
      const s = state.schedules.find((x) => x.id === payload.id);
      if (!s) throw httpError(404, 'schedule not found');
      /* person edits (text present) are free; a machine write only ever
         carries the translation */
      if (payload.text !== undefined) {
        const text = String(payload.text || '').trim().slice(0, 120);
        if (!text) throw httpError(400, 'schedule text required');
        s.text = text;
        s.lang = payload.lang || s.lang || 'other';
        s.translation = payload.translation || '';
        if (payload.date !== undefined) {
          const date = String(payload.date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'bad date');
          s.date = date;
        }
        if (payload.time !== undefined) {
          const time = payload.time ? String(payload.time) : '';
          if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw httpError(400, 'bad time');
          s.time = time;
        }
        if (payload.endDate !== undefined) {
          let endDate = payload.endDate ? String(payload.endDate).slice(0, 10) : '';
          if (endDate) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw httpError(400, 'bad end date');
            if (endDate < s.date) throw httpError(400, 'end date before start');
            if (endDate === s.date) endDate = '';
          }
          s.endDate = endDate;
        }
        if (payload.color !== undefined && SCHED_COLORS.includes(payload.color)) s.color = payload.color;
      }
      if (payload.translation !== undefined) s.translation = payload.translation;
      return { state, result: { schedule: s } };
    }

    case 'deleteSchedule': {
      state.schedules = state.schedules || [];
      const s = state.schedules.find((x) => x.id === payload.id);
      if (!s) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, s.author, 'schedule');
      state.schedules = state.schedules.filter((x) => x.id !== payload.id);
      return { state, result: {} };
    }

    case 'updateMilestone': {
      state.milestones = state.milestones || [];
      const m = state.milestones.find((x) => x.id === payload.id);
      if (!m) throw httpError(404, 'milestone not found');
      const text = String(payload.text || '').trim().slice(0, 120);
      if (!text) throw httpError(400, 'milestone text required');
      /* edits are free, like entries — the guard is on deletion only */
      m.text = text;
      return { state, result: { milestone: m } };
    }

    case 'deleteMilestone': {
      state.milestones = state.milestones || [];
      const m = state.milestones.find((x) => x.id === payload.id);
      if (!m) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, m.author, 'milestone');
      state.milestones = state.milestones.filter((x) => x.id !== payload.id);
      return { state, result: {} };
    }

    case 'addCustomType': {
      const ct = {
        id: uid('c_'),
        name: payload.name || '',
        color: payload.color || 'var(--c-custom)',
        emoji: payload.emoji || '🏷️',
      };
      state.customTypes.push(ct);
      return { state, result: { customType: ct } };
    }

    case 'updateCustomType': {
      const ct = state.customTypes.find((c) => c.id === payload.id);
      if (!ct) throw httpError(404, 'custom type not found');
      ['name', 'color', 'emoji'].forEach((f) => { if (payload[f] !== undefined) ct[f] = payload[f]; });
      return { state, result: { customType: ct } };
    }

    case 'deleteCustomType': {
      const before = state.customTypes.length;
      state.customTypes = state.customTypes.filter((c) => c.id !== payload.id);
      if (state.customTypes.length === before) return { state, result: { alreadyGone: true } };
      state.typeOrder = state.typeOrder.filter((id) => id !== 'custom:' + payload.id);
      return { state, result: {} };
    }

    case 'setTypeOrder': {
      if (!Array.isArray(payload.order)) throw httpError(400, 'setTypeOrder requires an order array');
      state.typeOrder = payload.order;
      return { state, result: {} };
    }

    case 'setProfile': {
      state.profile = state.profile || {};
      ['nameKo', 'nameVi', 'birth'].forEach((f) => { if (payload[f] !== undefined) state.profile[f] = payload[f]; });
      return { state, result: { profile: state.profile } };
    }

    /* The lock on switching a phone to 엄마. What is stored is a SHA-256 of
       the four digits, never the digits: the whole state document is handed
       to every phone that opens the app, and the PIN itself has no business
       travelling in it. Only 엄마 can set or clear it. */
    case 'setMasterPin': {
      if (payload.actor !== undefined && !isMaster(payload.actor)) {
        throw httpError(403, 'not-owner:pin');
      }
      state.profile = state.profile || {};
      if (payload.pinHash === '' || payload.pinHash === null) {
        delete state.profile.pinHash;
      } else {
        if (typeof payload.pinHash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.pinHash)) {
          throw httpError(400, 'pinHash must be a sha-256 hex digest');
        }
        state.profile.pinHash = payload.pinHash;
      }
      return { state, result: { hasPin: !!state.profile.pinHash } };
    }

    // ---- custom author names ----
    // The three presets (엄마/아빠/내니) are built into the UI; these are the
    // extra names a household adds (a grandparent, a second sitter). Shared
    // state rather than per-device so a name added on one phone shows up in
    // everyone's author picker.
    case 'addCustomAuthor': {
      const name = (payload.name || '').trim();
      if (!name) throw httpError(400, 'author name required');
      state.customAuthors = state.customAuthors || [];
      if (state.customAuthors.some((a) => a.name === name)) {
        return { state, result: { duplicate: true } };
      }
      /* Two of the three people using this app read Korean and one does not,
         so a name added as '하영이 이모' has to have a Vietnamese form too —
         otherwise the nanny opens a memo and cannot tell who left it. The
         translation is filled in afterwards by the phone that added the
         name, the same way memo translations arrive. */
      const author = { id: uid('a_'), name };
      if (payload.nameVi) author.nameVi = String(payload.nameVi).trim();
      state.customAuthors.push(author);
      return { state, result: { author } };
    }

    case 'updateCustomAuthor': {
      state.customAuthors = state.customAuthors || [];
      const author = state.customAuthors.find((a) => a.id === payload.id);
      if (!author) throw httpError(404, 'author not found');
      if (payload.nameVi !== undefined) {
        const vi = String(payload.nameVi).trim();
        if (vi) author.nameVi = vi; else delete author.nameVi;
      }
      return { state, result: { author } };
    }

    case 'deleteCustomAuthor': {
      state.customAuthors = (state.customAuthors || []).filter((a) => a.id !== payload.id);
      return { state, result: {} };
    }

    // ---- quick words ----
    // Short reusable note snippets per care type (a medicine name, a play
    // activity), tapped as chips in the entry-detail note field instead of
    // being retyped. Keyed by type id so 투약/놀이/터미타임 each keep their own set.
    case 'addQuickWord': {
      const text = (payload.text || '').trim();
      const typeId = payload.typeId;
      if (!text || !typeId) throw httpError(400, 'quick word requires typeId and text');
      state.quickWords = state.quickWords || [];
      if (state.quickWords.some((w) => w.typeId === typeId && w.text === text)) {
        return { state, result: { duplicate: true } };
      }
      const word = { id: uid('q_'), typeId, text };
      state.quickWords.push(word);
      return { state, result: { quickWord: word } };
    }

    case 'deleteQuickWord': {
      state.quickWords = (state.quickWords || []).filter((w) => w.id !== payload.id);
      return { state, result: {} };
    }

    /* ================================================================
       이유식 — 식단표 · 재료 · 장보기 · 냉동 큐브
       엄마만 고친다. 내니 폰은 오늘 메뉴를 읽고 기록만 남긴다.
       ================================================================ */
    case 'setWeanDay': {
      assertMaster(payload.actor, 'wean plan');
      if (!DATE_RE.test(payload.date || '')) throw httpError(400, 'bad date');
      state.weanPlan = state.weanPlan || {};
      const meals = cleanMeals(payload.meals);
      if (!meals.length) delete state.weanPlan[payload.date];
      else state.weanPlan[payload.date] = { meals };
      return { state, result: { date: payload.date, day: state.weanPlan[payload.date] || null } };
    }

    /* ── 식단 한 덩어리 ───────────────────────────────────────────
       고치는 단위는 '하루'가 아니라 '기간을 가진 한 끼'다. 사흘 같은 메뉴를
       먹이는 일이 흔한데 하루씩 세 번 적게 하면 틀리기만 쉽다.

       저장은 여전히 하루 단위로 남는다(weanPlan['2026-11-15'].meals). 덩어리는
       '연달아 있고 메뉴가 같은 날들'로 그때그때 세는 것이라, 쌓인 90일치를
       옮기거나 다시 쓰는 일이 없다 — 달력도 이미 그렇게 그리고 있다.

       payload:
         from, to   기간 (to 는 포함)
         meal       넣을 한 끼 {name, base, tops}
         wasFrom/wasTo/wasName
                    고치기 전 덩어리. 기간이 줄었으면 바깥으로 밀려난 날에서
                    그 끼니를 뺀다. 새로 만들 때는 없다.
         mode       'overwrite' | 'fill'
                    fill 이면 이미 같은 이름의 끼니가 있는 날은 건드리지 않는다.
       같은 날 같은 이름의 끼니는 하나뿐이다 — 이름이 그 날 안에서의 자리다. */
    case 'setWeanSpan': {
      assertMaster(payload.actor, 'wean plan');
      const from = String(payload.from || ''), to = String(payload.to || '');
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw httpError(400, 'bad range');
      if (to < from) throw httpError(400, 'bad range');
      const meal = cleanMeals([payload.meal])[0];
      if (!meal) throw httpError(400, 'bad meal');
      if (!meal.base.length && !meal.tops.length) throw httpError(400, 'empty meal');
      const fill = payload.mode === 'fill';
      state.weanPlan = state.weanPlan || {};

      /* 1) 줄어든 쪽 치우기 — 고치기 전 기간에는 있었는데 지금은 바깥인 날 */
      const wasFrom = String(payload.wasFrom || ''), wasTo = String(payload.wasTo || '');
      const wasName = payload.wasName === undefined ? meal.name : String(payload.wasName || '');
      if (DATE_RE.test(wasFrom) && DATE_RE.test(wasTo)) {
        for (const d of dateRange(wasFrom, wasTo)) {
          if (d >= from && d <= to) continue;
          dropMealOn(state, d, wasName);
        }
      }

      /* 2) 기간 안의 날마다 쓴다 */
      const written = [];
      const skipped = [];
      for (const d of dateRange(from, to)) {
        const day = state.weanPlan[d] || { meals: [] };
        const meals = Array.isArray(day.meals) ? day.meals.slice() : [];
        /* 고치기 전 이름으로 찾은 뒤, 없으면 새 이름으로 찾는다 — 끼니 이름을
           '아침'에서 '점심'으로 바꾼 경우에도 제자리를 찾아간다. */
        let i = meals.findIndex((m) => (m.name || '') === wasName);
        if (i < 0) i = meals.findIndex((m) => (m.name || '') === meal.name);
        /* 고치기 전 기간에 들어 있던 날은 '우리 날'이라 빈 날만 채우기에서도
           고쳐 쓴다. 그 바깥에서 이미 식단이 있는 날이 남의 덩어리다. */
        const wasOurs = DATE_RE.test(wasFrom) && d >= wasFrom && d <= wasTo;
        if (i < 0) {
          meals.push(meal);
        } else if (fill && !wasOurs && (meals[i].base || []).concat(meals[i].tops || []).length) {
          /* 빈 날만 채우기 — 이미 뭔가 있는 자리는 그대로 둔다 */
          skipped.push(d);
          continue;
        } else {
          meals[i] = meal;
        }
        state.weanPlan[d] = { meals: cleanMeals(meals) };
        written.push(d);
      }
      return { state, result: { written: written.length, skipped } };
    }

    /* 덩어리 지우기. 하루만 지우려면 from === to 로 부른다. */
    case 'deleteWeanSpan': {
      assertMaster(payload.actor, 'wean plan');
      const from = String(payload.from || ''), to = String(payload.to || '');
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) throw httpError(400, 'bad range');
      const name = String(payload.name || '');
      state.weanPlan = state.weanPlan || {};
      let n = 0;
      for (const d of dateRange(from, to)) if (dropMealOn(state, d, name)) n++;
      return { state, result: { removed: n } };
    }

    /* 식단 알약 색. 색은 하루가 아니라 '메뉴'에 붙는다 — 쌀죽+소고기를
       노랑으로 바꾸면 그 메뉴가 나오는 날이 달력에서 전부 노랑이 된다.
       키는 메뉴의 지문(끼니 이름 + 재료 id들)을 클라이언트가 추려 보낸 것이고,
       서버는 그 문자열을 그대로 보관만 한다. 기본색(0)이면 줄을 지운다 —
       식단을 고치면 쓰이지 않는 키가 남는데, 그게 쌓이지 않게. */
    case 'setWeanColor': {
      assertMaster(payload.actor, 'wean color');
      const key = String(payload.key || '').slice(0, 64);
      if (!key) throw httpError(400, 'bad key');
      const c = Math.round(num(payload.color, 0));
      state.weanColors = state.weanColors && typeof state.weanColors === 'object' ? state.weanColors : {};
      if (c > 0 && c < 32) state.weanColors[key] = c;
      else delete state.weanColors[key];
      return { state, result: { key, color: state.weanColors[key] || 0 } };
    }

    case 'deleteWeanDay': {
      assertMaster(payload.actor, 'wean plan');
      state.weanPlan = state.weanPlan || {};
      delete state.weanPlan[payload.date];
      return { state, result: {} };
    }

    /* 식단표를 통째로 심는다. 이미 들어 있는 날은 건드리지 않으므로
       두 번 눌러도 손으로 고친 식단을 덮어쓰지 않는다. */
    case 'seedWean': {
      assertMaster(payload.actor, 'wean seed');
      state.weanPlan = state.weanPlan || {};
      state.weanIngs = weanIngsOf(state);
      let days = 0, ings = 0;
      const plan = payload.plan && typeof payload.plan === 'object' ? payload.plan : {};
      for (const ds of Object.keys(plan)) {
        if (!DATE_RE.test(ds) || state.weanPlan[ds]) continue;
        const meals = cleanMeals(plan[ds] && plan[ds].meals);
        if (!meals.length) continue;
        state.weanPlan[ds] = { meals };
        days++;
      }
      for (const raw of (Array.isArray(payload.ings) ? payload.ings : [])) {
        if (!raw || !raw.id) continue;
        if (state.weanIngs.some((x) => x.id === raw.id)) continue;
        state.weanIngs.push({
          id: String(raw.id).slice(0, 40),
          ko: String(raw.ko || raw.id).slice(0, 30),
          vi: String(raw.vi || '').slice(0, 40),
          unit: WEAN_UNITS.indexOf(raw.unit) >= 0 ? raw.unit : 'g',
          always: raw.always === null || raw.always === undefined || raw.always === '' ? null : num(raw.always, null),
          cubeG: Math.max(1, Math.round(num(raw.cubeG, 10))),
          allergen: !!raw.allergen,
          isBase: !!raw.isBase,
        });
        ings++;
      }
      return { state, result: { days, ings } };
    }

    /* 재료와 큐브를 가른다 (한 번만 돈다).
         재료 = 사 오는 것   — 쌀, 오트밀, 소고기, 애호박 …
         큐브 = 얼리는 것   — 쌀죽, 쌀오트밀죽, 소고기 …
       하나가 아니다: 쌀오트밀죽 한 칸에 재료는 쌀과 오트밀 둘이다. 식단표와
       냉동 큐브는 큐브 id를 그대로 쓰고(그래서 기존 기록이 하나도 안 깨진다),
       장보기·알레르기·먹어본 것만 재료 쪽으로 옮겨 간다.
       표(재료 목록과 큐브→재료 지도)는 클라이언트가 들고 와서 보낸다. */
    case 'splitWeanRaw': {
      assertMaster(payload.actor, 'wean split');
      if (Array.isArray(state.weanRaw) && state.weanRaw.length) {
        return { state, result: { already: true, raw: state.weanRaw.length } };
      }
      state.weanIngs = weanIngsOf(state);
      const map = payload.map && typeof payload.map === 'object' ? payload.map : {};
      const raw = [];
      for (const r of (Array.isArray(payload.raw) ? payload.raw : [])) {
        if (!r || !r.id || raw.some((x) => x.id === r.id)) continue;
        raw.push({
          id: String(r.id).slice(0, 40),
          ko: String(r.ko || r.id).slice(0, 30),
          vi: String(r.vi || '').slice(0, 40),
          unit: WEAN_UNITS.indexOf(r.unit) >= 0 ? r.unit : 'g',
          always: r.always === null || r.always === undefined || r.always === '' ? null : num(r.always, null),
          allergen: !!r.allergen,
          cat: WEAN_CATS.indexOf(r.cat) >= 0 ? r.cat : 'etc',
        });
      }
      if (!raw.length) throw httpError(400, 'no raw');
      /* 큐브마다 '무엇으로 만드는지'. 표에 없으면 제 이름과 같은 재료 하나. */
      for (const row of state.weanIngs) {
        const src = Array.isArray(map[row.id]) ? map[row.id] : [row.id];
        row.raw = src.filter((x) => raw.some((r) => r.id === x));
        if (!row.raw.length) row.raw = [];
        /* 알레르기·늘 이만큼은 '사 오는 것'의 성질이라 재료 쪽으로 옮긴다 */
        delete row.allergen;
        delete row.always;
      }
      state.weanRaw = raw;
      return { state, result: { raw: raw.length, cubes: state.weanIngs.length } };
    }

    /* 재료 한 줄 고치기 — 이름·베트남어·단위·늘 이만큼·알레르기 주의·분류·이상 반응 */
    case 'setWeanRaw': {
      assertMaster(payload.actor, 'wean raw');
      state.weanRaw = Array.isArray(state.weanRaw) ? state.weanRaw : [];
      const id = String(payload.id || '').trim() || uid('r_');
      let row = state.weanRaw.find((x) => x.id === id);
      if (!row) { row = { id, ko: id, vi: '', unit: 'g', always: null, allergen: false, cat: 'etc' }; state.weanRaw.push(row); }
      if (payload.ko !== undefined) row.ko = String(payload.ko || '').slice(0, 30) || row.ko;
      if (payload.vi !== undefined) row.vi = String(payload.vi || '').slice(0, 40);
      if (payload.unit !== undefined && WEAN_UNITS.indexOf(payload.unit) >= 0) row.unit = payload.unit;
      if (payload.always !== undefined) {
        row.always = (payload.always === null || payload.always === '') ? null : Math.max(0, num(payload.always, 0));
      }
      if (payload.allergen !== undefined) row.allergen = !!payload.allergen;
      if (payload.cat !== undefined) {
        const cat = String(payload.cat || '');
        row.cat = WEAN_CATS.indexOf(cat) >= 0 ? cat : 'etc';
      }
      /* 이 재료로 탈이 난 적. 먹인 기록의 '이상 반응'이 정석이지만, 기록을
         안 남긴 날도 있어서 재료에도 한 줄 남길 수 있게 둔다. */
      if (payload.reaction !== undefined) {
        const rx = String(payload.reaction || '');
        if (WEAN_REACTS.indexOf(rx) >= 0) row.reaction = rx; else delete row.reaction;
      }
      return { state, result: { id: row.id } };
    }

    case 'deleteWeanRaw': {
      assertMaster(payload.actor, 'wean raw');
      const id = String(payload.id || '');
      state.weanRaw = (Array.isArray(state.weanRaw) ? state.weanRaw : []).filter((x) => x.id !== id);
      for (const row of weanIngsOf(state)) {
        if (Array.isArray(row.raw)) row.raw = row.raw.filter((x) => x !== id);
      }
      return { state, result: {} };
    }

    case 'setWeanIng': {
      assertMaster(payload.actor, 'wean ingredient');
      state.weanIngs = weanIngsOf(state);
      const id = String(payload.id || '').trim() || uid('i_');
      let row = state.weanIngs.find((x) => x.id === id);
      if (!row) { row = { id, ko: id, vi: '', unit: 'g', always: null, cubeG: 10, allergen: false, isBase: false }; state.weanIngs.push(row); }
      if (payload.ko !== undefined) row.ko = String(payload.ko || '').slice(0, 30) || row.ko;
      if (payload.vi !== undefined) row.vi = String(payload.vi || '').slice(0, 40);
      if (payload.unit !== undefined && WEAN_UNITS.indexOf(payload.unit) >= 0) row.unit = payload.unit;
      /* 늘 이만큼은 비워둘 수 있다 — 비면 식단표에서 계산한 양이 나온다 */
      if (payload.always !== undefined) {
        row.always = (payload.always === null || payload.always === '') ? null : Math.max(0, num(payload.always, 0));
      }
      if (payload.cubeG !== undefined) row.cubeG = Math.max(1, Math.round(num(payload.cubeG, 10)));
      if (payload.allergen !== undefined) row.allergen = !!payload.allergen;
      /* 이 큐브를 무엇으로 만드는지 — 쌀오트밀죽이면 [쌀, 오트밀] */
      if (payload.raw !== undefined) {
        const known = Array.isArray(state.weanRaw) ? state.weanRaw : [];
        row.raw = (Array.isArray(payload.raw) ? payload.raw : [])
          .map((x) => String(x))
          .filter((x, i, a) => a.indexOf(x) === i && known.some((r) => r.id === x))
          .slice(0, 8);
      }
      /* 베이스죽이면 장보기에서 세지 않는다 — 곡물가루는 떨어질 때 사는 것이지
         주마다 g으로 계산할 것이 아니다 */
      if (payload.isBase !== undefined) row.isBase = !!payload.isBase;
      return { state, result: { ing: row } };
    }

    case 'deleteWeanIng': {
      assertMaster(payload.actor, 'wean ingredient');
      state.weanIngs = weanIngsOf(state).filter((x) => x.id !== payload.id);
      state.weanCubes = (state.weanCubes || []).filter((c) => c.ing !== payload.id);
      state.weanShop = (state.weanShop || []).filter((s) => s.ing !== payload.id);
      return { state, result: {} };
    }

    /* 장보기의 한 줄에 대한 '차이'를 적는다. 값을 null로 보내면 그 항목만
       지워지고, 차이가 하나도 안 남으면 줄 자체가 사라져 계산값으로 돌아간다. */
    case 'setWeanShop': {
      assertMaster(payload.actor, 'wean shopping');
      const week = weekKey(payload.week);
      if (!week) throw httpError(400, 'bad week');
      const ing = String(payload.ing || '').trim();
      if (!ing) throw httpError(400, 'bad ingredient');
      state.weanShop = Array.isArray(state.weanShop) ? state.weanShop : [];
      let row = state.weanShop.find((s) => s.week === week && s.ing === ing);
      if (!row) { row = { week, ing }; state.weanShop.push(row); }
      if (payload.amount !== undefined) {
        if (payload.amount === null || payload.amount === '') delete row.amount;
        else row.amount = Math.max(0, num(payload.amount, 0));
      }
      if (payload.skip !== undefined) { if (payload.skip) row.skip = true; else delete row.skip; }
      if (payload.extra !== undefined) { if (payload.extra) row.extra = true; else delete row.extra; }
      if (payload.checked !== undefined) { if (payload.checked) row.checked = true; else delete row.checked; }
      /* 직접 넣은 줄은 재료 사전에 없을 수 있다(큐브 트레이 같은 것) — 그래서
         단위를 줄 자체가 들고 있어야 한다. 사전에 있는 재료는 사전 쪽이 이긴다. */
      if (payload.unit !== undefined) {
        if (WEAN_UNITS.indexOf(payload.unit) >= 0) row.unit = payload.unit; else delete row.unit;
      }
      const empty = row.amount === undefined && !row.skip && !row.extra && !row.checked;
      if (empty) state.weanShop = state.weanShop.filter((s) => s !== row);
      /* 지난 주의 담기 표시는 들고 있을 이유가 없다 — 장은 그 주에 본다 */
      state.weanShop = state.weanShop.filter((s) => !(s.checked && !s.extra && s.amount === undefined && !s.skip && s.week < week));
      return { state, result: { row: empty ? null : row } };
    }

    /* 재고 화면의 − + . 뺄 때는 오래된 덩어리부터, 더할 때는 가장 최근
       덩어리에. n을 통째로 주면 덩어리를 하나로 접는다(쓰는 곳은 없지만
       옛 클라이언트가 보낼 수 있다). */
    case 'setWeanCube': {
      assertMaster(payload.actor, 'wean cubes');
      const ing = String(payload.ing || '').trim();
      if (!ing) throw httpError(400, 'bad ingredient');
      if (payload.n !== undefined) {
        const want = Math.max(0, Math.round(num(payload.n, 0)));
        state.weanCubes = (state.weanCubes || []).filter((c) => c.ing !== ing);
        if (want) addCubes(state, ing, want, payload.perG, payload.madeOn);
      } else if (payload.delta !== undefined) {
        const d = Math.round(num(payload.delta, 0));
        /* 재고 화면은 만든 날마다 한 줄이다 — 그 줄의 -/+는 그 덩어리만
           건드린다. id 없이 오면 예전처럼 오래된 것부터 뺀다. */
        const id = payload.id ? String(payload.id) : '';
        if (id) {
          const row = (state.weanCubes || []).filter((c) => c.id === id && c.ing === ing)[0];
          if (!row) throw httpError(404, 'no such cube batch');
          row.n = Math.max(0, Math.round(num(row.n, 0)) + d);
          if (!row.n) state.weanCubes = state.weanCubes.filter((c) => c !== row);
        } else if (d < 0) takeCubes(state, ing, -d);
        else if (d > 0) {
          const list = cubesOf(state, ing);
          const last = list[list.length - 1];
          if (last) last.n = Math.max(0, Math.round(num(last.n, 0))) + d;
          else addCubes(state, ing, d, payload.perG, payload.madeOn);
        }
      }
      return { state, result: { cubes: cubesOf(state, ing) } };
    }

    /* 큐브를 만들었을 때. 같은 날 같은 용량이면 그 덩어리에 합치고,
       아니면 새 덩어리로 선다 — 9/28에 만든 것과 9/30에 만든 것은 다른 것이다. */
    case 'addWeanCubes': {
      assertMaster(payload.actor, 'wean cubes');
      const ing = String(payload.ing || '').trim();
      if (!ing) throw httpError(400, 'bad ingredient');
      const row = addCubes(state, ing, num(payload.n, 0), payload.perG, payload.madeOn);
      return { state, result: { cube: row, cubes: cubesOf(state, ing) } };
    }

    default:
      throw httpError(400, 'unknown mutation type: ' + type);
  }
}

/* A photo reference is three small numbers and an id. Anything else a client
   sends is dropped rather than trusted into the shared document. */
const PHOTO_ID_RE = /^p_[0-9a-f]{24,40}$/;
const MAX_PHOTOS_PER_MEMO = 4;
/* 기록의 새 칸들 — 들어온 값이 목록에 없으면 비워 둔다. 사진은 참조만
   남기고(바이트는 photos 테이블), 하나도 없으면 칸째로 지운다 — 3000건의
   기록마다 빈 배열이 하나씩 붙으면 문서가 그만큼 무거워진다. */
function cleanEntryExtras(entry) {
  if (entry.poop !== undefined) {
    if (POOP_KINDS.indexOf(entry.poop) > 0) { /* keep */ } else delete entry.poop;
  }
  if (entry.tempSite !== undefined) {
    if (TSITE_KINDS.indexOf(entry.tempSite) >= 0) { /* keep */ } else delete entry.tempSite;
  }
  if (entry.med !== undefined) {
    const m = String(entry.med || '').trim().slice(0, 40);
    if (m) entry.med = m; else delete entry.med;
  }
  if (entry.medUnit !== undefined) {
    const u = String(entry.medUnit || '').trim().slice(0, 8);
    if (u) entry.medUnit = u; else delete entry.medUnit;
  }
  if (entry.photos !== undefined) {
    const ph = normalizePhotos(entry.photos);
    if (ph.length) entry.photos = ph; else delete entry.photos;
  }
  return entry;
}
function normalizePhotos(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = raw.id;
    if (!PHOTO_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const w = Number(raw.w), h = Number(raw.h);
    out.push({
      id,
      w: Number.isFinite(w) && w > 0 ? Math.round(w) : null,
      h: Number.isFinite(h) && h > 0 ? Math.round(h) : null,
    });
    if (out.length >= MAX_PHOTOS_PER_MEMO) break;
  }
  return out;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { applyMutation, uid };
