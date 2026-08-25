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
      ALLOWED_ENTRY_FIELDS.forEach((f) => { if (payload[f] !== undefined) entry[f] = payload[f]; });
      return { state, result: { entry } };
    }

    case 'deleteEntry': {
      const before = state.entries.length;
      state.entries = state.entries.filter((e) => e.id !== payload.id);
      if (state.entries.length === before) throw httpError(404, 'entry not found');
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
      if (a.paused) {
        // resume: shift start forward by however long the pause lasted so
        // elapsed = now - start keeps excluding the paused span
        const pausedMs = Date.now() - new Date(a.pausedAt).getTime();
        a.start = new Date(new Date(a.start).getTime() + pausedMs).toISOString();
        a.paused = false;
        a.pausedAt = null;
      } else {
        a.paused = true;
        a.pausedAt = new Date().toISOString();
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
      const end = a.paused && a.pausedAt ? a.pausedAt : new Date().toISOString();
      const entry = {
        id: uid('e_'), type: a.type, start: a.start, end,
        author: a.author || payload.author || '', note: '',
      };
      state.entries.unshift(entry);
      state.active = null;
      return { state, result: { entry } };
    }

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
      state.memos.unshift(memo);
      return { state, result: { memo } };
    }

    /* A memo is posted immediately and its translation filled in afterwards,
       so the translation arrives as its own write rather than as part of the
       memo. Only the translation may be set this way — the text a person
       typed is never rewritten by a background job. */
    case 'updateMemo': {
      const memo = state.memos.find((m) => m.id === payload.id);
      if (!memo) throw httpError(404, 'memo not found');
      if (payload.translation !== undefined) memo.translation = payload.translation;
      return { state, result: { memo } };
    }

    case 'deleteMemo': {
      const before = state.memos.length;
      state.memos = state.memos.filter((m) => m.id !== payload.id);
      if (state.memos.length === before) throw httpError(404, 'memo not found');
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
      const author = { id: uid('a_'), name };
      state.customAuthors.push(author);
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

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { applyMutation, uid };
