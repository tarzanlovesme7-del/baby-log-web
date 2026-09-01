/* videos.js — the moving pictures on a diary page.
   ================================================================

   THE SAME SHAPE AS photos.js, AND DELIBERATELY STRICTER. A photograph
   arrives here already shrunk by the phone to ~230KB; a video cannot be,
   because a browser has no way to re-encode one that works on both an
   iPhone and the nanny's Android. So what arrives is whatever the camera
   made, and the only defences are a hard ceiling per clip and a budget for
   the lot of them.

   Those numbers are chosen against Neon's 0.5GB free tier, which today
   holds a 10MB database. Twenty-five megabytes is about twenty seconds of
   1080p from a phone; 250MB of budget is ten of them. That is the honest
   ceiling of keeping video in Postgres at all, and the point at which the
   pictures want to move to object storage.

   Every clip carries a POSTER — one frame, grabbed on the phone before the
   upload. The diary list draws posters only: a page with three clips on it
   must not pull seventy-five megabytes to show three thumbnails, and
   `<video preload="none">` fetches nothing at all until it is tapped.
   ================================================================ */
const crypto = require('crypto');
const { pool } = require('./db');

const BUDGET_BYTES = 250 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_POSTER_BYTES = 400 * 1024;
const MAX_SECONDS = 60;
/* what phones actually produce: iOS gives .mov (quicktime), Android .mp4,
   and a browser recording gives .webm */
const ALLOWED_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];

async function initVideos() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS diary_videos (
      id TEXT PRIMARY KEY,
      mime TEXT,
      w INTEGER,
      h INTEGER,
      dur REAL,
      bytes BYTEA,
      poster BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

const ID_RE = /^v_[0-9a-f]{24,40}$/;
function isVideoId(id) { return typeof id === 'string' && ID_RE.test(id); }
function newVideoId() { return 'v_' + crypto.randomBytes(14).toString('hex'); }

async function usedBytes() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(octet_length(bytes),0) + COALESCE(octet_length(poster),0)), 0)::bigint AS n
       FROM diary_videos`
  );
  return Number(rows[0].n);
}

/* THE POSTER GOES FIRST and creates the row. It is small, so it is the
   cheap half to lose if the connection drops on a Vietnamese 4G — and a row
   with a poster and no bytes is an orphan the sweep collects, rather than a
   clip that half exists. */
async function putPoster({ id, w, h, dur, poster }) {
  if (!isVideoId(id)) throw Object.assign(new Error('bad video id'), { status: 400 });
  if (!poster || !poster.length) throw Object.assign(new Error('empty poster'), { status: 400 });
  if (poster.length > MAX_POSTER_BYTES) throw Object.assign(new Error('poster too large'), { status: 413 });
  const seconds = Number(dur);
  if (Number.isFinite(seconds) && seconds > MAX_SECONDS) {
    throw Object.assign(new Error('video too long'), { status: 413 });
  }
  await pool.query(
    `INSERT INTO diary_videos (id, w, h, dur, poster)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET poster = EXCLUDED.poster,
       w = EXCLUDED.w, h = EXCLUDED.h, dur = EXCLUDED.dur`,
    [id, Number.isFinite(Number(w)) ? Math.round(Number(w)) : null,
     Number.isFinite(Number(h)) ? Math.round(Number(h)) : null,
     Number.isFinite(seconds) ? seconds : null, poster]
  );
  return { id };
}

async function putVideo({ id, mime, bytes }) {
  if (!isVideoId(id)) throw Object.assign(new Error('bad video id'), { status: 400 });
  if (!ALLOWED_MIME.includes(mime)) throw Object.assign(new Error('unsupported video type'), { status: 400 });
  if (!bytes || !bytes.length) throw Object.assign(new Error('empty video'), { status: 400 });
  if (bytes.length > MAX_VIDEO_BYTES) throw Object.assign(new Error('video too large'), { status: 413 });
  /* a retry after a dropped upload re-sends the same clip under the same id;
     it must replace, not add to, what is already counted */
  const { rows } = await pool.query(
    'SELECT COALESCE(octet_length(bytes), 0)::bigint AS n FROM diary_videos WHERE id = $1', [id]
  );
  const already = rows.length ? Number(rows[0].n) : 0;
  if ((await usedBytes()) - already + bytes.length > BUDGET_BYTES) {
    throw Object.assign(new Error('video storage full'), { status: 507 });
  }
  const { rowCount } = await pool.query(
    'UPDATE diary_videos SET mime = $2, bytes = $3 WHERE id = $1', [id, mime, bytes]
  );
  if (!rowCount) throw Object.assign(new Error('poster must be uploaded first'), { status: 409 });
  return { id, bytes: bytes.length };
}

async function getVideo(id) {
  if (!isVideoId(id)) return null;
  const { rows } = await pool.query(
    'SELECT mime, bytes, octet_length(bytes) AS len FROM diary_videos WHERE id = $1', [id]
  );
  if (!rows.length || !rows[0].bytes) return null;
  return { mime: rows[0].mime || 'video/mp4', data: rows[0].bytes, len: Number(rows[0].len) };
}

async function getPoster(id) {
  if (!isVideoId(id)) return null;
  const { rows } = await pool.query('SELECT poster FROM diary_videos WHERE id = $1', [id]);
  if (!rows.length || !rows[0].poster) return null;
  return { mime: 'image/jpeg', data: rows[0].poster };
}

async function deleteVideos(ids) {
  const keep = (ids || []).filter(isVideoId);
  if (!keep.length) return 0;
  const { rowCount } = await pool.query('DELETE FROM diary_videos WHERE id = ANY($1)', [keep]);
  return rowCount;
}

/* Clips whose diary page never landed — and rows that only ever got their
   poster, because the upload of the bytes never finished. */
async function sweepOrphans(referencedIds, olderThanMinutes) {
  const { rowCount } = await pool.query(
    `DELETE FROM diary_videos
      WHERE created_at < now() - ($2 || ' minutes')::interval
        AND NOT (id = ANY($1))`,
    [referencedIds || [], String(olderThanMinutes || 60)]
  );
  return rowCount;
}

module.exports = {
  initVideos, putPoster, putVideo, getVideo, getPoster, deleteVideos, sweepOrphans,
  usedBytes, isVideoId, newVideoId,
  BUDGET_BYTES, MAX_VIDEO_BYTES, MAX_POSTER_BYTES, MAX_SECONDS, ALLOWED_MIME,
};
