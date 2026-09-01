// Dependency-free test server: reuses the REAL reducer (server/mutations.js)
// so Playwright can exercise the actual frontend/API contract without
// needing express/pg installed (npm registry is unreachable in this sandbox).
const http = require('http');
const fs = require('fs');
const path = require('path');
const glossary = require('./server/glossary');
const { applyMutation } = require('./server/mutations');

const EMPTY_STATE = {
  entries: [], trash: [], active: null, customTypes: [], memos: [], typeOrder: [], weights: [], heights: [], milestones: [], diaries: [], schedules: [],
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
/* clips live beside the pictures and answer to the same contract as
   server/videos.js — poster first (it creates the row), bytes second, and
   byte-range reads, because a <video> that cannot seek never plays */
const videoStore = new Map();
const VIDEO_ID_RE = /^v_[0-9a-f]{24,40}$/;
const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];
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
    /* MOCK_GOOD_TRANSLATOR=1 plays a server that has a DeepL key, so the
       suites can check the phones switch to server-first translation */
    return send(res, 200, { data: state, version,
      goodTranslator: process.env.MOCK_GOOD_TRANSLATOR === '1' });
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
  // ---- video: POST /api/video/:id/poster then /api/video/:id/bytes ----
  const vm = /^\/api\/video\/([^/]+)(\/poster|\/bytes)?$/.exec(u.pathname);
  if (vm && req.method === 'POST'){
    const id = decodeURIComponent(vm[1]);
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (!VIDEO_ID_RE.test(id)) return send(res, 400, { error: 'bad video id' });
      if (vm[2] === '/poster'){
        if (!body.length) return send(res, 400, { error: 'empty poster' });
        if (body.length > 400 * 1024) return send(res, 413, { error: 'poster too large' });
        const dur = Number(u.searchParams.get('dur'));
        if (Number.isFinite(dur) && dur > 60) return send(res, 413, { error: 'video too long' });
        const prev = videoStore.get(id) || {};
        videoStore.set(id, Object.assign({}, prev, {
          poster: body,
          w: Number(u.searchParams.get('w')) || null,
          h: Number(u.searchParams.get('h')) || null,
          dur: Number.isFinite(dur) ? dur : null,
        }));
        return send(res, 200, { id });
      }
      if (vm[2] === '/bytes'){
        const mime = u.searchParams.get('mime') || '';
        if (!VIDEO_MIME.includes(mime)) return send(res, 400, { error: 'unsupported video type' });
        if (!body.length) return send(res, 400, { error: 'empty video' });
        if (body.length > 25 * 1024 * 1024) return send(res, 413, { error: 'video too large' });
        const row = videoStore.get(id);
        if (!row) return send(res, 409, { error: 'poster must be uploaded first' });
        row.mime = mime; row.bytes = body;
        return send(res, 200, { id, bytes: body.length });
      }
      return send(res, 404, { error: 'not found' });
    });
    return;
  }
  if (vm && req.method === 'GET'){
    const id = decodeURIComponent(vm[1]);
    const row = videoStore.get(id);
    if (vm[2] === '/poster'){
      if (!row || !row.poster) return send(res, 404, { error: 'poster not found' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': '"' + id + 'p"' });
      return res.end(row.poster);
    }
    if (vm[2]) return send(res, 404, { error: 'not found' });
    if (!row || !row.bytes) return send(res, 404, { error: 'video not found' });
    const len = row.bytes.length;
    const head = { 'Content-Type': row.mime || 'video/mp4', 'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': '"' + id + 'v"' };
    const m = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range).trim());
    if (!m){ res.writeHead(200, Object.assign({ 'Content-Length': String(len) }, head)); return res.end(row.bytes); }
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null){ start = Math.max(0, len - (end === null ? 0 : end)); end = len - 1; }
    else if (end === null){ end = len - 1; }
    if (!(start >= 0 && end < len && start <= end)){
      res.writeHead(416, Object.assign({ 'Content-Range': 'bytes */' + len }, head));
      return res.end();
    }
    res.writeHead(206, Object.assign({
      'Content-Range': 'bytes ' + start + '-' + end + '/' + len,
      'Content-Length': String(end - start + 1) }, head));
    return res.end(row.bytes.slice(start, end + 1));
  }
  if (req.method === 'GET' && u.pathname === '/api/photo-usage'){
    let used = 0;
    photoStore.forEach(p => { used += p.bytes.length + p.thumb.length; });
    let vUsed = 0;
    videoStore.forEach(v => { vUsed += (v.bytes ? v.bytes.length : 0) + (v.poster ? v.poster.length : 0); });
    return send(res, 200, { used, budget: 300 * 1024 * 1024,
      videoUsed: vUsed, videoBudget: 250 * 1024 * 1024 });
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
          if (r.result && r.result.removedVideos) {
            r.result.removedVideos.forEach(id => videoStore.delete(id));
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
        const { text, target } = JSON.parse(body || '{}');
        /* the glossary is the real module, so the browser suites exercise the
           path a known phrase actually takes; everything else has no network
           in this sandbox and is echoed with a marker */
        const known = glossary.lookup(text || '', target === 'ko' ? 'ko' : 'vi');
        send(res, 200, { translated: known || ('[VI] ' + text) });
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
