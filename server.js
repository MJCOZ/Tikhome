'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA_DIR, hashPassword, verifyPassword, getSetting, firstAdminInfo } = require('./lib/db');
const { parseMultipart } = require('./lib/multipart');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_DAYS = 30;

// ---------------------------------------------------------------- أدوات عامة
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
const UPLOAD_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'الملف أو الطلب أكبر من الحد المسموح')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('صيغة JSON غير صحيحة'); }
}
const toLatin = (s) => String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const intOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
const today = () => new Date().toISOString().slice(0, 10);
function audit(adminId, action, target) {
  db.prepare('INSERT INTO audit_log (admin_id, action, target) VALUES (?, ?, ?)').run(adminId, action, String(target || ''));
}
function notify(userId, text, listingId = null) {
  db.prepare('INSERT INTO notifications (user_id, text, listing_id) VALUES (?, ?, ?)').run(userId, text, listingId);
}
function toIntlPhone(phone) { return '966' + String(phone).replace(/^0/, ''); }

// ---------------------------------------------------------------- الجلسات
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function cookieHeader(req, token, maxAge) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}
function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha(token), Date.now());
  if (!row || row.banned) return null;
  return row;
}
const publicUser = (u) => u && ({ id: u.id, name: u.name, phone: u.phone, role: u.role, verified: !!u.verified, verify_requested: !!u.verify_requested });

// تقييد محاولات الدخول
const attempts = new Map();
function throttle(key, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'محاولات كثيرة، حاول لاحقاً');
  arr.push(now); attempts.set(key, arr);
}

// ---------------------------------------------------------------- الإعلانات
const PUBLIC_WHERE = "l.status = 'published' AND l.license_expires >= date('now')";

function mediaFor(listingId) {
  return db.prepare('SELECT id, file, mime FROM media WHERE listing_id = ? ORDER BY position, id').all(listingId)
    .map((m) => ({ id: m.id, url: '/uploads/' + m.file, mime: m.mime }));
}
function serializeListing(l, user, { owner = false } = {}) {
  const o = db.prepare('SELECT name, verified FROM users WHERE id = ?').get(l.owner_id) || {};
  const out = {
    id: l.id, kind: l.kind, property_type: l.property_type, title: l.title, city: l.city, district: l.district,
    price: l.price, area: l.area, beds: l.beds, baths: l.baths, floor: l.floor, entrance: l.entrance,
    description: l.description, lat: l.lat, lng: l.lng, media_type: l.media_type,
    license_no: l.license_no, license_expires: l.license_expires, status: l.status,
    featured: !!(l.featured_until && l.featured_until >= today()),
    media: mediaFor(l.id), owner_name: o.name, owner_verified: !!o.verified, created_at: l.created_at,
    saved: user ? !!db.prepare('SELECT 1 FROM saves WHERE user_id = ? AND listing_id = ?').get(user.id, l.id) : false
  };
  if (owner) {
    out.reject_reason = l.reject_reason; out.views = l.views; out.featured_until = l.featured_until;
    out.contacts = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE listing_id = ?').get(l.id).n;
  }
  return out;
}

function validateListing(b, { partial = false } = {}) {
  const v = {};
  const need = (k, cond, msg) => { if (!partial || k in b) { if (!cond) throw bad(msg); } };
  if (!partial || 'kind' in b) { need('kind', ['rent', 'sale'].includes(b.kind), 'نوع العرض: إيجار أو بيع'); v.kind = b.kind; }
  if (!partial || 'title' in b) { v.title = str(b.title, 120); need('title', v.title.length >= 3, 'العنوان قصير'); }
  if (!partial || 'city' in b) { v.city = str(b.city, 60); need('city', v.city, 'المدينة مطلوبة'); }
  if (!partial || 'district' in b) { v.district = str(b.district, 60); need('district', v.district, 'الحي مطلوب'); }
  if (!partial || 'price' in b) { v.price = intOrNull(b.price); need('price', v.price > 0 && v.price < 1e10, 'السعر غير صحيح'); }
  if ('property_type' in b) v.property_type = ['apartment', 'villa', 'floor', 'land', 'office', 'shop'].includes(b.property_type) ? b.property_type : 'apartment';
  for (const k of ['area', 'beds', 'baths']) if (k in b) { const n = intOrNull(b[k]); if (n != null && (n < 0 || n > 100000)) throw bad('قيمة غير صحيحة: ' + k); v[k] = n; }
  if ('floor' in b) { const n = intOrNull(b.floor); if (n != null && (n < 0 || n > 100)) throw bad('رقم الدور غير صحيح'); v.floor = n; }
  if ('entrance' in b) { if (b.entrance && !['private', 'shared'].includes(b.entrance)) throw bad('نوع المدخل غير صحيح'); v.entrance = b.entrance || null; }
  if ('description' in b) v.description = str(b.description, 2000);
  for (const k of ['lat', 'lng']) if (k in b) {
    const n = b[k] === '' || b[k] == null ? null : Number(b[k]);
    if (n != null && (Number.isNaN(n) || Math.abs(n) > 180)) throw bad('الإحداثيات غير صحيحة');
    v[k] = n;
  }
  if ('media_type' in b) { need('media_type', ['video', 'photos'].includes(b.media_type), 'نوع المحتوى: فيديو أو صور'); v.media_type = b.media_type; }
  if (!partial || 'license_no' in b) { v.license_no = str(toLatin(b.license_no), 40); need('license_no', v.license_no.length >= 3, 'رقم ترخيص الإعلان مطلوب'); }
  if (!partial || 'license_expires' in b) {
    v.license_expires = str(toLatin(b.license_expires), 10);
    need('license_expires', /^\d{4}-\d{2}-\d{2}$/.test(v.license_expires) && v.license_expires >= today(), 'تاريخ انتهاء الترخيص غير صحيح أو منتهٍ');
  }
  return v;
}

