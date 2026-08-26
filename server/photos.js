/* photos.js — where the picture bytes live.
   ================================================================

   NOT IN app_state. The whole app's shared data is one JSONB row that every
   phone re-downloads whenever anything in it changes, and that every write
   rewrites end to end. A single photo dropped in there would be re-sent to
   three phones on every nappy change, and re-written on every one too. The
   state row keeps only the photo's id and shape; the bytes live here, in
   their own table, fetched once per photo per phone and then cached forever
   because a photo never changes.

   Two sizes are stored. The memo list draws thumbnails, and a list of ten
   memos should not pull ten full-size pictures over a Vietnamese mobile
   connection to show ten 76-pixel squares.

   The phone shrinks the picture before it ever gets here (see compressPhoto
   in the client): a 4MB photo from an iPhone arrives as ~200KB. That is for
   the upload's sake as much as the disk's.
   ================================================================ */
const crypto = require('crypto');
const { pool } = require('./db');

/* Neon's free tier holds 0.5GB and the records themselves need room to grow,
   so photos get a budget rather than the run of the disk. At ~230KB a photo
   this is a few thousand of them — years of a baby's log — and when it does
   fill up the app says so instead of failing at the database. */
const BUDGET_BYTES = 300 * 1024 * 1024;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_THUMB_BYTES = 200 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

async function initPhotos() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memo_photos (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      w INTEGER,
      h INTEGER,
      bytes BYTEA NOT NULL,
      thumb BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/* ids come from the phone so that it can show the picture, and post the memo
   that references it, without waiting for the upload to come back */
const ID_RE = /^p_[0-9a-f]{24,40}$/;
function isPhotoId(id) { return typeof id === 'string' && ID_RE.test(id); }
function newPhotoId() { return 'p_' + crypto.randomBytes(14).toString('hex'); }

async function usedBytes() {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(octet_length(bytes) + octet_length(thumb)), 0)::bigint AS n FROM memo_photos'
  );
  return Number(rows[0].n);
}

async function putPhoto({ id, mime, w, h, bytes, thumb }) {
  if (!isPhotoId(id)) throw Object.assign(new Error('bad photo id'), { status: 400 });
  if (!ALLOWED_MIME.includes(mime)) throw Object.assign(new Error('unsupported image type'), { status: 400 });
  if (!bytes || !bytes.length) throw Object.assign(new Error('empty image'), { status: 400 });
  if (bytes.length > MAX_PHOTO_BYTES) throw Object.assign(new Error('image too large'), { status: 413 });
  if (!thumb || !thumb.length || thumb.length > MAX_THUMB_BYTES) {
    throw Object.assign(new Error('bad thumbnail'), { status: 400 });
  }
  if ((await usedBytes()) + bytes.length + thumb.length > BUDGET_BYTES) {
    throw Object.assign(new Error('photo storage full'), { status: 507 });
  }
  /* re-uploading the same id (a retry after a dropped connection) must not
     fail or duplicate — it is the same picture */
  await pool.query(
    `INSERT INTO memo_photos (id, mime, w, h, bytes, thumb)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, mime, w || null, h || null, bytes, thumb]
  );
  return { id, w: w || null, h: h || null };
}

async function getPhoto(id, wantThumb) {
  if (!isPhotoId(id)) return null;
  const col = wantThumb ? 'thumb' : 'bytes';
  const { rows } = await pool.query(
    `SELECT mime, ${col} AS data FROM memo_photos WHERE id = $1`, [id]
  );
  return rows.length ? { mime: rows[0].mime, data: rows[0].data } : null;
}

/* called after a memo that owned them is deleted for good */
async function deletePhotos(ids) {
  const keep = (ids || []).filter(isPhotoId);
  if (!keep.length) return 0;
  const { rowCount } = await pool.query('DELETE FROM memo_photos WHERE id = ANY($1)', [keep]);
  return rowCount;
}

/* Anything uploaded that no memo ended up referencing — the app was closed
   between the upload and the memo being posted, or the memo write failed
   after its pictures had gone up. Swept on a schedule rather than at the
   moment of failure, because the failure case is exactly when the phone is
   least able to tell us. */
async function sweepOrphans(referencedIds, olderThanMinutes) {
  const { rowCount } = await pool.query(
    `DELETE FROM memo_photos
      WHERE created_at < now() - ($2 || ' minutes')::interval
        AND NOT (id = ANY($1))`,
    [referencedIds || [], String(olderThanMinutes || 60)]
  );
  return rowCount;
}

module.exports = {
  initPhotos, putPhoto, getPhoto, deletePhotos, sweepOrphans,
  usedBytes, isPhotoId, newPhotoId,
  BUDGET_BYTES, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, ALLOWED_MIME,
};
