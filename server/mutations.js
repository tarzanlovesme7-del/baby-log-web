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
const ALLOWED_ENTRY_FIELDS = ['type', 'start', 'end', 'amount', 'diaper', 'temp', 'note', 'noteLang', 'noteTranslated', 'author', 'sleepKind'];

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

function applyMutation(prevState, type, payload) {
  const state = clone(prevState);
  payload = payload || {};

  switch (type) {
    case 'addEntry': {
      const entry = { id: uid('e_'), start: payload.start || new Date().toISOString() };
      entry.end = payload.end || entry.start;
      ALLOWED_ENTRY_FIELDS.forEach((f) => { if (payload[f] !== undefined) entry[f] = payload[f]; });
      if (!entry.type) throw httpError(400, 'entry requires a type');
      state.entries.unshift(entry);
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
    case 'deleteEntry': {
      const entry = state.entries.find((e) => e.id === payload.id);
      if (!entry) return { state, result: { alreadyGone: true } };
      assertMayTouch(payload.actor, entry.author, 'entry');
      state.entries = state.entries.filter((e) => e.id !== payload.id);
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
      if (!a) throw httpError(409, 'nothing active');
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
      if (!a) throw httpError(409, 'nothing active');
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
      if (!a) throw httpError(409, 'nothing active');
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
      if (!text && !normalizePhotos(payload.photos).length && !normalizeVideos(payload.videos).length) {
        throw httpError(400, 'diary needs text, a photo or a video');
      }
      state.diaries = state.diaries || [];
      const diary = { id: uid('d_'), date, text, lang: payload.lang || 'other',
        translation: payload.translation || '', author: payload.author || '', ts: new Date().toISOString() };
      const photos = normalizePhotos(payload.photos);
      if (photos.length) diary.photos = photos;
      const vids = normalizeVideos(payload.videos);
      if (vids.length) diary.videos = vids;
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
        if (!text && !(diary.photos || []).length && !(diary.videos || []).length) {
          throw httpError(400, 'diary needs text, a photo or a video');
        }
        diary.text = text;
        diary.lang = payload.lang || diary.lang || 'other';
        diary.translation = payload.translation || '';
      }
      if (payload.translation !== undefined) diary.translation = payload.translation;
      if (payload.photos !== undefined) {
        const photos = normalizePhotos(payload.photos);
        if (photos.length) diary.photos = photos; else delete diary.photos;
      }
      /* a clip that has been dropped from the page frees its bytes, the same
         way a dropped photo does */
      let removedVideos = [];
      if (payload.videos !== undefined) {
        const vids = normalizeVideos(payload.videos);
        const keep = new Set(vids.map((v) => v.id));
        removedVideos = (diary.videos || []).map((v) => v.id).filter((id) => !keep.has(id));
        if (vids.length) diary.videos = vids; else delete diary.videos;
      }
      return { state, result: { diary, removedVideos } };
    }

    case 'deleteDiary': {
      state.diaries = state.diaries || [];
      const diary = state.diaries.find((d) => d.id === payload.id);
      if (!diary) return { state, result: { alreadyGone: true, removedPhotos: [], removedVideos: [] } };
      assertMayTouch(payload.actor, diary.author, 'diary');
      state.diaries = state.diaries.filter((d) => d.id !== payload.id);
      return { state, result: {
        removedPhotos: (diary.photos || []).map((p) => p.id),
        removedVideos: (diary.videos || []).map((v) => v.id),
      } };
    }

    /* ---- REACTIONS -------------------------------------------------
       The only message in this app that needs no translation. 엄마 can
       read what the nanny wrote but cannot answer without composing text
       that has to survive a round trip through a translator; a heart says
       "I saw this, thank you" and arrives whole.

       DELIBERATELY POSITIVE ONLY. A record with a thumbs-down is an
       appraisal, and once one is possible, silence becomes one too —
       every unreacted record starts to mean something. Four warm marks,
       no cold ones, and no count that could be read as a score.

       Anyone may react to anyone's record: acknowledging someone else's
       work is the whole point, so this is NOT gated by assertMayTouch the
       way editing and deleting are. Toggling is idempotent — two phones
       racing on the same heart settle on the same answer — and a record
       that has since been deleted reports alreadyGone rather than 404,
       like every other write here. */
    case 'toggleReaction': {
      const KINDS = ['laugh', 'thumb', 'heart', 'clap', 'bow', 'fire', 'ok'];
      if (KINDS.indexOf(payload.kind) < 0) throw httpError(400, 'unknown reaction');
      const who = (payload.author || '').trim();
      if (!who) throw httpError(400, 'reaction needs an author');
      const list = payload.target === 'diary' ? (state.diaries || [])
        : payload.target === 'memo' ? (state.memos || [])
        : (state.entries || []);
      const rec = list.find((x) => x.id === payload.id);
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

    default:
      throw httpError(400, 'unknown mutation type: ' + type);
  }
}

/* A photo reference is three small numbers and an id. Anything else a client
   sends is dropped rather than trusted into the shared document. */
const PHOTO_ID_RE = /^p_[0-9a-f]{24,40}$/;
const MAX_PHOTOS_PER_MEMO = 4;
/* the same shape as a photo ref, plus how long the clip runs — the list
   draws a poster and a duration without touching the bytes */
const VIDEO_ID_RE = /^v_[0-9a-f]{24,40}$/;
function normalizeVideos(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = raw.id;
    if (!VIDEO_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const w = Number(raw.w), h = Number(raw.h), dur = Number(raw.dur);
    out.push({
      id,
      w: Number.isFinite(w) && w > 0 ? Math.round(w) : null,
      h: Number.isFinite(h) && h > 0 ? Math.round(h) : null,
      dur: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 10) / 10 : null,
    });
    if (out.length >= 4) break;
  }
  return out;
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
