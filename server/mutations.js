// mutations.js — the authoritative reducer. Every write the app makes goes
// through applyMutation(state, type, payload) so concurrent edits from
// different family members/devices are serialized by the DB's optimistic
// version check in db.js rather than silently clobbering each other.
const crypto = require('crypto');

function uid(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

const ALLOWED_ENTRY_FIELDS = ['type', 'start', 'end', 'amount', 'diaper', 'temp', 'note', 'author', 'sleepKind'];

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
