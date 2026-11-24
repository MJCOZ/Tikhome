'use strict';
// خادم التطوير المحلي: يخدم الواجهة من public/ والـ API من src/app.js.
// على Vercel لا يُستخدم هذا الملف؛ Vercel يخدم public/ ودالة api/index.js مباشرة.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createDb } = require('./src/db');
const { createStorage } = require('./src/storage');
const { createApp } = require('./src/app');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function serveFile(req, res, file, extra = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('غير موجود'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...extra };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      const end = Math.min(range[1] && range[2] ? Number(range[2]) : st.size - 1, st.size - 1);
      if (!(start >= 0) || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function createServer({ db = createDb(), storage = createStorage({ publicBase: process.env.PUBLIC_URL || '' }) } = {}) {
  const api = createApp({ db, storage });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // CORS للتطوير المحلي (Expo على المتصفح)
    if (req.headers.origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Client');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    if (url.pathname.startsWith('/api/')) return api(req, res);

    // محاكاة Supabase Storage محلياً
    if (storage.kind === 'local' && url.pathname.startsWith('/__upload/') && req.method === 'PUT') {
      const p = decodeURIComponent(url.pathname.slice('/__upload/'.length));
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= 200 * 1024 * 1024) chunks.push(c); });
      req.on('end', () => {
        let ok = false; try { ok = storage.acceptUpload(p, url.searchParams.get('token'), Buffer.concat(chunks)); } catch { /* */ }
        res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok }));
      });
      return;
    }
    if (storage.kind === 'local' && url.pathname.startsWith('/__media/')) {
      try { return serveFile(req, res, storage.file(decodeURIComponent(url.pathname.slice('/__media/'.length))), { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'" }); } catch { res.writeHead(403); return res.end(); }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' || url.pathname === '/admin/' ? 'admin.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    serveFile(req, res, file, { 'Cache-Control': 'no-cache' });
  });
  server.db = db;
  server.api = api;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`الخادم يعمل على http://localhost:${port}  (لوحة التحكم: /admin)`));
}
module.exports = { createServer };
