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
   WHO MAY CHANGE WHAT

   The nanny started using the app and deleted one of mom's records
   by accident on her first day. There are no accounts here — a phone
   is whoever it says it is in settings — so this is not security, it
   is a guard rail: you can change what you wrote, and mom can change
   anything.

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
      assertMayTouch(payload.actor, entry.author, 'entry');
      ALLOWED_ENTRY_FIELDS.forEach((f) => { if (payload[f] !== undefined) entry[f] = payload[f]; });
      return { state, result: { entry } };
    }

    /* Deleting moves the record to the bin instead of dropping it. The whole
       app is one JSON document overwritten in place, so before this a delete
       was final everywhere at once — there was nothing left to restore from,
       not even in the database. */
    case 'deleteEntry': {
      const entry = state.entries.find((e) => e.id === payload.id);
      if (!entry) throw httpError(404, 'entry not found');
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
      if (payload.translation !== undefined) memo.translation = payload.translation;
      if (payload.photos !== undefined) {
        const photos = normalizePhotos(payload.photos);
        if (photos.length) memo.photos = photos; else delete memo.photos;
      }
      return { state, result: { memo } };
    }

    case 'deleteMemo': {
      const memo = state.memos.find((m) => m.id === payload.id);
      if (!memo) throw httpError(404, 'memo not found');
      assertMayTouch(payload.actor, memo.author, 'memo');
      state.memos = state.memos.filter((m) => m.id !== payload.id);
      /* the caller deletes the bytes once this write has actually landed —
         doing it first would lose the pictures on a version conflict */
      return { state, result: { removedPhotos: (memo.photos || []).map((p) => p.id) } };
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
      if (state.customTypes.length === before) throw httpError(404, 'custom type not found');
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
