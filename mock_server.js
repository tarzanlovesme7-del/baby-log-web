// Dependency-free test server: reuses the REAL reducer (server/mutations.js)
// so Playwright can exercise the actual frontend/API contract without
// needing express/pg installed (npm registry is unreachable in this sandbox).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { applyMutation } = require('./server/mutations');

const EMPTY_STATE = {
  entries: [], active: null, customTypes: [], memos: [], typeOrder: [],
  profile: { nameKo: '지오', nameVi: 'Zio', birth: '2026-05-11' },
};

let state = EMPTY_STATE;
let version = 1;

function send(res, status, body){
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/api/state'){
    return send(res, 200, { data: state, version });
  }
  if (req.method === 'POST' && u.pathname === '/api/mutate'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { type, payload } = JSON.parse(body || '{}');
        const r = applyMutation(state, type, payload || {});
        state = r.state;
        version += 1;
        send(res, 200, { data: state, version, result: r.result });
      } catch (e) {
        send(res, e.status || 500, { error: e.message });
      }
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
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3311;
server.listen(PORT, () => console.log('mock server on ' + PORT));
