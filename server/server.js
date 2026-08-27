const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const photos = require('./photos');
const { applyMutation } = require('./mutations');
const { translateText, hasGoodEngine } = require('./translate');

const app = express();
/* 256kb is generous for a nappy change and far too small for a photograph.
   This parser runs on everything, so it has to step aside for the one route
   that carries a picture — otherwise it rejects the upload at 413 before the
   route's own, larger parser is ever reached. */
const jsonSmall = express.json({ limit: '256kb' });
app.use((req, res, next) => {
  if (req.path === '/api/photo' && req.method === 'POST') return next();
  return jsonSmall(req, res, next);
});

/* ---- gzip, without pulling in a dependency ----
   The whole app is one ~170KB HTML file, and Express sends static files
   uncompressed by default — which on a phone over mobile data is most of the
   wait before anything appears. It never changes between deploys, so it is
   compressed ONCE at boot and served from memory with an ETag, making a
   repeat visit a 304 with no body at all. */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
const indexRaw = fs.readFileSync(INDEX_PATH);
const indexGz = zlib.gzipSync(indexRaw, { level: 9 });
const indexTag = '"' + crypto.createHash('sha1').update(indexRaw).digest('hex').slice(0, 16) + '"';

function sendIndex(req, res) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('ETag', indexTag);
  // revalidate every load: a deploy must reach the phones immediately, and
  // revalidation costs one 304 rather than the whole file
  res.set('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === indexTag) return res.status(304).end();
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    return res.end(indexGz);
  }
  res.end(indexRaw);
}

/* API responses grow with the log, so they get the same treatment — done by
   wrapping res.json rather than per-route, so nothing can be forgotten. */
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    const text = JSON.stringify(body);
    if (text.length < 1024 || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      return json(body);
    }
    const buf = zlib.gzipSync(Buffer.from(text, 'utf8'));
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    return res.end(buf);
  };
  next();
});

// ---- static frontend ----
app.get('/', sendIndex);
app.use(express.static(PUBLIC_DIR, { index: false }));

// ---- API ----
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* THE POLL ASKS THIS, NOT /api/state.
   Every open phone checks for other people's writes every few seconds. It
   used to do that by downloading the entire document — 234KB of records,
   ~23KB gzipped, every tick, or about 21MB an hour on a phone left open,
   growing as the log grows. The version counter answers the same question
   in a few bytes, and the whole document is fetched only when it moved. */
app.get('/api/version', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ version: await db.getVersion() });
  } catch (err) { next(err); }
});

app.get('/api/state', async (req, res, next) => {
  try {
    const { data, version } = await db.getState();
    /* goodTranslator: a DeepL key is configured, so the SERVER now gives a
       better translation than the free endpoint a phone can reach on its
       own — the phones read this flag and put the server first. Rides the
       state response because every phone already fetches it at boot. */
    res.json({ data, version, goodTranslator: hasGoodEngine() });
  } catch (err) { next(err); }
});

// Optimistic-concurrency mutation: read -> apply -> save-if-version-matches.
// On a version conflict (another client mutated first) it retries against
// the fresh state instead of clobbering that other write.
app.post('/api/mutate', async (req, res, next) => {
  const { type, payload } = req.body || {};
  if (!type) return res.status(400).json({ error: 'missing mutation type' });

  const MAX_RETRIES = 6;
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { data, version } = await db.getState();
      const { state: nextState, result } = applyMutation(data, type, payload);
      const saved = await db.saveState(nextState, version);
      if (saved) {
        /* the bytes go only once the write that orphaned them has actually
           landed — deleting them first would lose the pictures to a version
           conflict that then retries and keeps the memo */
        if (result && result.removedPhotos && result.removedPhotos.length) {
          photos.deletePhotos(result.removedPhotos)
            .catch((e) => console.error('[baby-log] photo cleanup', e));
        }
        return res.json({ data: saved.data, version: saved.version, result });
      }
      // version conflict — someone else wrote in between; retry
    }
    return res.status(409).json({ error: 'too many concurrent writes, please retry' });
  } catch (err) { next(err); }
});

