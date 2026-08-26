// Dependency-free test server: reuses the REAL reducer (server/mutations.js)
// so Playwright can exercise the actual frontend/API contract without
// needing express/pg installed (npm registry is unreachable in this sandbox).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { applyMutation } = require('./server/mutations');

const EMPTY_STATE = {
  entries: [], trash: [], active: null, customTypes: [], memos: [], typeOrder: [],
  customAuthors: [], quickWords: [],
  profile: { nameKo: '지오', nameVi: 'Zio', birth: '2026-05-11' },
};

let state = EMPTY_STATE;
let version = 1;

/* Photos, in memory. The real server keeps these in their own Postgres table
   (server/photos.js) precisely so they stay out of the state document — the
   thing being mirrored here is that contract: an id in the state, the bytes
   somewhere else, behind /api/photo. */
const photoStore = new Map();
const PHOTO_ID_RE = /^p_[0-9a-f]{24,40}$/;

function send(res, status, body){
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/api/version'){
    return send(res, 200, { version });
  }
  if (req.method === 'GET' && u.pathname === '/api/state'){
    return send(res, 200, { data: state, version });
  }
  if (req.method === 'POST' && u.pathname === '/api/photo'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id, mime, w, h, data, thumb } = JSON.parse(body || '{}');
        if (!PHOTO_ID_RE.test(id || '')) return send(res, 400, { error: 'bad photo id' });
        if (!data || !thumb) return send(res, 400, { error: 'data and thumb are required' });
        if (!['image/jpeg','image/png','image/webp'].includes(mime)) {
          return send(res, 400, { error: 'unsupported image type' });
        }
        const bytes = Buffer.from(String(data), 'base64');
        const tb = Buffer.from(String(thumb), 'base64');
        if (!bytes.length) return send(res, 400, { error: 'empty image' });
        if (bytes.length > 3 * 1024 * 1024) return send(res, 413, { error: 'image too large' });
        if (!photoStore.has(id)) photoStore.set(id, { mime, w, h, bytes, thumb: tb });
        send(res, 200, { id, w: w || null, h: h || null });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && u.pathname.startsWith('/api/photo/')){
    const id = decodeURIComponent(u.pathname.slice('/api/photo/'.length));
    const p = photoStore.get(id);
    if (!p) return send(res, 404, { error: 'photo not found' });
    const buf = u.searchParams.get('t') === '1' ? p.thumb : p.bytes;
    const tag = '"' + id + (u.searchParams.get('t') === '1' ? 't' : 'f') + '"';
    if (req.headers['if-none-match'] === tag){ res.writeHead(304, { ETag: tag }); return res.end(); }
    res.writeHead(200, {
      'Content-Type': p.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': tag,
    });
    return res.end(buf);
  }
  if (req.method === 'GET' && u.pathname === '/api/photo-usage'){
    let used = 0;
    photoStore.forEach(p => { used += p.bytes.length + p.thumb.length; });
    return send(res, 200, { used, budget: 300 * 1024 * 1024 });
  }
  if (req.method === 'GET' && u.pathname === '/api/photo-count'){
    return send(res, 200, { count: photoStore.size, ids: [...photoStore.keys()] });
  }
  if (req.method === 'POST' && u.pathname === '/api/mutate'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      /* MUTATE_DELAY_MS makes this server slow on purpose. The real one runs
         on a free tier that sleeps after fifteen minutes and takes 30–60s to
         wake, so "does the button answer straight away" is a question you
         cannot ask of a server that replies in one millisecond. */
      const wait = Number(process.env.MUTATE_DELAY_MS || 0);
      setTimeout(() => {
        try {
          const { type, payload } = JSON.parse(body || '{}');
          const r = applyMutation(state, type, payload || {});
          state = r.state;
          version += 1;
          /* same as the real server: the bytes go only once the write that
             orphaned them has landed */
          if (r.result && r.result.removedPhotos) {
            r.result.removedPhotos.forEach(id => photoStore.delete(id));
          }
          send(res, 200, { data: state, version, result: r.result });
        } catch (e) {
          send(res, e.status || 500, { error: e.message });
        }
      }, wait);
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/translate'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body || '{}');
        // stub: no network in this sandbox, just echo with a marker
        send(res, 200, { translated: '[VI] ' + text });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  // static file serving
  let filePath = u.pathname === '/' ? '/index.html' : u.pathname;
  filePath = path.join(__dirname, 'public', filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html'
      : ext === '.js' ? 'application/javascript'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.png' ? 'image/png'
      : ext === '.webmanifest' || ext === '.json' ? 'application/manifest+json'
      : 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3311;
server.listen(PORT, () => console.log('mock server on ' + PORT));
