'use strict';
// تخزين الفيديو والصور.
// - على Vercel: Supabase Storage. الجوال والمتصفح يرفعان الملف مباشرة إلى Supabase برابط موقّع،
//   لأن دوال Vercel لا تقبل طلبات أكبر من 4.5 ميغابايت ولا تحفظ الملفات.
// - محلياً وفي الاختبارات: تخزين في مجلد محلي بنفس الواجهة.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BUCKET = process.env.SUPABASE_BUCKET || 'media';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];

function supabaseStorage({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, maxBytes } = {}) {
  if (!url || !key) throw new Error('SUPABASE_URL و SUPABASE_SECRET_KEY مطلوبة للتخزين');
  const base = url.replace(/\/+$/, '') + '/storage/v1';
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  let bucketReady = null;

  async function ensureBucket() {
    const body = { id: BUCKET, name: BUCKET, public: true, file_size_limit: maxBytes, allowed_mime_types: ALLOWED_MIME };
    const r = await fetch(`${base}/bucket/${BUCKET}`, { headers });
    if (r.ok) {
      await fetch(`${base}/bucket/${BUCKET}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return;
    }
    const c = await fetch(`${base}/bucket`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!c.ok && c.status !== 409) throw new Error('تعذّر إنشاء حاوية التخزين: ' + (await c.text()));
  }

  return {
    kind: 'supabase',
    ready: () => (bucketReady ||= ensureBucket().catch((e) => { bucketReady = null; throw e; })),
    publicUrl: (p) => `${base}/object/public/${BUCKET}/${enc(p)}`,
    // رابط رفع موقّع (صالح ساعتين) يستخدمه العميل بطلب PUT
    async signUpload(p) {
      const r = await fetch(`${base}/object/upload/sign/${BUCKET}/${enc(p)}`, { method: 'POST', headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error('تعذّر تجهيز رابط الرفع');
      return { upload_url: base + d.url, method: 'PUT' };
    },
    // يقرأ أول بايتات الملف وحجمه للتحقق من نوعه الحقيقي
    async head(p) {
      const r = await fetch(`${base}/object/authenticated/${BUCKET}/${enc(p)}`, { headers: { ...headers, Range: 'bytes=0-15' } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 16);
      const cr = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
      const size = cr ? Number(cr[1]) : Number(r.headers.get('content-length')) || buf.length;
      return { size, head: buf };
    },
    async remove(paths) {
      if (!paths.length) return;
      await fetch(`${base}/object/${BUCKET}`, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }).catch(() => {});
    }
  };
}

// تخزين محلي للتطوير والاختبارات: نفس الواجهة، والرفع يمر عبر الخادم المحلي
function localStorage({ dir, publicBase = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const tokens = new Map();
  const safe = (p) => {
    const f = path.normalize(path.join(dir, p));
    if (!f.startsWith(dir + path.sep)) throw new Error('مسار غير صالح');
    return f;
  };
  return {
    kind: 'local',
    dir,
    ready: async () => {},
    publicUrl: (p) => `${publicBase}/__media/${p}`,
    async signUpload(p) {
      const token = crypto.randomBytes(16).toString('hex');
      tokens.set(token, p);
      return { upload_url: `${publicBase}/__upload/${p}?token=${token}`, method: 'PUT' };
    },
    // يستدعيه الخادم المحلي عند وصول PUT
    acceptUpload(p, token, buf) {
      if (tokens.get(token) !== p) return false;
      tokens.delete(token);
      const f = safe(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
      return true;
    },
    file: safe,
    async head(p) {
      try { const f = safe(p); const st = fs.statSync(f); const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); return { size: st.size, head: b }; } catch { return null; }
    },
    async remove(paths) { for (const p of paths) fs.rm(safe(p), { force: true }, () => {}); }
  };
}

function createStorage(opts = {}) {
  if (process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) return supabaseStorage(opts);
  return localStorage({ dir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads'), publicBase: opts.publicBase || '' });
}

module.exports = { createStorage, supabaseStorage, localStorage, ALLOWED_MIME, BUCKET };