function currentPlan(userId) {
  const sub = db.prepare(`SELECT p.* FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                          WHERE s.user_id = ? AND s.ends_at >= date('now') ORDER BY p.max_listings DESC LIMIT 1`).get(userId);
  return sub || db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY id LIMIT 1').get();
}

function ownerListing(user, id) {
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!l) throw new HttpError(404, 'الإعلان غير موجود');
  if (l.owner_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'ليس إعلانك');
  return l;
}

function searchListings(q, user) {
  const where = [PUBLIC_WHERE]; const args = [];
  if (q.kind === 'rent' || q.kind === 'sale') { where.push('l.kind = ?'); args.push(q.kind); }
  if (q.city) { where.push('l.city = ?'); args.push(q.city); }
  if (q.district) { where.push('l.district = ?'); args.push(q.district); }
  if (q.q) { where.push('(l.title LIKE ? OR l.district LIKE ? OR l.description LIKE ?)'); const p = `%${q.q.slice(0, 50)}%`; args.push(p, p, p); }
  if (intOrNull(q.min) != null) { where.push('l.price >= ?'); args.push(intOrNull(q.min)); }
  if (intOrNull(q.max) != null) { where.push('l.price <= ?'); args.push(intOrNull(q.max)); }
  if (intOrNull(q.beds) != null) { where.push('l.beds >= ?'); args.push(intOrNull(q.beds)); }
  if (intOrNull(q.floor) != null) { where.push('l.floor = ?'); args.push(intOrNull(q.floor)); }
  if (q.entrance === 'private' || q.entrance === 'shared') { where.push('l.entrance = ?'); args.push(q.entrance); }
  if (q.media === 'video' || q.media === 'photos') { where.push('l.media_type = ?'); args.push(q.media); }
  if (q.property_type) { where.push('l.property_type = ?'); args.push(q.property_type); }
  if (q.bbox) {
    const [s, w, n, e] = String(q.bbox).split(',').map(Number);
    if ([s, w, n, e].every(Number.isFinite)) { where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?'); args.push(s, n, w, e); }
  }
  const order = q.sort === 'price_asc' ? 'l.price ASC' : q.sort === 'price_desc' ? 'l.price DESC'
    : "(l.featured_until >= date('now')) DESC, l.created_at DESC";
  const limit = Math.min(Math.max(intOrNull(q.limit) || 20, 1), 50);
  const offset = Math.max(intOrNull(q.offset) || 0, 0);
  const rows = db.prepare(`SELECT l.* FROM listings l WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return rows.map((l) => serializeListing(l, user));
}

function matchesSavedSearch(l, query) {
  try {
    const q = JSON.parse(query);
    if (q.kind && q.kind !== l.kind) return false;
    if (q.city && q.city !== l.city) return false;
    if (q.district && q.district !== l.district) return false;
    if (q.min && l.price < Number(q.min)) return false;
    if (q.max && l.price > Number(q.max)) return false;
    if (q.beds && (l.beds || 0) < Number(q.beds)) return false;
    return true;
  } catch { return false; }
}
function publishListing(l, adminId = null) {
  db.prepare("UPDATE listings SET status = 'published', reject_reason = NULL, updated_at = datetime('now') WHERE id = ?").run(l.id);
  notify(l.owner_id, `تم نشر إعلانك «${l.title}»`, l.id);
  for (const s of db.prepare('SELECT * FROM saved_searches WHERE user_id != ?').all(l.owner_id)) {
    if (matchesSavedSearch(l, s.query)) notify(s.user_id, `عقار جديد يطابق بحثك: ${l.title} في ${l.district}`, l.id);
  }
}

// ---------------------------------------------------------------- الجدولة: انتهاء التراخيص
function licenseSweep() {
  const warnDays = Number(getSetting('license_warning_days')) || 14;
  const expired = db.prepare("SELECT * FROM listings WHERE status IN ('published','paused','pending') AND license_expires < date('now')").all();
  for (const l of expired) {
    db.prepare("UPDATE listings SET status = 'expired' WHERE id = ?").run(l.id);
    notify(l.owner_id, `أُوقف إعلانك «${l.title}» لانتهاء الترخيص. جدّد الترخيص وحدّث التاريخ لإعادة نشره.`, l.id);
  }
  const soon = db.prepare(`SELECT * FROM listings WHERE status = 'published' AND license_expires BETWEEN date('now') AND date('now', ?)`).all(`+${warnDays} days`);
  for (const l of soon) {
    const text = `ينتهي ترخيص إعلانك «${l.title}» بتاريخ ${l.license_expires}`;
    const exists = db.prepare("SELECT 1 FROM notifications WHERE listing_id = ? AND text = ? AND created_at > datetime('now','-7 days')").get(l.id, text);
    if (!exists) notify(l.owner_id, text, l.id);
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
licenseSweep();
setInterval(licenseSweep, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------- المسارات
const routes = [];
const route = (method, pattern, access, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), access, handler });

// --- المصادقة
route('POST', '/api/auth/register', null, async (ctx) => {
  if (getSetting('allow_registration') !== '1') throw new HttpError(403, 'التسجيل مغلق حالياً');
  const b = await readJson(ctx.req);
  const phone = toLatin(str(b.phone, 20)); const name = str(b.name, 60); const password = String(b.password || '');
  if (!/^05\d{8}$/.test(phone)) throw bad('رقم الجوال يجب أن يكون بصيغة 05xxxxxxxx');
  if (name.length < 2) throw bad('الاسم مطلوب');
  if (password.length < 8) throw bad('كلمة السر 8 أحرف على الأقل');
  throttle('reg:' + ctx.ip, 20);
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw bad('الرقم مسجّل مسبقاً');
  const id = db.prepare('INSERT INTO users (phone, name, pass_hash) VALUES (?, ?, ?)').run(phone, name, hashPassword(password)).lastInsertRowid;
  const token = createSession(Number(id));
  ctx.json(201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) }, { 'Set-Cookie': cookieHeader(ctx.req, token, SESSION_DAYS * 86400) });
});
route('POST', '/api/auth/login', null, async (ctx) => {
  const b = await readJson(ctx.req);
  const phone = toLatin(str(b.phone, 20));
  throttle('login:' + ctx.ip + ':' + phone);
  const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u || !verifyPassword(String(b.password || ''), u.pass_hash)) throw new HttpError(401, 'الرقم أو كلمة السر غير صحيحة');
  if (u.banned) throw new HttpError(403, 'الحساب موقوف');
  const token = createSession(u.id);
  ctx.json(200, { user: publicUser(u) }, { 'Set-Cookie': cookieHeader(ctx.req, token, SESSION_DAYS * 86400) });
});
route('POST', '/api/auth/logout', null, async (ctx) => {
  const t = parseCookies(ctx.req).sid;
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  ctx.json(200, { ok: true }, { 'Set-Cookie': cookieHeader(ctx.req, '', 0) });
});
route('GET', '/api/me', null, async (ctx) => {
  const plan = ctx.user ? currentPlan(ctx.user.id) : null;
  const unread = ctx.user ? db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(ctx.user.id).n : 0;
  ctx.json(200, { user: publicUser(ctx.user), plan, unread });
});
route('POST', '/api/me/verify-request', 'user', async (ctx) => {
  db.prepare('UPDATE users SET verify_requested = 1 WHERE id = ?').run(ctx.user.id);
  ctx.json(200, { ok: true });
});
route('POST', '/api/me/password', 'user', async (ctx) => {
  const b = await readJson(ctx.req);
  if (!verifyPassword(String(b.old_password || ''), ctx.user.pass_hash)) throw bad('كلمة السر الحالية غير صحيحة');
  if (String(b.new_password || '').length < 8) throw bad('كلمة السر الجديدة 8 أحرف على الأقل');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(b.new_password)), ctx.user.id);
  ctx.json(200, { ok: true });
});
route('GET', '/api/notifications', 'user', async (ctx) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(ctx.user.id);
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(ctx.user.id);
  ctx.json(200, { notifications: rows });
});

// --- الإعلانات (عام)
route('GET', '/api/config', null, async (ctx) => {
  ctx.json(200, { max_video_mb: Number(getSetting('max_video_mb')), max_photos: Number(getSetting('max_photos')) });
});
route('GET', '/api/listings', null, async (ctx) => ctx.json(200, { listings: searchListings(ctx.query, ctx.user) }));
route('GET', '/api/listings/:id', null, async (ctx) => {
  const l = db.prepare(`SELECT l.* FROM listings l WHERE l.id = ? AND ${PUBLIC_WHERE}`).get(ctx.params.id);
  if (!l) throw new HttpError(404, 'الإعلان غير متاح');
  db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(l.id);
  ctx.json(200, { listing: serializeListing(l, ctx.user) });
});
route('POST', '/api/listings/:id/contact', null, async (ctx) => {
  const l = db.prepare(`SELECT l.* FROM listings l WHERE l.id = ? AND ${PUBLIC_WHERE}`).get(ctx.params.id);
  if (!l) throw new HttpError(404, 'الإعلان غير متاح');
  const b = await readJson(ctx.req);
  const channel = b.channel === 'call' ? 'call' : 'whatsapp';
  throttle('contact:' + ctx.ip, 60, 60 * 60 * 1000);
  db.prepare('INSERT INTO contacts (listing_id, user_id, channel) VALUES (?, ?, ?)').run(l.id, ctx.user ? ctx.user.id : null, channel);
  const owner = db.prepare('SELECT phone FROM users WHERE id = ?').get(l.owner_id);
  const intl = toIntlPhone(owner.phone);
  const text = getSetting('whatsapp_template').replace('{title}', l.title).replace('{district}', l.district).replace('{license}', l.license_no);
  ctx.json(200, { url: channel === 'call' ? `tel:+${intl}` : `https://wa.me/${intl}?text=${encodeURIComponent(text)}`, message: text });
});
route('POST', '/api/listings/:id/report', null, async (ctx) => {
  const b = await readJson(ctx.req);
  const reason = str(b.reason, 500);
  if (reason.length < 3) throw bad('اكتب سبب البلاغ');
  throttle('report:' + ctx.ip, 20, 60 * 60 * 1000);
  if (!db.prepare('SELECT 1 FROM listings WHERE id = ?').get(ctx.params.id)) throw new HttpError(404, 'الإعلان غير موجود');
  db.prepare('INSERT INTO reports (listing_id, user_id, reason) VALUES (?, ?, ?)').run(ctx.params.id, ctx.user ? ctx.user.id : null, reason);
  ctx.json(201, { ok: true });
});

// --- المحفوظات والبحث المحفوظ
route('GET', '/api/saves', 'user', async (ctx) => {
  const rows = db.prepare(`SELECT l.* FROM saves s JOIN listings l ON l.id = s.listing_id WHERE s.user_id = ? AND ${PUBLIC_WHERE} ORDER BY s.created_at DESC`).all(ctx.user.id);
  ctx.json(200, { listings: rows.map((l) => serializeListing(l, ctx.user)) });
});
route('POST', '/api/listings/:id/save', 'user', async (ctx) => {
  if (!db.prepare('SELECT 1 FROM listings WHERE id = ?').get(ctx.params.id)) throw new HttpError(404, 'غير موجود');
  db.prepare('INSERT OR IGNORE INTO saves (user_id, listing_id) VALUES (?, ?)').run(ctx.user.id, ctx.params.id);
  ctx.json(200, { saved: true });
});
route('DELETE', '/api/listings/:id/save', 'user', async (ctx) => {
  db.prepare('DELETE FROM saves WHERE user_id = ? AND listing_id = ?').run(ctx.user.id, ctx.params.id);
  ctx.json(200, { saved: false });
});
route('GET', '/api/searches', 'user', async (ctx) => {
  ctx.json(200, { searches: db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC').all(ctx.user.id) });
});
route('POST', '/api/searches', 'user', async (ctx) => {
  const b = await readJson(ctx.req);
  const q = {}; for (const k of ['kind', 'city', 'district', 'min', 'max', 'beds']) if (b[k]) q[k] = String(b[k]).slice(0, 60);
  if (!Object.keys(q).length) throw bad('اختر فلتراً واحداً على الأقل');
  if (db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').get(ctx.user.id).n >= 10) throw bad('الحد الأقصى 10 عمليات بحث محفوظة');
  db.prepare('INSERT INTO saved_searches (user_id, query) VALUES (?, ?)').run(ctx.user.id, JSON.stringify(q));
  ctx.json(201, { ok: true });
});
route('DELETE', '/api/searches/:id', 'user', async (ctx) => {
  db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(ctx.params.id, ctx.user.id);
  ctx.json(200, { ok: true });
});

// --- إعلانات المالك
route('GET', '/api/my/listings', 'user', async (ctx) => {
  const rows = db.prepare('SELECT * FROM listings WHERE owner_id = ? ORDER BY id DESC').all(ctx.user.id);
  ctx.json(200, { listings: rows.map((l) => serializeListing(l, ctx.user, { owner: true })) });
});
route('POST', '/api/listings', 'user', async (ctx) => {
  const v = validateListing(await readJson(ctx.req));
  const plan = currentPlan(ctx.user.id);
  const used = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE owner_id = ? AND status NOT IN ('rejected','expired')").get(ctx.user.id).n;
  if (plan && used >= plan.max_listings) throw new HttpError(403, `وصلت الحد الأقصى لباقتك (${plan.max_listings} إعلان). رقِّ باقتك لإضافة المزيد.`);
  const cols = Object.keys(v);
  const r = db.prepare(`INSERT INTO listings (owner_id, status, ${cols.join(', ')}) VALUES (?, 'draft', ${cols.map(() => '?').join(', ')})`).run(ctx.user.id, ...cols.map((c) => v[c]));
  ctx.json(201, { listing: serializeListing(db.prepare('SELECT * FROM listings WHERE id = ?').get(r.lastInsertRowid), ctx.user, { owner: true }) });
});
route('PUT', '/api/listings/:id', 'user', async (ctx) => {
  const l = ownerListing(ctx.user, ctx.params.id);
  const v = validateListing(await readJson(ctx.req), { partial: true });
  const cols = Object.keys(v);
  if (cols.length) {
    const sensitive = cols.some((c) => !['description', 'title'].includes(c));
    let status = l.status;
    if (l.status === 'published' && sensitive && getSetting('require_review') === '1' && ctx.user.role !== 'admin') status = 'pending';
    if (l.status === 'expired' && 'license_expires' in v) status = 'draft';
    if (l.status === 'rejected') status = 'draft';
    db.prepare(`UPDATE listings SET ${cols.map((c) => c + ' = ?').join(', ')}, status = ?, updated_at = datetime('now') WHERE id = ?`).run(...cols.map((c) => v[c]), status, l.id);
  }
  ctx.json(200, { listing: serializeListing(db.prepare('SELECT * FROM listings WHERE id = ?').get(l.id), ctx.user, { owner: true }) });
});
route('DELETE', '/api/listings/:id', 'user', async (ctx) => {
  const l = ownerListing(ctx.user, ctx.params.id);
  for (const m of db.prepare('SELECT file FROM media WHERE listing_id = ?').all(l.id)) fs.rm(path.join(UPLOAD_DIR, m.file), { force: true }, () => {});
  db.prepare('DELETE FROM listings WHERE id = ?').run(l.id);
  if (ctx.user.role === 'admin') audit(ctx.user.id, 'delete_listing', l.id);
  ctx.json(200, { ok: true });
});
route('POST', '/api/listings/:id/submit', 'user', async (ctx) => {
  const l = ownerListing(ctx.user, ctx.params.id);
  if (!['draft', 'rejected', 'paused'].includes(l.status)) throw bad('لا يمكن إرسال هذا الإعلان الآن');
  if (l.license_expires < today()) throw bad('ترخيص الإعلان منتهٍ');
  const n = db.prepare('SELECT COUNT(*) AS n FROM media WHERE listing_id = ?').get(l.id).n;
  if (n < 1) throw bad(l.media_type === 'video' ? 'ارفع فيديو للعقار أولاً' : 'ارفع صورة واحدة على الأقل');
  if (getSetting('require_review') === '1' && ctx.user.role !== 'admin') {
    db.prepare("UPDATE listings SET status = 'pending', reject_reason = NULL, updated_at = datetime('now') WHERE id = ?").run(l.id);
    ctx.json(200, { status: 'pending' });
  } else {
    publishListing(l);
    ctx.json(200, { status: 'published' });
  }
});
route('POST', '/api/listings/:id/pause', 'user', async (ctx) => {
  const l = ownerListing(ctx.user, ctx.params.id);
  if (l.status !== 'published') throw bad('الإعلان غير منشور');
  db.prepare("UPDATE listings SET status = 'paused' WHERE id = ?").run(l.id);
  ctx.json(200, { status: 'paused' });
});
route('POST', '/api/listings/:id/resume', 'user', async (ctx) => {
  const l = ownerListing(ctx.user, ctx.params.id);
  if (l.status !== 'paused') throw bad('الإعلان غير موقوف');
  if (l.license_expires < today()) throw bad('ترخيص الإعلان منتهٍ');
  db.prepare("UPDATE listings SET status = 'published' WHERE id = ?").run(l.id);
  ctx.json(200, { status: 'published' });
});

// --- رفع الوسائط
function magicOk(mime, buf) {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  if (mime === 'video/mp4' || mime === 'video/quicktime') return buf.slice(4, 8).toString() === 'ftyp';
  if (mime === 'video/webm') return buf.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}
route('POST', '/api/listings/:id/media', 'user', async (ctx) => {
  const l = ownerListing(ctx.user, ctx.params.id);
  if (!/^multipart\/form-data/i.test(ctx.req.headers['content-type'] || '')) throw bad('أرسل الملفات بصيغة multipart');
  const maxVideo = Number(getSetting('max_video_mb')) * 1024 * 1024;
  const maxPhotos = Number(getSetting('max_photos'));
  const body = await readBody(ctx.req, Math.max(maxVideo, 8 * 1024 * 1024 * maxPhotos) + 1024 * 1024);
  const { files } = parseMultipart(body, ctx.req.headers['content-type']);
  if (!files.length) throw bad('لم يصل أي ملف');
  const existing = db.prepare('SELECT COUNT(*) AS n FROM media WHERE listing_id = ?').get(l.id).n;
  const added = [];
  for (const f of files) {
    const ext = UPLOAD_TYPES[f.mime];
    if (!ext) throw bad('نوع الملف غير مسموح: ' + f.mime);
    const isVideo = f.mime.startsWith('video/');
    if (l.media_type === 'video' && !isVideo) throw bad('هذا الإعلان فيديو، ارفع فيديو فقط');
    if (l.media_type === 'photos' && isVideo) throw bad('هذا الإعلان صور، ارفع صوراً فقط');
    if (isVideo && f.data.length > maxVideo) throw bad(`الفيديو أكبر من ${getSetting('max_video_mb')} ميغابايت`);
    if (!isVideo && f.data.length > 8 * 1024 * 1024) throw bad('الصورة أكبر من 8 ميغابايت');
    if (!magicOk(f.mime, f.data)) throw bad('محتوى الملف لا يطابق نوعه');
    added.push({ f, ext });
  }
  if (l.media_type === 'video' && existing + added.length > 1) throw bad('الإعلان بالفيديو يقبل فيديو واحداً. احذف القديم أولاً');
  if (l.media_type === 'photos' && existing + added.length > maxPhotos) throw bad(`الحد الأقصى ${maxPhotos} صورة`);
  let pos = existing;
  for (const { f, ext } of added) {
    const file = crypto.randomBytes(16).toString('hex') + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), f.data);
    db.prepare('INSERT INTO media (listing_id, file, mime, position) VALUES (?, ?, ?, ?)').run(l.id, file, f.mime, pos++);
  }
  ctx.json(201, { media: mediaFor(l.id) });
});
route('DELETE', '/api/media/:id', 'user', async (ctx) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(ctx.params.id);
  if (!m) throw new HttpError(404, 'غير موجود');
  ownerListing(ctx.user, m.listing_id);
  fs.rm(path.join(UPLOAD_DIR, m.file), { force: true }, () => {});
  db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  ctx.json(200, { ok: true });
});
route('GET', '/api/plans', null, async (ctx) => ctx.json(200, { plans: db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY id').all() }));

// --- لوحة المدير
route('GET', '/api/admin/stats', 'admin', async (ctx) => {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM listings GROUP BY status').all().map((r) => [r.status, r.n]));
  ctx.json(200, {
    users: n('SELECT COUNT(*) AS n FROM users'),
    verified_owners: n('SELECT COUNT(*) AS n FROM users WHERE verified = 1'),
    verify_requests: n('SELECT COUNT(*) AS n FROM users WHERE verify_requested = 1 AND verified = 0'),
    listings: byStatus,
    views: n('SELECT COALESCE(SUM(views),0) AS n FROM listings'),
    contacts_30d: n("SELECT COUNT(*) AS n FROM contacts WHERE created_at > datetime('now','-30 days')"),
    open_reports: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    expiring_14d: n("SELECT COUNT(*) AS n FROM listings WHERE status = 'published' AND license_expires BETWEEN date('now') AND date('now','+14 days')"),
    top_districts: db.prepare("SELECT district, city, COUNT(*) AS n FROM listings WHERE status = 'published' GROUP BY district, city ORDER BY n DESC LIMIT 5").all(),
    new_users_7d: n("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now','-7 days')")
  });
});
route('GET', '/api/admin/listings', 'admin', async (ctx) => {
  const status = ctx.query.status;
  const rows = status
    ? db.prepare('SELECT * FROM listings WHERE status = ? ORDER BY updated_at DESC LIMIT 200').all(status)
    : db.prepare("SELECT * FROM listings WHERE status != 'draft' ORDER BY updated_at DESC LIMIT 200").all();
  ctx.json(200, { listings: rows.map((l) => ({ ...serializeListing(l, ctx.user, { owner: true }), owner_id: l.owner_id, owner_phone: db.prepare('SELECT phone FROM users WHERE id = ?').get(l.owner_id)?.phone })) });
});
route('POST', '/api/admin/listings/:id/approve', 'admin', async (ctx) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(ctx.params.id);
  if (!l) throw new HttpError(404, 'غير موجود');
  if (l.license_expires < today()) throw bad('ترخيص الإعلان منتهٍ');
  publishListing(l); audit(ctx.user.id, 'approve_listing', l.id);
  ctx.json(200, { ok: true });
});
route('POST', '/api/admin/listings/:id/reject', 'admin', async (ctx) => {
  const b = await readJson(ctx.req);
  const reason = str(b.reason, 300) || 'لم يستوفِ الشروط';
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(ctx.params.id);
  if (!l) throw new HttpError(404, 'غير موجود');
  db.prepare("UPDATE listings SET status = 'rejected', reject_reason = ? WHERE id = ?").run(reason, l.id);
  notify(l.owner_id, `رُفض إعلانك «${l.title}»: ${reason}`, l.id);
  audit(ctx.user.id, 'reject_listing', l.id);
  ctx.json(200, { ok: true });
});
route('POST', '/api/admin/listings/:id/takedown', 'admin', async (ctx) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(ctx.params.id);
  if (!l) throw new HttpError(404, 'غير موجود');
  db.prepare("UPDATE listings SET status = 'paused' WHERE id = ?").run(l.id);
  notify(l.owner_id, `أوقفت الإدارة إعلانك «${l.title}»`, l.id);
  audit(ctx.user.id, 'takedown_listing', l.id);
  ctx.json(200, { ok: true });
});
route('POST', '/api/admin/listings/:id/feature', 'admin', async (ctx) => {
  const b = await readJson(ctx.req);
  const days = Math.min(Math.max(intOrNull(b.days) || 0, 0), 365);
  const until = days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null;
  db.prepare('UPDATE listings SET featured_until = ? WHERE id = ?').run(until, ctx.params.id);
  audit(ctx.user.id, 'feature_listing', `${ctx.params.id}:${days}d`);
  ctx.json(200, { featured_until: until });
});
route('GET', '/api/admin/users', 'admin', async (ctx) => {
  const rows = db.prepare(`SELECT u.id, u.name, u.phone, u.role, u.verified, u.verify_requested, u.banned, u.created_at,
    (SELECT COUNT(*) FROM listings WHERE owner_id = u.id) AS listings_count FROM users u ORDER BY u.id DESC LIMIT 300`).all();
  ctx.json(200, { users: rows });
});
route('POST', '/api/admin/users/:id/:action', 'admin', async (ctx) => {
  const id = Number(ctx.params.id); const a = ctx.params.action;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'غير موجود');
  if (u.id === ctx.user.id && ['ban', 'demote'].includes(a)) throw bad('لا يمكنك تنفيذ ذلك على حسابك');
  const set = { ban: ['banned = 1'], unban: ['banned = 0'], verify: ['verified = 1, verify_requested = 0'], unverify: ['verified = 0'], promote: ["role = 'admin'"], demote: ["role = 'user'"] }[a];
  if (!set) throw bad('إجراء غير معروف');
  db.prepare(`UPDATE users SET ${set[0]} WHERE id = ?`).run(id);
  if (a === 'ban') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  if (a === 'verify') notify(id, 'تم توثيق حسابك كمالك موثّق');
  audit(ctx.user.id, a + '_user', id);
  ctx.json(200, { ok: true });
});
route('GET', '/api/admin/reports', 'admin', async (ctx) => {
  const rows = db.prepare(`SELECT r.*, l.title FROM reports r JOIN listings l ON l.id = r.listing_id ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 200`).all();
  ctx.json(200, { reports: rows });
});
route('POST', '/api/admin/reports/:id/close', 'admin', async (ctx) => {
  db.prepare("UPDATE reports SET status = 'closed' WHERE id = ?").run(ctx.params.id);
  audit(ctx.user.id, 'close_report', ctx.params.id);
  ctx.json(200, { ok: true });
});
route('GET', '/api/admin/plans', 'admin', async (ctx) => ctx.json(200, { plans: db.prepare('SELECT * FROM plans ORDER BY id').all() }));
route('POST', '/api/admin/plans', 'admin', async (ctx) => {
  const b = await readJson(ctx.req);
  const name = str(b.name, 60); if (!name) throw bad('اسم الباقة مطلوب');
  const r = db.prepare('INSERT INTO plans (name, price_sar, max_listings, featured_days, active) VALUES (?, ?, ?, ?, ?)')
    .run(name, Math.max(intOrNull(b.price_sar) || 0, 0), Math.max(intOrNull(b.max_listings) || 1, 1), Math.max(intOrNull(b.featured_days) || 0, 0), b.active === false ? 0 : 1);
  audit(ctx.user.id, 'create_plan', r.lastInsertRowid);
  ctx.json(201, { id: Number(r.lastInsertRowid) });
});
route('PUT', '/api/admin/plans/:id', 'admin', async (ctx) => {
  const b = await readJson(ctx.req);
  const p = db.prepare('SELECT * FROM plans WHERE id = ?').get(ctx.params.id);
  if (!p) throw new HttpError(404, 'غير موجود');
  db.prepare('UPDATE plans SET name = ?, price_sar = ?, max_listings = ?, featured_days = ?, active = ? WHERE id = ?').run(
    str(b.name, 60) || p.name, b.price_sar != null ? Math.max(intOrNull(b.price_sar) || 0, 0) : p.price_sar,
    b.max_listings != null ? Math.max(intOrNull(b.max_listings) || 1, 1) : p.max_listings,
    b.featured_days != null ? Math.max(intOrNull(b.featured_days) || 0, 0) : p.featured_days,
    b.active == null ? p.active : (b.active ? 1 : 0), p.id);
  audit(ctx.user.id, 'update_plan', p.id);
  ctx.json(200, { ok: true });
});
route('GET', '/api/admin/subscriptions', 'admin', async (ctx) => {
  ctx.json(200, { subscriptions: db.prepare(`SELECT s.*, u.name AS user_name, u.phone, p.name AS plan_name FROM subscriptions s
    JOIN users u ON u.id = s.user_id JOIN plans p ON p.id = s.plan_id ORDER BY s.id DESC LIMIT 200`).all() });
});
route('POST', '/api/admin/subscriptions', 'admin', async (ctx) => {
  const b = await readJson(ctx.req);
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(toLatin(str(b.phone, 20)));
  const plan = db.prepare('SELECT id FROM plans WHERE id = ?').get(intOrNull(b.plan_id));
  if (!user || !plan) throw bad('الجوال أو الباقة غير صحيحين');
  const days = Math.min(Math.max(intOrNull(b.days) || 30, 1), 3650);
  const ends = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  db.prepare('INSERT INTO subscriptions (user_id, plan_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?, ?)').run(user.id, plan.id, today(), ends, str(b.note, 200));
  notify(user.id, 'تم تفعيل باقتك حتى ' + ends);
  audit(ctx.user.id, 'assign_subscription', `${user.id}:${plan.id}:${days}d`);
  ctx.json(201, { ends_at: ends });
});
route('GET', '/api/admin/settings', 'admin', async (ctx) => {
  ctx.json(200, { settings: Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])) });
});
route('PUT', '/api/admin/settings', 'admin', async (ctx) => {
  const b = await readJson(ctx.req);
  const allowed = { require_review: /^[01]$/, license_warning_days: /^\d{1,3}$/, allow_registration: /^[01]$/, max_video_mb: /^\d{1,3}$/, max_photos: /^\d{1,2}$/, whatsapp_template: /^[\s\S]{5,400}$/ };
  for (const [k, v] of Object.entries(b)) {
    if (!allowed[k]) continue;
    if (!allowed[k].test(String(v))) throw bad('قيمة غير صحيحة: ' + k);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  }
  audit(ctx.user.id, 'update_settings', Object.keys(b).join(','));
  ctx.json(200, { ok: true });
});
route('GET', '/api/admin/audit', 'admin', async (ctx) => {
  ctx.json(200, { log: db.prepare('SELECT a.*, u.name AS admin_name FROM audit_log a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 200').all() });
});

