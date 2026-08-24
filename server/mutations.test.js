// Standalone logic test for the reducer — pure Node, no npm deps needed.
// Run with: node server/mutations.test.js
const assert = require('assert');
const { applyMutation } = require('./mutations');

const EMPTY_STATE = {
  entries: [], active: null, customTypes: [], memos: [], typeOrder: [],
  profile: { nameKo: '', nameVi: '', birth: '' },
};

let s = EMPTY_STATE;

let r = applyMutation(s, 'addEntry', { type: 'feed', start: new Date().toISOString(), amount: 120, author: '엄마' });
s = r.state;
assert.strictEqual(s.entries.length, 1);
const entryId = s.entries[0].id;

r = applyMutation(s, 'updateEntry', { id: entryId, amount: 150, note: 'test' });
s = r.state;
assert.strictEqual(s.entries[0].amount, 150);

r = applyMutation(s, 'startActive', { type: 'sleep', author: '아빠' });
s = r.state;
assert.ok(s.active && s.active.type === 'sleep');
const startedAt = s.active.start;

r = applyMutation(s, 'togglePauseActive', {});
s = r.state;
assert.strictEqual(s.active.paused, true);

r = applyMutation(s, 'togglePauseActive', {});
s = r.state;
assert.strictEqual(s.active.paused, false);
assert.ok(new Date(s.active.start).getTime() >= new Date(startedAt).getTime());

r = applyMutation(s, 'finishActive', {});
s = r.state;
assert.strictEqual(s.active, null);
assert.strictEqual(s.entries.length, 2);

r = applyMutation(s, 'deleteEntry', { id: entryId });
s = r.state;
assert.strictEqual(s.entries.length, 1);

try {
  applyMutation(s, 'deleteEntry', { id: 'nope' });
  assert.fail('expected throw');
} catch (e) {
  assert.strictEqual(e.status, 404);
}

r = applyMutation(s, 'addMemo', { text: '안녕하세요', lang: 'ko', translation: 'Xin chào', author: '엄마' });
s = r.state;
assert.strictEqual(s.memos.length, 1);

r = applyMutation(s, 'addCustomType', { name: '체온', color: '#ff0000', emoji: '🌡️' });
s = r.state;
const ctId = s.customTypes[0].id;
r = applyMutation(s, 'setTypeOrder', { order: ['feed', 'custom:' + ctId, 'diaper'] });
s = r.state;
r = applyMutation(s, 'deleteCustomType', { id: ctId });
s = r.state;
assert.strictEqual(s.customTypes.length, 0);
assert.ok(s.typeOrder.indexOf('custom:' + ctId) === -1);

r = applyMutation(s, 'setProfile', { nameKo: '지오', birth: '2026-05-11' });
s = r.state;
assert.strictEqual(s.profile.nameKo, '지오');

try {
  applyMutation(s, 'nope', {});
  assert.fail('expected throw');
} catch (e) {
  assert.strictEqual(e.status, 400);
}

console.log('ALL MUTATION TESTS PASSED');