/* ---- PHOTOS ----
   The bytes never go near /api/state: see server/photos.js for why. These
   two routes are the whole of it — one to put a picture up, one to get it
   back — and the state document only ever holds the id.

   The body limit here is its own: the app-wide one is 256kb, which is
   generous for a nappy change and far too small for a photograph. The phone
   has already shrunk the picture before it arrives (a 4MB iPhone photo lands
   at ~200KB); this ceiling is the guard against something that has not. */
const photoBody = express.json({ limit: '5mb' });

app.post('/api/photo', photoBody, async (req, res, next) => {
  try {
    const { id, mime, w, h, data, thumb } = req.body || {};
    if (!data || !thumb) return res.status(400).json({ error: 'data and thumb are required' });
    const saved = await photos.putPhoto({
      id, mime, w, h,
      bytes: Buffer.from(String(data), 'base64'),
      thumb: Buffer.from(String(thumb), 'base64'),
    });
    res.json(saved);
  } catch (err) { next(err); }
});

app.get('/api/photo/:id', async (req, res, next) => {
  try {
    const wantThumb = req.query.t === '1';
    const found = await photos.getPhoto(req.params.id, wantThumb);
    if (!found) return res.status(404).json({ error: 'photo not found' });
    /* A photo is written once and never changed, so its id IS its version:
       the phone that has it never needs to ask about it again. */
    res.set('Content-Type', found.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('ETag', '"' + req.params.id + (wantThumb ? 't' : 'f') + '"');
    if (req.headers['if-none-match'] === res.get('ETag')) return res.status(304).end();
    res.end(found.data);
  } catch (err) { next(err); }
});

/* how much room is left, for the settings screen to show before it runs out
   rather than after */
app.get('/api/photo-usage', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ used: await photos.usedBytes(), budget: photos.BUDGET_BYTES });
  } catch (err) { next(err); }
});

// Translation is a pure read — it touches no stored data — so it answers to
// GET as well as POST. That makes it checkable from a browser or any plain
// HTTP client, which is the only way to confirm the upstream providers are
// actually returning Korean<->Vietnamese rather than trusting a local stub.
async function handleTranslate(req, res, next) {
  try {
    const src = req.method === 'GET' ? req.query : (req.body || {});
    const text = src.text || src.q;
    const target = src.target || src.tl;
    if (!text || !target) return res.status(400).json({ error: 'text and target are required' });
    if (target !== 'ko' && target !== 'vi') {
      return res.status(400).json({ error: 'target must be ko or vi' });
    }
    const translated = await translateText(String(text), String(target));
    res.json({ translated });
  } catch (err) { next(err); }
}
app.post('/api/translate', handleTranslate);
app.get('/api/translate', handleTranslate);

// fall through to the SPA for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  sendIndex(req, res);
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[baby-log]', err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

const PORT = process.env.PORT || 3000;

/* Pictures that went up but whose memo never landed — the app was closed
   between the two writes, or the memo write failed after the upload. Nothing
   references them and nothing ever will, so they are swept an hour later,
   when whatever went wrong is long over. */
async function sweepOrphanPhotos() {
  try {
    const { data } = await db.getState();
    const referenced = [];
    (data.memos || []).forEach((m) => (m.photos || []).forEach((p) => referenced.push(p.id)));
    const gone = await photos.sweepOrphans(referenced, 60);
    if (gone) console.log('[baby-log] swept ' + gone + ' orphaned photo(s)');
  } catch (err) { console.error('[baby-log] orphan sweep', err); }
}

db.init()
  .then(() => photos.initPhotos())
  .then(() => {
    app.listen(PORT, () => console.log('baby-log listening on :' + PORT));
    sweepOrphanPhotos();
    setInterval(sweepOrphanPhotos, 6 * 60 * 60 * 1000).unref();
  })
  .catch((err) => {
    console.error('[baby-log] failed to init database', err);
    process.exit(1);
  });
