// db.js — thin Postgres (Neon) access layer.
// The whole app's shared data lives in ONE JSONB row (id=1) plus a version
// counter. All mutations go through applyMutation() below so every client
// (mom's phone, dad's phone, the nanny's phone) is editing through the same
// server-side reducer instead of racing raw writes against each other.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
    ? undefined // sslmode already in the connection string (Neon default)
    : { rejectUnauthorized: false },
});

const EMPTY_STATE = {
  entries: [],       // [{id,type,start,end,amount,diaper,temp,note,author,sleepKind}]
  trash: [],          // deleted entries, kept 30 days: [{...entry, deletedAt, deletedBy}]
  active: null,       // {type,start,name,author,paused,pausedAt} | null
  customTypes: [],    // [{id,name,color,emoji}]
  memos: [],          // [{id,text,lang,translation,author,ts}]
  typeOrder: [],       // [typeId, ...]
  customAuthors: [],   // [{id,name}] — extra author names beyond the 3 presets
  quickWords: [],      // [{id,typeId,text}] — reusable note snippets per type
  profile: { nameKo: '지오', nameVi: 'Zio', birth: '2026-05-11' },
};

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      version BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (!rows.length) {
    await pool.query(
      'INSERT INTO app_state (id, data, version) VALUES (1, $1, 0)',
      [EMPTY_STATE]
    );
  }
}

async function getState() {
  const { rows } = await pool.query('SELECT data, version FROM app_state WHERE id = 1');
  if (!rows.length) { await init(); return { data: EMPTY_STATE, version: 0 }; }
  return { data: rows[0].data, version: Number(rows[0].version) };
}

/* Just the version counter. The app asks for this every few seconds to find
   out whether anything changed; sending the whole document to answer that
   question was costing every phone ~23KB a tick. */
async function getVersion() {
  const { rows } = await pool.query('SELECT version FROM app_state WHERE id = 1');
  return rows.length ? Number(rows[0].version) : 0;
}

async function saveState(data, expectedVersion) {
  const { rows } = await pool.query(
    `UPDATE app_state SET data = $1, version = version + 1, updated_at = now()
     WHERE id = 1 AND version = $2
     RETURNING data, version`,
    [data, expectedVersion]
  );
  if (!rows.length) return null; // version conflict — caller should retry
  return { data: rows[0].data, version: Number(rows[0].version) };
}

module.exports = { pool, init, getState, getVersion, saveState, EMPTY_STATE };
