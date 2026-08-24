const path = require('path');
const express = require('express');
const db = require('./db');
const { applyMutation } = require('./mutations');
const { translateText } = require('./translate');

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---- static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.post('/api/translate', async (req, res, next) => {
  try {
    const { text, target } = req.body || {};
    if (!text || !target) return res.status(400).json({ error: 'text and target are required' });
    const translated = await translateText(text, target);
    res.json({ translated });
  } catch (err) { next(err); }
});

// fall through to the SPA for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
