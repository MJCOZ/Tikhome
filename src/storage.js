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

function supabaseStorage({ url = process.env.SUPABASE_URL, key, maxBytes } = {}) {
  // المفتاح القديم service_role (JWT يبدأ بـ eyJ) هو الأضمن مع Storage؛ وإلا نستخدم المفتاح السري الجديد
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY;
  key = key || (legacy && legacy.startsWith('eyJ') ? legacy : process.env.SUPABASE_SECRET_KEY || legacy);
  if (!url || !key) throw new Error('SUPABASE_URL و SUPABASE_SECRET_KEY مطلوبة للتخزين');
  const base = url.replace(/\/+$/, '') + '/storage/v1';
  // طريقة إرسال المفتاح تختلف بين المفاتيح الجديدة (sb_secret_) والقديمة (JWT) وما زالت غير موحّدة،
  // فنجرّب الطرق بالترتيب ونتذكر أول طريقة تنجح.
  const modes = key.startsWith('sb_')
    ? [{ apikey: key }, { apikey: key, Authorization: 'Bearer ' + key }]
    : [{ apikey: key, Authorization: 'Bearer ' + key }];
  let mode = 0;
  const authError = async (r) => {
    if (r.status !== 400 && r.status !== 401 && r.status !== 403) return false;
    const t = await r.clone().text().catch(() => '');
    return /jws|jwt|authorization|apikey|invalid.*key|unauthori/i.test(t);
  };
  async function sfetch(path, init = {}) {
    let r;
    for (let i = mode; i < modes.length; i++) {
      r = await fetch(base + path, { ...init, headers: { ...modes[i], ...(init.headers || {}) } });
      if (i < modes.length - 1 && await authError(r)) continue;
      mode = i;
      return r;
    }
    return r;
  }
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  let bucketReady = null;

  async function ensureBucket() {
    const body = JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: maxBytes, allowed_mime_types: ALLOWED_MIME });
    const json = { 'Content-Type': 'application/json' };
    const r = await sfetch(`/bucket/${BUCKET}`);
    if (r.ok) {
      await sfetch(`/bucket/${BUCKET}`, { method: 'PUT', headers: json, body });
      return;
    }
    const c = await sfetch('/bucket', { method: 'POST', headers: json, body });
    if (!c.ok && c.status !== 409) {
      const t = await c.text();
      const hint = /jws|jwt/i.test(t) ? ' — أضف مفتاح service_role القديم في Vercel باسم SUPABASE_SERVICE_ROLE_KEY' : '';
      throw new Error(`تعذّر إنشاء حاوية التخزين (${key.startsWith('sb_') ? 'مفتاح جديد' : 'مفتاح JWT'}): ${t.slice(0, 200)}${hint}`);
    }
  }

  return {
    kind: 'supabase',
    ready: () => (bucketReady ||= ensureBucket().catch((e) => { bucketReady = null; throw e; })),
    publicUrl: (p) => `${base}/object/public/${BUCKET}/${enc(p)}`,
    // رابط رفع موقّع (صالح ساعتين) يستخدمه العميل بطلب PUT
    async signUpload(p) {
      const r = await sfetch(`/object/upload/sign/${BUCKET}/${enc(p)}`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error('تعذّر تجهيز رابط الرفع');
      return { upload_url: base + d.url, method: 'PUT' };
    },
    // يقرأ أول بايتات الملف وحجمه للتحقق من نوعه الحقيقي
    async head(p) {
      const r = await sfetch(`/object/authenticated/${BUCKET}/${enc(p)}`, { headers: { Range: 'bytes=0-15' } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 16);
      const cr = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
      const size = cr ? Number(cr[1]) : Number(r.headers.get('content-length')) || buf.length;
      return { size, head: buf };
    },
    async remove(paths) {
      if (!paths.length) return;
      await sfetch(`/object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }).catch(() => {});
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
