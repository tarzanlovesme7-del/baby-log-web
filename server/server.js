const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { applyMutation } = require('./mutations');
const { translateText } = require('./translate');

const app = express();
app.use(express.json({ limit: '256kb' }));

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

app.get('/api/state', async (req, res, next) => {
  try {
    const { data, version } = await db.getState();
    res.json({ data, version });
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
        return res.json({ data: saved.data, version: saved.version, result });
      }
      // version conflict — someone else wrote in between; retry
    }
    return res.status(409).json({ error: 'too many concurrent writes, please retry' });
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

db.init()
  .then(() => {
    app.listen(PORT, () => console.log('baby-log listening on :' + PORT));
  })
  .catch((err) => {
    console.error('[baby-log] failed to init database', err);
    process.exit(1);
  });