// ---------------------------------------------------------------- الخادم
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com; media-src 'self' blob:; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; connect-src 'self'; frame-ancestors 'none'"
};

function serveFile(res, root, rel, extra = {}) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) && file !== root) return send(res, 403, 'ممنوع');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'غير موجود');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, ...SEC_HEADERS, ...extra });
    fs.createReadStream(file).pipe(res);
  });
}
function serveUpload(req, res, rel) {
  const file = path.normalize(path.join(UPLOAD_DIR, rel));
  if (!file.startsWith(UPLOAD_DIR + path.sep)) return send(res, 403, 'ممنوع');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'غير موجود');
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type || type.startsWith('text/')) return send(res, 403, 'ممنوع');
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      end = Math.min(end, st.size - 1);
      if (!(start >= 0) || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (url.pathname.startsWith('/api/')) {
      // حماية CSRF: كل طلب غير GET يجب أن يحمل ترويسة مخصصة (تمنع الإرسال من مواقع أخرى)
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'طلب غير مسموح');
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'المسار غير موجود');
      const user = currentUser(req);
      if (r.access && !user) throw new HttpError(401, 'سجّل الدخول أولاً');
      if (r.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'للمدير فقط');
      const ctx = {
        req, ip, user, query: Object.fromEntries(url.searchParams), params: r.re.exec(url.pathname).groups || {},
        json: (status, obj, headers) => json(res, status, obj, { ...SEC_HEADERS, ...headers })
      };
      return await r.handler(ctx);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'غير مسموح');
    if (url.pathname.startsWith('/uploads/')) return serveUpload(req, res, decodeURIComponent(url.pathname.slice(9)));
    if (url.pathname === '/admin' || url.pathname === '/admin/') return serveFile(res, PUBLIC_DIR, 'admin.html', { 'Cache-Control': 'no-store' });
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    return serveFile(res, PUBLIC_DIR, rel, { 'Cache-Control': 'no-cache' });
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    console.error(e);
    return json(res, 500, { error: 'خطأ في الخادم' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`الخادم يعمل على http://localhost:${PORT}  (لوحة التحكم: /admin)`);
    if (firstAdminInfo) {
      console.log('— تم إنشاء حساب المدير الأول —');
      console.log('الجوال:', firstAdminInfo.phone);
      console.log(process.env.ADMIN_PASSWORD ? 'كلمة السر: من ADMIN_PASSWORD' : 'كلمة السر محفوظة في data/FIRST_ADMIN.txt');
    }
  });
}
module.exports = { server };
