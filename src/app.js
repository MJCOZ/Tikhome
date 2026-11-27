'use strict';
// واجهة API لتطبيق Tikhome. تعمل كدالة على Vercel وكخادم محلي (server.js).
const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./db');

const SESSION_DAYS = 30;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const MAX_PHOTO_MB = 8;
const MAX_POSTER_BYTES = 1024 * 1024;
const POSTER_MIME = ['image/jpeg', 'image/png', 'image/webp'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

const toLatin = (s) => String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const intOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
const today = () => new Date().toISOString().slice(0, 10);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const toIntlPhone = (phone) => '966' + String(phone).replace(/^0/, '');

function magicOk(mime, buf) {
  if (!buf || buf.length < 12) return false;
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/webp') return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'video/mp4') return buf.subarray(4, 8).toString() === 'ftyp';
  if (mime === 'video/quicktime') return ['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip'].includes(buf.subarray(4, 8).toString());
  if (mime === 'video/webm') return buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

// شرح عربي لأشهر أخطاء الاتصال بقاعدة البيانات (لا يتضمن الرابط أو كلمة السر)
function describeDbError(e) {
  const code = e && (e.code || e.errno) ? String(e.code || e.errno) : '';
  const msg = String((e && e.message) || e || '');
  const hint =
    code === '28P01' || /password authentication failed/i.test(msg) ? 'كلمة السر في DATABASE_URL غير صحيحة'
      : /Tenant or user not found/i.test(msg) ? 'اسم المستخدم في DATABASE_URL يجب أن يكون postgres.<رمز المشروع> (رابط Shared pooler)'
        : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'عنوان الخادم في DATABASE_URL غير صحيح'
          : code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ? 'تعذّر الوصول للخادم: استخدم رابط Transaction pooler بالمنفذ 6543 وليس الاتصال المباشر'
            : /Invalid URL|ERR_INVALID_URL/i.test(msg + code) ? 'الرابط غير صالح: تأكد من استبدال [YOUR-DATABASE-PASSWORD] وعدم وجود رموز خاصة في كلمة السر'
              : 'خطأ غير متوقع في قاعدة البيانات';
  return { error: hint, code: code || undefined, detail: msg.replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 200) };
}

function createApp({ db, storage, moyasar = null }) {
  moyasar = moyasar || require('./moyasar').createMoyasar();
  // ------------------------------------------------------------ أدوات
  const audit = (adminId, action, target) => db.run('INSERT INTO audit_log (admin_id, action, target) VALUES (?, ?, ?)', adminId, action, String(target ?? ''));
  const notify = (userId, text, listingId = null) => db.run('INSERT INTO notifications (user_id, text, listing_id) VALUES (?, ?, ?)', userId, text, listingId);

  async function throttle(key, max = 10, windowMs = 15 * 60 * 1000) {
    const n = await db.n('SELECT COUNT(*) FROM rate_hits WHERE key = ? AND at > now() - make_interval(secs => ?)', key, windowMs / 1000);
    if (n >= max) throw new HttpError(429, 'محاولات كثيرة، حاول لاحقاً');
    await db.run('INSERT INTO rate_hits (key) VALUES (?)', key);
  }

  // ------------------------------------------------------------ الجلسات (كوكي للويب، Bearer للجوال)
  function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* */ } }
    }
    return out;
  }
  const tokenOf = (req) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    return m ? m[1] : parseCookies(req).sid;
  };
  function cookieHeader(req, token, maxAge) {
    const secure = process.env.COOKIE_SECURE === '1' || process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
    return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  async function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, new Date(Date.now() + SESSION_DAYS * 864e5));
    return token;
  }
  async function currentUser(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const row = await db.one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > now()', sha(token));
    if (!row || row.banned) return null;
    return row;
  }
  const publicUser = (u) => u && ({ id: u.id, name: u.name, phone: u.phone, role: u.role, verified: !!u.verified, verify_requested: !!u.verify_requested });
  // الجوال يطلب التوكن صراحةً؛ الويب يكتفي بالكوكي HttpOnly
  const authResponse = async (ctx, status, user) => {
    const token = await createSession(user.id);
    const body = { user: publicUser(user) };
    if (ctx.req.headers['x-client'] === 'mobile') body.token = token;
    ctx.json(status, body, { 'Set-Cookie': cookieHeader(ctx.req, token, SESSION_DAYS * 86400) });
  };

  // ------------------------------------------------------------ الإعلانات
  const PUBLIC_WHERE = "l.status = 'published' AND l.license_expires >= CURRENT_DATE";

  // تجهيز مجموعة إعلانات بعدد ثابت من الاستعلامات (بدل استعلام لكل إعلان)
  async function serializeMany(rows, user, { owner = false } = {}) {
    if (!rows.length) return [];
    const ids = rows.map((l) => l.id);
    const ownerIds = [...new Set(rows.map((l) => l.owner_id))];
    const [owners, media, saves, contacts] = await Promise.all([
      db.all('SELECT id, name, verified FROM users WHERE id = ANY(?)', ownerIds),
      db.all('SELECT id, listing_id, file, mime, poster FROM media WHERE listing_id = ANY(?) ORDER BY position, id', ids),
      user ? db.all('SELECT listing_id FROM saves WHERE user_id = ? AND listing_id = ANY(?)', user.id, ids) : [],
      owner ? db.all('SELECT listing_id, COUNT(*)::int AS n FROM contacts WHERE listing_id = ANY(?) GROUP BY listing_id', ids) : []
    ]);
    const ownerMap = new Map(owners.map((o) => [o.id, o]));
    const savedSet = new Set(saves.map((s) => s.listing_id));
    const contactMap = new Map(contacts.map((c) => [c.listing_id, c.n]));
    const mediaMap = new Map();
    for (const m of media) {
      if (!mediaMap.has(m.listing_id)) mediaMap.set(m.listing_id, []);
      mediaMap.get(m.listing_id).push({ id: m.id, url: storage.publicUrl(m.file), mime: m.mime, poster: m.poster ? storage.publicUrl(m.poster) : null });
    }
    const t = today();
    return rows.map((l) => {
      const o = ownerMap.get(l.owner_id) || {};
      const out = {
        id: l.id, kind: l.kind, property_type: l.property_type, title: l.title, city: l.city, district: l.district,
        price: l.price, area: l.area, beds: l.beds, baths: l.baths, floor: l.floor, entrance: l.entrance,
        description: l.description, lat: l.lat, lng: l.lng, media_type: l.media_type,
        license_no: l.license_no, license_expires: l.license_expires, status: l.status,
        featured: !!(l.featured_until && l.featured_until >= t),
        media: mediaMap.get(l.id) || [], owner_name: o.name, owner_verified: !!o.verified, created_at: l.created_at,
        saved: savedSet.has(l.id)
      };
      if (owner) {
        out.reject_reason = l.reject_reason; out.views = l.views; out.featured_until = l.featured_until;
        out.contacts = contactMap.get(l.id) || 0;
      }
      return out;
    });
  }
  const serializeOne = async (l, user, opts) => (await serializeMany([l], user, opts))[0];

  function validateListing(b, { partial = false } = {}) {
    const v = {};
    const need = (k, cond, msg) => { if (!partial || k in b) { if (!cond) throw bad(msg); } };
    if (!partial || 'kind' in b) { need('kind', ['rent', 'sale'].includes(b.kind), 'نوع العرض: إيجار أو بيع'); v.kind = b.kind; }
    if (!partial || 'title' in b) { v.title = str(b.title, 120); need('title', v.title.length >= 3, 'العنوان قصير'); }
    if (!partial || 'city' in b) { v.city = str(b.city, 60); need('city', v.city, 'المدينة مطلوبة'); }
    if (!partial || 'district' in b) { v.district = str(b.district, 60); need('district', v.district, 'الحي مطلوب'); }
    if (!partial || 'price' in b) { v.price = intOrNull(toLatin(b.price)); need('price', v.price > 0 && v.price < 1e10, 'السعر غير صحيح'); }
    if ('property_type' in b) v.property_type = ['apartment', 'villa', 'floor', 'land', 'office', 'shop'].includes(b.property_type) ? b.property_type : 'apartment';
    for (const k of ['area', 'beds', 'baths']) if (k in b) { const n = intOrNull(toLatin(b[k])); if (n != null && (n < 0 || n > 100000)) throw bad('قيمة غير صحيحة: ' + k); v[k] = n; }
    if ('floor' in b) { const n = intOrNull(b.floor); if (n != null && (n < 0 || n > 100)) throw bad('رقم الدور غير صحيح'); v.floor = n; }
    if ('entrance' in b) { if (b.entrance && !['private', 'shared'].includes(b.entrance)) throw bad('نوع المدخل غير صحيح'); v.entrance = b.entrance || null; }
    if ('description' in b) v.description = str(b.description, 2000);
    for (const k of ['lat', 'lng']) if (k in b) {
      const n = b[k] === '' || b[k] == null ? null : Number(b[k]);
      if (n != null && (Number.isNaN(n) || Math.abs(n) > 180)) throw bad('الإحداثيات غير صحيحة');
      v[k] = n;
    }
    if (!partial || 'media_type' in b) { need('media_type', ['video', 'photos'].includes(b.media_type), 'نوع المحتوى: فيديو أو صور'); v.media_type = b.media_type; }
    if (!partial || 'license_no' in b) { v.license_no = str(toLatin(b.license_no), 40); need('license_no', v.license_no.length >= 3, 'رقم ترخيص الإعلان مطلوب'); }
    if (!partial || 'license_expires' in b) {
      v.license_expires = str(toLatin(b.license_expires), 10);
      need('license_expires', /^\d{4}-\d{2}-\d{2}$/.test(v.license_expires) && v.license_expires >= today(), 'تاريخ انتهاء الترخيص غير صحيح أو منتهٍ');
    }
    return v;
  }

  async function currentPlan(userId) {
    const sub = await db.one(`SELECT p.* FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                              WHERE s.user_id = ? AND s.ends_at >= CURRENT_DATE ORDER BY p.max_listings DESC LIMIT 1`, userId);
    return sub || db.one('SELECT * FROM plans WHERE active ORDER BY id LIMIT 1');
  }

  async function ownerListing(user, id) {
    const l = await db.one('SELECT * FROM listings WHERE id = ?', intOrNull(id));
    if (!l) throw new HttpError(404, 'الإعلان غير موجود');
    if (l.owner_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'ليس إعلانك');
    return l;
  }

  async function searchListings(q, user) {
    const where = [PUBLIC_WHERE]; const args = [];
    if (q.kind === 'rent' || q.kind === 'sale') { where.push('l.kind = ?'); args.push(q.kind); }
    if (q.city) { where.push('l.city = ?'); args.push(String(q.city).slice(0, 60)); }
    if (q.district) { where.push('l.district = ?'); args.push(String(q.district).slice(0, 60)); }
    if (q.q) { where.push('(l.title ILIKE ? OR l.district ILIKE ? OR l.description ILIKE ?)'); const p = `%${String(q.q).slice(0, 50).replace(/[%_\\]/g, '\\$&')}%`; args.push(p, p, p); }
    if (intOrNull(q.min) != null) { where.push('l.price >= ?'); args.push(intOrNull(q.min)); }
    if (intOrNull(q.max) != null) { where.push('l.price <= ?'); args.push(intOrNull(q.max)); }
    if (intOrNull(q.beds) != null) { where.push('l.beds >= ?'); args.push(intOrNull(q.beds)); }
    if (intOrNull(q.floor) != null) { where.push('l.floor = ?'); args.push(intOrNull(q.floor)); }
    if (q.entrance === 'private' || q.entrance === 'shared') { where.push('l.entrance = ?'); args.push(q.entrance); }
    if (q.media === 'video' || q.media === 'photos') { where.push('l.media_type = ?'); args.push(q.media); }
    if (q.property_type) { where.push('l.property_type = ?'); args.push(String(q.property_type)); }
    if (q.bbox) {
      const [s, w, n, e] = String(q.bbox).split(',').map(Number);
      if ([s, w, n, e].every(Number.isFinite)) { where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?'); args.push(s, n, w, e); }
    }
    // يُخفى الإعلان الذي لا يحتوي وسائط
    where.push('EXISTS (SELECT 1 FROM media m WHERE m.listing_id = l.id)');
    const order = q.sort === 'price_asc' ? 'l.price ASC' : q.sort === 'price_desc' ? 'l.price DESC'
      : 'COALESCE(l.featured_until >= CURRENT_DATE, FALSE) DESC, l.created_at DESC, l.id DESC';
    const limit = Math.min(Math.max(intOrNull(q.limit) || 20, 1), 50);
    const offset = Math.max(intOrNull(q.offset) || 0, 0);
    const rows = await db.all(`SELECT l.* FROM listings l WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, limit, offset);
    return serializeMany(rows, user);
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
  async function publishListing(l) {
    await db.run("UPDATE listings SET status = 'published', reject_reason = NULL, updated_at = now() WHERE id = ?", l.id);
    await notify(l.owner_id, `تم نشر إعلانك «${l.title}»`, l.id);
    for (const s of await db.all('SELECT * FROM saved_searches WHERE user_id != ?', l.owner_id)) {
      if (matchesSavedSearch(l, s.query)) await notify(s.user_id, `عقار جديد يطابق بحثك: ${l.title} في ${l.district}`, l.id);
    }
  }
  const mediaCount = (id) => db.n('SELECT COUNT(*) FROM media WHERE listing_id = ?', id);

  // ------------------------------------------------------------ المهمة اليومية: انتهاء التراخيص (Vercel Cron)
  async function licenseSweep() {
    const warnDays = Number(await db.getSetting('license_warning_days')) || 14;
    const expired = await db.all("UPDATE listings SET status = 'expired' WHERE status IN ('published','paused','pending') AND license_expires < CURRENT_DATE RETURNING *");
    for (const l of expired) await notify(l.owner_id, `أُوقف إعلانك «${l.title}» لانتهاء الترخيص. جدّد الترخيص وحدّث التاريخ لإعادة نشره.`, l.id);
    const soon = await db.all("SELECT * FROM listings WHERE status = 'published' AND license_expires BETWEEN CURRENT_DATE AND CURRENT_DATE + ?::int", warnDays);
    for (const l of soon) {
      const text = `ينتهي ترخيص إعلانك «${l.title}» بتاريخ ${l.license_expires}`;
      const exists = await db.one("SELECT 1 FROM notifications WHERE listing_id = ? AND text = ? AND created_at > now() - interval '7 days'", l.id, text);
      if (!exists) await notify(l.owner_id, text, l.id);
    }
    await db.run('DELETE FROM sessions WHERE expires_at < now()');
    await db.run("DELETE FROM rate_hits WHERE at < now() - interval '1 day'");
    // مدفوعات لم يرجع أصحابها من صفحة الدفع
    for (const p of await db.all("SELECT * FROM payments WHERE status = 'initiated' AND provider_id IS NOT NULL AND created_at < now() - interval '10 minutes' AND created_at > now() - interval '3 days'")) {
      try { await verifyPayment(p); } catch (e) { console.error(e); }
    }
    await db.run("UPDATE payments SET status = 'expired' WHERE status = 'initiated' AND created_at < now() - interval '3 days'");
    return { expired: expired.length, warned: soon.length };
  }

  // ------------------------------------------------------------ المسارات
  const routes = [];
  const route = (method, pattern, access, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), access, handler });

  // --- المصادقة
  route('POST', '/api/auth/register', null, async (ctx) => {
    if ((await db.getSetting('allow_registration')) !== '1') throw new HttpError(403, 'التسجيل مغلق حالياً');
    const b = ctx.body;
    const phone = toLatin(str(b.phone, 20)); const name = str(b.name, 60); const password = String(b.password || '');
    if (!/^05\d{8}$/.test(phone)) throw bad('رقم الجوال يجب أن يكون بصيغة 05xxxxxxxx');
    if (name.length < 2) throw bad('الاسم مطلوب');
    if (password.length < 8) throw bad('كلمة السر 8 أحرف على الأقل');
    await throttle('reg:' + ctx.ip, 20, 60 * 60 * 1000);
    const u = await db.one('INSERT INTO users (phone, name, pass_hash) VALUES (?, ?, ?) ON CONFLICT (phone) DO NOTHING RETURNING *', phone, name, hashPassword(password));
    if (!u) throw bad('الرقم مسجّل مسبقاً');
    await authResponse(ctx, 201, u);
  });
  route('POST', '/api/auth/login', null, async (ctx) => {
    const b = ctx.body;
    const phone = toLatin(str(b.phone, 20));
    await throttle('login:' + ctx.ip + ':' + phone);
    await throttle('login-phone:' + phone, 30, 60 * 60 * 1000);
    const u = await db.one('SELECT * FROM users WHERE phone = ?', phone);
    if (!u || !verifyPassword(String(b.password || ''), u.pass_hash)) throw new HttpError(401, 'الرقم أو كلمة السر غير صحيحة');
    if (u.banned) throw new HttpError(403, 'الحساب موقوف');
    await authResponse(ctx, 200, u);
  });
  route('POST', '/api/auth/logout', null, async (ctx) => {
    const t = tokenOf(ctx.req);
    if (t) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha(t));
    ctx.json(200, { ok: true }, { 'Set-Cookie': cookieHeader(ctx.req, '', 0) });
  });
  // --- استعادة كلمة السر: المستخدم يتواصل مع الدعم، والمدير يصدر رمزاً مؤقتاً من لوحة التحكم
  const RESET_MINUTES = 30;
  route('GET', '/api/auth/support', null, async (ctx) => {
    const n = toLatin(await db.getSetting('support_whatsapp') || '').replace(/\D/g, '');
    ctx.json(200, { whatsapp: n ? (n.startsWith('0') ? toIntlPhone(n) : n) : null });
  });
  route('POST', '/api/auth/reset', null, async (ctx) => {
    const b = ctx.body;
    const phone = toLatin(str(b.phone, 20)); const code = toLatin(str(b.code, 10)); const pw = String(b.new_password || '');
    if (!/^05\d{8}$/.test(phone)) throw bad('رقم الجوال يجب أن يكون بصيغة 05xxxxxxxx');
    if (!/^\d{6}$/.test(code)) throw bad('الرمز من 6 أرقام');
    if (pw.length < 8) throw bad('كلمة السر الجديدة 8 أحرف على الأقل');
    await throttle('reset:' + ctx.ip, 20, 60 * 60 * 1000);
    await throttle('reset-phone:' + phone, 10, 60 * 60 * 1000);
    const invalid = new HttpError(400, 'الرمز غير صحيح أو منتهي الصلاحية');
    const u = await db.one('SELECT * FROM users WHERE phone = ?', phone);
    if (!u) throw invalid;
    const r = await db.one('SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1', u.id);
    if (!r || r.attempts >= 5) throw invalid;
    const a = Buffer.from(sha(code + ':' + u.id)); const e = Buffer.from(r.code_hash);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) {
      await db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', r.id);
      throw invalid;
    }
    if (u.banned) throw new HttpError(403, 'الحساب موقوف');
    await db.run('UPDATE password_resets SET used_at = now() WHERE id = ?', r.id);
    await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(pw), u.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await notify(u.id, 'تم تغيير كلمة السر باستخدام رمز الاستعادة');
    await authResponse(ctx, 200, u);
  });
  route('GET', '/api/me', null, async (ctx) => {
    const plan = ctx.user ? await currentPlan(ctx.user.id) : null;
    const unread = ctx.user ? await db.n('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND NOT read', ctx.user.id) : 0;
    ctx.json(200, { user: publicUser(ctx.user), plan, unread });
  });
  route('POST', '/api/me/verify-request', 'user', async (ctx) => {
    await db.run('UPDATE users SET verify_requested = TRUE WHERE id = ?', ctx.user.id);
    ctx.json(200, { ok: true });
  });
  route('POST', '/api/me/password', 'user', async (ctx) => {
    const b = ctx.body;
    if (!verifyPassword(String(b.old_password || ''), ctx.user.pass_hash)) throw bad('كلمة السر الحالية غير صحيحة');
    if (String(b.new_password || '').length < 8) throw bad('كلمة السر الجديدة 8 أحرف على الأقل');
    await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(String(b.new_password)), ctx.user.id);
    // إنهاء الجلسات الأخرى بعد تغيير كلمة السر
    const t = tokenOf(ctx.req);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', ctx.user.id, sha(t || ''));
    ctx.json(200, { ok: true });
  });
  route('GET', '/api/notifications', 'user', async (ctx) => {
    const rows = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', ctx.user.id);
    await db.run('UPDATE notifications SET read = TRUE WHERE user_id = ? AND NOT read', ctx.user.id);
    ctx.json(200, { notifications: rows });
  });

  // --- الإعلانات (عام)
  route('GET', '/api/config', null, async (ctx) => {
    const s = await db.settings();
    ctx.json(200, { max_video_mb: Number(s.max_video_mb), max_photos: Number(s.max_photos), max_photo_mb: MAX_PHOTO_MB, payments: moyasar.enabled });
  });
  route('GET', '/api/listings', null, async (ctx) => ctx.json(200, { listings: await searchListings(ctx.query, ctx.user) }));
  route('GET', '/api/listings/:id', null, async (ctx) => {
    const l = await db.one(`UPDATE listings l SET views = views + 1 WHERE l.id = ? AND ${PUBLIC_WHERE} RETURNING l.*`, intOrNull(ctx.params.id));
    if (!l) throw new HttpError(404, 'الإعلان غير متاح');
    ctx.json(200, { listing: await serializeOne(l, ctx.user) });
  });
  route('POST', '/api/listings/:id/contact', null, async (ctx) => {
    const l = await db.one(`SELECT l.* FROM listings l WHERE l.id = ? AND ${PUBLIC_WHERE}`, intOrNull(ctx.params.id));
    if (!l) throw new HttpError(404, 'الإعلان غير متاح');
    const channel = ctx.body.channel === 'call' ? 'call' : 'whatsapp';
    await throttle('contact:' + ctx.ip, 30, 60 * 60 * 1000);
    await db.run('INSERT INTO contacts (listing_id, user_id, channel) VALUES (?, ?, ?)', l.id, ctx.user ? ctx.user.id : null, channel);
    const owner = await db.one('SELECT phone FROM users WHERE id = ?', l.owner_id);
    const intl = toIntlPhone(owner.phone);
    const text = (await db.getSetting('whatsapp_template')).replace('{title}', l.title).replace('{district}', l.district).replace('{license}', l.license_no);
    ctx.json(200, { url: channel === 'call' ? `tel:+${intl}` : `https://wa.me/${intl}?text=${encodeURIComponent(text)}`, message: text });
  });
  route('POST', '/api/listings/:id/report', null, async (ctx) => {
    const reason = str(ctx.body.reason, 500);
    if (reason.length < 3) throw bad('اكتب سبب البلاغ');
    await throttle('report:' + ctx.ip, 20, 60 * 60 * 1000);
    const l = await db.one('SELECT id FROM listings WHERE id = ?', intOrNull(ctx.params.id));
    if (!l) throw new HttpError(404, 'الإعلان غير موجود');
    await db.run('INSERT INTO reports (listing_id, user_id, reason) VALUES (?, ?, ?)', l.id, ctx.user ? ctx.user.id : null, reason);
    ctx.json(201, { ok: true });
  });

  // --- المحفوظات والبحث المحفوظ
  route('GET', '/api/saves', 'user', async (ctx) => {
    const rows = await db.all(`SELECT l.* FROM saves s JOIN listings l ON l.id = s.listing_id WHERE s.user_id = ? AND ${PUBLIC_WHERE} ORDER BY s.created_at DESC`, ctx.user.id);
    ctx.json(200, { listings: await serializeMany(rows, ctx.user) });
  });
  route('POST', '/api/listings/:id/save', 'user', async (ctx) => {
    const l = await db.one(`SELECT l.id FROM listings l WHERE l.id = ? AND ${PUBLIC_WHERE}`, intOrNull(ctx.params.id));
    if (!l) throw new HttpError(404, 'غير موجود');
    await db.run('INSERT INTO saves (user_id, listing_id) VALUES (?, ?) ON CONFLICT DO NOTHING', ctx.user.id, l.id);
    ctx.json(200, { saved: true });
  });
  route('DELETE', '/api/listings/:id/save', 'user', async (ctx) => {
    await db.run('DELETE FROM saves WHERE user_id = ? AND listing_id = ?', ctx.user.id, intOrNull(ctx.params.id));
    ctx.json(200, { saved: false });
  });
  route('GET', '/api/searches', 'user', async (ctx) => {
    ctx.json(200, { searches: await db.all('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC', ctx.user.id) });
  });
  route('POST', '/api/searches', 'user', async (ctx) => {
    const b = ctx.body;
    const q = {}; for (const k of ['kind', 'city', 'district', 'min', 'max', 'beds']) if (b[k]) q[k] = String(b[k]).slice(0, 60);
    if (!Object.keys(q).length) throw bad('اختر فلتراً واحداً على الأقل');
    if ((await db.n('SELECT COUNT(*) FROM saved_searches WHERE user_id = ?', ctx.user.id)) >= 10) throw bad('الحد الأقصى 10 عمليات بحث محفوظة');
    await db.run('INSERT INTO saved_searches (user_id, query) VALUES (?, ?)', ctx.user.id, JSON.stringify(q));
    ctx.json(201, { ok: true });
  });
  route('DELETE', '/api/searches/:id', 'user', async (ctx) => {
    await db.run('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', intOrNull(ctx.params.id), ctx.user.id);
    ctx.json(200, { ok: true });
  });

  // --- إعلانات المالك
  route('GET', '/api/my/listings', 'user', async (ctx) => {
    const rows = await db.all('SELECT * FROM listings WHERE owner_id = ? ORDER BY id DESC', ctx.user.id);
    ctx.json(200, { listings: await serializeMany(rows, ctx.user, { owner: true }) });
  });
  route('POST', '/api/listings', 'user', async (ctx) => {
    const v = validateListing(ctx.body);
    const plan = await currentPlan(ctx.user.id);
    const used = await db.n("SELECT COUNT(*) FROM listings WHERE owner_id = ? AND status NOT IN ('rejected','expired')", ctx.user.id);
    if (plan && used >= plan.max_listings) throw new HttpError(403, `وصلت الحد الأقصى لباقتك (${plan.max_listings} إعلان). رقِّ باقتك لإضافة المزيد.`);
    const cols = Object.keys(v);
    const l = await db.one(`INSERT INTO listings (owner_id, status, ${cols.join(', ')}) VALUES (?, 'draft', ${cols.map(() => '?').join(', ')}) RETURNING *`, ctx.user.id, ...cols.map((c) => v[c]));
    ctx.json(201, { listing: await serializeOne(l, ctx.user, { owner: true }) });
  });
  route('PUT', '/api/listings/:id', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    const v = validateListing(ctx.body, { partial: true });
    if ('media_type' in v && v.media_type !== l.media_type && (await mediaCount(l.id)) > 0) throw bad('احذف الملفات الحالية قبل تغيير نوع المحتوى');
    const cols = Object.keys(v);
    if (cols.length) {
      const sensitive = cols.some((c) => !['description', 'title'].includes(c));
      let status = l.status;
      const isAdmin = ctx.user.role === 'admin';
      if (l.status === 'published' && sensitive && !isAdmin && (await db.getSetting('require_review')) === '1') status = 'pending';
      if (l.status === 'expired' && 'license_expires' in v) status = 'draft';
      if (l.status === 'rejected') status = 'draft';
      const row = await db.one(`UPDATE listings SET ${cols.map((c) => c + ' = ?').join(', ')}, status = ?, updated_at = now() WHERE id = ? RETURNING *`, ...cols.map((c) => v[c]), status, l.id);
      return ctx.json(200, { listing: await serializeOne(row, ctx.user, { owner: true }) });
    }
    ctx.json(200, { listing: await serializeOne(l, ctx.user, { owner: true }) });
  });
  route('DELETE', '/api/listings/:id', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    const files = (await db.all('SELECT file, poster FROM media WHERE listing_id = ?', l.id)).flatMap((m) => [m.file, m.poster].filter(Boolean));
    await db.run('DELETE FROM listings WHERE id = ?', l.id);
    await storage.remove(files);
    if (ctx.user.role === 'admin' && l.owner_id !== ctx.user.id) await audit(ctx.user.id, 'delete_listing', l.id);
    ctx.json(200, { ok: true });
  });
  route('POST', '/api/listings/:id/submit', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    if (l.status === 'suspended' && ctx.user.role !== 'admin') throw new HttpError(403, 'أوقفت الإدارة هذا الإعلان. تواصل مع الدعم.');
    if (!['draft', 'rejected', 'paused', 'suspended'].includes(l.status)) throw bad('لا يمكن إرسال هذا الإعلان الآن');
    if (l.license_expires < today()) throw bad('ترخيص الإعلان منتهٍ');
    if ((await mediaCount(l.id)) < 1) throw bad(l.media_type === 'video' ? 'ارفع فيديو للعقار أولاً' : 'ارفع صورة واحدة على الأقل');
    if ((await db.getSetting('require_review')) === '1' && ctx.user.role !== 'admin') {
      await db.run("UPDATE listings SET status = 'pending', reject_reason = NULL, updated_at = now() WHERE id = ?", l.id);
      ctx.json(200, { status: 'pending' });
    } else {
      await publishListing(l);
      ctx.json(200, { status: 'published' });
    }
  });
  route('POST', '/api/listings/:id/pause', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    if (l.status !== 'published') throw bad('الإعلان غير منشور');
    await db.run("UPDATE listings SET status = 'paused' WHERE id = ?", l.id);
    ctx.json(200, { status: 'paused' });
  });
  route('POST', '/api/listings/:id/resume', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    // الإيقاف من الإدارة حالة مستقلة (suspended) لا يرفعها المالك
    if (l.status !== 'paused') throw bad(l.status === 'suspended' ? 'أوقفت الإدارة هذا الإعلان' : 'الإعلان غير موقوف');
    if (l.license_expires < today()) throw bad('ترخيص الإعلان منتهٍ');
    if ((await mediaCount(l.id)) < 1) throw bad('أضف فيديو أو صوراً قبل الاستئناف');
    await db.run("UPDATE listings SET status = 'published' WHERE id = ?", l.id);
    ctx.json(200, { status: 'published' });
  });

  // --- رفع الوسائط: (1) طلب روابط رفع موقّعة  (2) الرفع المباشر للتخزين  (3) تأكيد الملفات
  async function mediaLimits() {
    const s = await db.settings();
    return { maxVideo: Number(s.max_video_mb) * 1024 * 1024, maxPhotos: Number(s.max_photos), maxVideoMb: s.max_video_mb };
  }
  function checkKind(l, mime) {
    if (!EXT[mime]) throw bad('نوع الملف غير مسموح: ' + mime);
    const isVideo = mime.startsWith('video/');
    if (l.media_type === 'video' && !isVideo) throw bad('هذا الإعلان فيديو، ارفع فيديو فقط');
    if (l.media_type === 'photos' && isVideo) throw bad('هذا الإعلان صور، ارفع صوراً فقط');
    return isVideo;
  }
  function checkCount(l, total, maxPhotos) {
    if (l.media_type === 'video' && total > 1) throw bad('الإعلان بالفيديو يقبل فيديو واحداً. احذف القديم أولاً');
    if (l.media_type === 'photos' && total > maxPhotos) throw bad(`الحد الأقصى ${maxPhotos} صورة`);
  }
  route('POST', '/api/listings/:id/uploads', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    if (l.status === 'suspended' && ctx.user.role !== 'admin') throw new HttpError(403, 'أوقفت الإدارة هذا الإعلان');
    const all = Array.isArray(ctx.body.files) ? ctx.body.files.slice(0, 21) : [];
    const files = all.filter((f) => f && f.role !== 'poster');
    const posters = all.filter((f) => f && f.role === 'poster');
    if (!all.length) throw bad('لم تحدد أي ملف');
    if (posters.length > 1 || (posters.length && l.media_type !== 'video')) throw bad('الصورة المصغّرة للفيديو فقط');
    const { maxVideo, maxPhotos, maxVideoMb } = await mediaLimits();
    if (files.length) checkCount(l, (await mediaCount(l.id)) + files.length, maxPhotos);
    await throttle('upload:' + ctx.user.id, 60, 60 * 60 * 1000);
    await storage.ready();
    const uploads = [];
    for (const f of files) {
      const mime = String(f.mime || '').toLowerCase();
      const isVideo = checkKind(l, mime);
      const size = Number(f.size) || 0;
      if (isVideo && size > maxVideo) throw bad(`الفيديو أكبر من ${maxVideoMb} ميغابايت`);
      if (!isVideo && size > MAX_PHOTO_MB * 1024 * 1024) throw bad(`الصورة أكبر من ${MAX_PHOTO_MB} ميغابايت`);
      const p = `l${l.id}/${crypto.randomBytes(16).toString('hex')}${EXT[mime]}`;
      const s = await storage.signUpload(p);
      uploads.push({ path: p, upload_url: s.upload_url, method: s.method, headers: { 'Content-Type': mime } });
    }
    let poster = null;
    if (posters.length) {
      const mime = String(posters[0].mime || '').toLowerCase();
      if (!POSTER_MIME.includes(mime)) throw bad('نوع الصورة المصغّرة غير مسموح');
      if ((Number(posters[0].size) || 0) > MAX_POSTER_BYTES) throw bad('الصورة المصغّرة أكبر من 1 ميغابايت');
      const p = `l${l.id}/${crypto.randomBytes(16).toString('hex')}${EXT[mime]}`;
      const s = await storage.signUpload(p);
      poster = { path: p, upload_url: s.upload_url, method: s.method, headers: { 'Content-Type': mime } };
    }
    ctx.json(200, { uploads, poster });
  });
  route('POST', '/api/listings/:id/media', 'user', async (ctx) => {
    const l = await ownerListing(ctx.user, ctx.params.id);
    if (l.status === 'suspended' && ctx.user.role !== 'admin') throw new HttpError(403, 'أوقفت الإدارة هذا الإعلان');
    const paths = [...new Set(Array.isArray(ctx.body.paths) ? ctx.body.paths.map(String) : [])].slice(0, 20);
    const posterPath = ctx.body.poster ? String(ctx.body.poster) : null;
    if (!paths.length && !posterPath) throw bad('لم يصل أي ملف');
    if (posterPath && l.media_type !== 'video') throw bad('الصورة المصغّرة للفيديو فقط');
    const { maxVideo, maxPhotos, maxVideoMb } = await mediaLimits();
    const existing = await mediaCount(l.id);
    const re = new RegExp(`^l${l.id}/[0-9a-f]{32}(\\.jpg|\\.png|\\.webp|\\.mp4|\\.webm|\\.mov)$`);
    const okFiles = [];
    try {
      for (const p of paths) {
        const m = re.exec(p);
        if (!m) throw bad('مسار ملف غير صالح');
        if (await db.one('SELECT 1 FROM media WHERE file = ?', p)) throw bad('الملف مضاف مسبقاً');
        const mime = MIME_BY_EXT[m[1]];
        const isVideo = checkKind(l, mime);
        const info = await storage.head(p);
        if (!info) throw bad('لم يكتمل رفع الملف، أعد المحاولة');
        if (isVideo && info.size > maxVideo) throw bad(`الفيديو أكبر من ${maxVideoMb} ميغابايت`);
        if (!isVideo && info.size > MAX_PHOTO_MB * 1024 * 1024) throw bad(`الصورة أكبر من ${MAX_PHOTO_MB} ميغابايت`);
        if (!magicOk(mime, info.head)) throw bad('محتوى الملف لا يطابق نوعه');
        okFiles.push({ p, mime });
      }
      checkCount(l, existing + okFiles.length, maxPhotos);
      if (posterPath) {
        const m = new RegExp(`^l${l.id}/[0-9a-f]{32}(\\.jpg|\\.png|\\.webp)$`).exec(posterPath);
        if (!m) throw bad('مسار الصورة المصغّرة غير صالح');
        if (await db.one('SELECT 1 FROM media WHERE file = ? OR poster = ?', posterPath, posterPath)) throw bad('الملف مضاف مسبقاً');
        const info = await storage.head(posterPath);
        if (!info) throw bad('لم يكتمل رفع الصورة المصغّرة');
        if (info.size > MAX_POSTER_BYTES) throw bad('الصورة المصغّرة أكبر من 1 ميغابايت');
        if (!magicOk(MIME_BY_EXT[m[1]], info.head)) throw bad('محتوى الصورة المصغّرة لا يطابق نوعها');
        if (!okFiles.length && existing !== 1) throw bad('ارفع الفيديو أولاً');
      }
    } catch (e) {
      await storage.remove([...paths, posterPath].filter((p) => p && p.startsWith(`l${l.id}/`)));
      throw e;
    }
    let pos = existing;
    for (const { p, mime } of okFiles) await db.run('INSERT INTO media (listing_id, file, mime, position, poster) VALUES (?, ?, ?, ?, ?)', l.id, p, mime, pos++, posterPath);
    if (posterPath && !okFiles.length) {
      // إضافة صورة مصغّرة لفيديو موجود: نستبدل القديمة
      const old = await db.one('SELECT id, poster FROM media WHERE listing_id = ?', l.id);
      await db.run('UPDATE media SET poster = ? WHERE id = ?', posterPath, old.id);
      if (old.poster) await storage.remove([old.poster]);
    }
    // تغيير وسائط إعلان منشور يعيده للمراجعة
    let status = l.status;
    if (l.status === 'published' && ctx.user.role !== 'admin' && (await db.getSetting('require_review')) === '1') {
      status = 'pending';
      await db.run("UPDATE listings SET status = 'pending', updated_at = now() WHERE id = ?", l.id);
    }
    const media = (await serializeOne({ ...l, status }, ctx.user, { owner: true })).media;
    ctx.json(201, { media, status });
  });
  route('DELETE', '/api/media/:id', 'user', async (ctx) => {
    const m = await db.one('SELECT * FROM media WHERE id = ?', intOrNull(ctx.params.id));
    if (!m) throw new HttpError(404, 'غير موجود');
    const l = await ownerListing(ctx.user, m.listing_id);
    await db.run('DELETE FROM media WHERE id = ?', m.id);
    await storage.remove([m.file, m.poster].filter(Boolean));
    // إعلان بلا وسائط لا يبقى منشوراً
    let status = l.status;
    if ((await mediaCount(l.id)) === 0 && ['published', 'pending'].includes(l.status)) {
      status = 'draft';
      await db.run("UPDATE listings SET status = 'draft', updated_at = now() WHERE id = ?", l.id);
    }
    ctx.json(200, { ok: true, status });
  });
  // --- الدفع عبر Moyasar: فاتورة مستضافة ← عودة المستخدم ← تحقق من خادم ميسّر ← تفعيل الباقة
  const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
  const APP_RETURN = /^(tikhome|exps?):\/\/[\w.\-:@/%~+]{0,300}$/;
  const publicPayment = (p) => p && ({ ref: p.ref, status: p.status, plan_id: p.plan_id, amount_sar: p.amount_halalas / 100, created_at: p.created_at, paid_at: p.paid_at });

  async function activatePayment(p) {
    const row = await db.one("UPDATE payments SET status = 'paid', paid_at = now() WHERE id = ? AND status = 'initiated' RETURNING *", p.id);
    if (!row) return db.one('SELECT * FROM payments WHERE id = ?', p.id); // فُعّلت مسبقاً
    const plan = await db.one('SELECT * FROM plans WHERE id = ?', p.plan_id);
    // التجديد قبل الانتهاء يُضاف إلى نهاية الاشتراك الحالي
    const sub = await db.one(`WITH s AS (SELECT GREATEST(CURRENT_DATE, COALESCE((SELECT MAX(ends_at) FROM subscriptions WHERE user_id = ? AND plan_id = ?), CURRENT_DATE)) AS d)
      INSERT INTO subscriptions (user_id, plan_id, starts_at, ends_at, note) SELECT ?, ?, d, d + ?::int, ? FROM s RETURNING *`,
    p.user_id, p.plan_id, p.user_id, p.plan_id, plan.duration_days || 30, 'دفع ميسّر ' + p.ref);
    await db.run('UPDATE payments SET subscription_id = ? WHERE id = ?', sub.id, p.id);
    await notify(p.user_id, `تم الدفع وتفعيل باقة «${plan.name}» حتى ${sub.ends_at}`);
    return { ...row, subscription_id: sub.id };
  }
  async function verifyPayment(p) {
    if (!p || p.status !== 'initiated' || !p.provider_id || !moyasar.enabled) return p;
    const inv = await moyasar.getInvoice(p.provider_id);
    if (String(inv.id) !== p.provider_id) return p;
    if (inv.status === 'paid') {
      if (Number(inv.amount) !== p.amount_halalas || String(inv.currency || '').toUpperCase() !== 'SAR') {
        console.error('Moyasar amount mismatch', p.ref, inv.amount, inv.currency);
        return p;
      }
      return activatePayment(p);
    }
    if (['expired', 'canceled', 'failed', 'voided'].includes(inv.status)) {
      return db.one("UPDATE payments SET status = ? WHERE id = ? AND status = 'initiated' RETURNING *", inv.status === 'expired' ? 'expired' : 'failed', p.id) || p;
    }
    return p;
  }
  const paymentByRef = (ref) => db.one('SELECT * FROM payments WHERE ref = ?', String(ref || '').slice(0, 64));

  route('POST', '/api/billing/checkout', 'user', async (ctx) => {
    if (!moyasar.enabled) throw new HttpError(503, 'الدفع الإلكتروني غير مفعّل حالياً');
    const plan = await db.one('SELECT * FROM plans WHERE id = ? AND active', intOrNull(ctx.body.plan_id));
    if (!plan) throw bad('الباقة غير متاحة');
    if (!(plan.price_sar > 0)) throw bad('هذه الباقة مجانية');
    await throttle('checkout:' + ctx.user.id, 20, 60 * 60 * 1000);
    const returnTo = typeof ctx.body.return_to === 'string' && APP_RETURN.test(ctx.body.return_to) ? ctx.body.return_to : null;
    const ref = crypto.randomBytes(18).toString('base64url');
    const amount = plan.price_sar * 100;
    const p = await db.one('INSERT INTO payments (ref, user_id, plan_id, amount_halalas) VALUES (?, ?, ?, ?) RETURNING *', ref, ctx.user.id, plan.id, amount);
    const base = baseUrl(ctx.req);
    const ret = `${base}/api/billing/return?ref=${ref}${returnTo ? '&to=' + encodeURIComponent(returnTo) : ''}`;
    let inv;
    try {
      inv = await moyasar.createInvoice({
        amount, description: `Tikhome — باقة ${plan.name} (${plan.duration_days || 30} يوماً)`,
        successUrl: ret, backUrl: ret + '&cancel=1', callbackUrl: `${base}/api/billing/callback?ref=${ref}`,
        metadata: { ref, user_id: String(ctx.user.id), plan_id: String(plan.id) },
      });
    } catch (e) {
      await db.run("UPDATE payments SET status = 'failed' WHERE id = ?", p.id);
      throw new HttpError(502, e.message);
    }
    if (!inv.id || !inv.url) throw new HttpError(502, 'ردّ غير متوقع من بوابة الدفع');
    await db.run('UPDATE payments SET provider_id = ?, pay_url = ? WHERE id = ?', String(inv.id), inv.url, p.id);
    ctx.json(201, { ref, url: inv.url });
  });
  // عودة المتصفح من صفحة الدفع
  route('GET', '/api/billing/return', null, async (ctx) => {
    let p = await paymentByRef(ctx.query.ref);
    try { p = await verifyPayment(p); } catch (e) { console.error(e); }
    const status = p ? p.status : 'unknown';
    const to = typeof ctx.query.to === 'string' && APP_RETURN.test(ctx.query.to) ? ctx.query.to : null;
    const qs = `payment=${encodeURIComponent(status)}&ref=${encodeURIComponent(p ? p.ref : '')}`;
    ctx.redirect(to ? `${to}${to.includes('?') ? '&' : '?'}${qs}` : `/?${qs}#/me`);
  });
  // إشعار من ميسّر: لا نقرأ محتواه، فقط نعيد التحقق من خادم ميسّر
  route('POST', '/api/billing/callback', null, async (ctx) => {
    const p = await paymentByRef(ctx.query.ref);
    if (p) await verifyPayment(p);
    ctx.json(200, { ok: true });
  });
  route('POST', '/api/billing/webhook', null, async (ctx) => {
    const secret = process.env.MOYASAR_WEBHOOK_SECRET;
    const got = Buffer.from(String(ctx.body.secret_token || '')); const want = Buffer.from(String(secret || ''));
    if (!secret || got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new HttpError(401, 'غير مصرّح');
    const d = ctx.body.data || {};
    const p = d.invoice_id ? await db.one('SELECT * FROM payments WHERE provider_id = ?', String(d.invoice_id))
      : d.metadata && d.metadata.ref ? await paymentByRef(d.metadata.ref) : null;
    if (p) await verifyPayment(p);
    ctx.json(200, { ok: true });
  });
  route('GET', '/api/billing/payments/:ref', 'user', async (ctx) => {
    let p = await paymentByRef(ctx.params.ref);
    if (!p || p.user_id !== ctx.user.id) throw new HttpError(404, 'غير موجود');
    p = await verifyPayment(p);
    ctx.json(200, { payment: publicPayment(p), plan: await currentPlan(ctx.user.id) });
  });
  route('GET', '/api/billing/subscription', 'user', async (ctx) => {
    const sub = await db.one(`SELECT s.ends_at, p.name, p.id AS plan_id FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = ? AND s.ends_at >= CURRENT_DATE ORDER BY p.max_listings DESC, s.ends_at DESC LIMIT 1`, ctx.user.id);
    ctx.json(200, { subscription: sub || null });
  });

  route('GET', '/api/plans', null, async (ctx) => ctx.json(200, { plans: await db.all('SELECT * FROM plans WHERE active ORDER BY id') }));

  // --- لوحة المدير
  route('GET', '/api/admin/stats', 'admin', async (ctx) => {
    const byStatus = Object.fromEntries((await db.all('SELECT status, COUNT(*)::int AS n FROM listings GROUP BY status')).map((r) => [r.status, r.n]));
    const [users, verified, vreq, views, contacts, reports, expiring, top, newUsers] = await Promise.all([
      db.n('SELECT COUNT(*) FROM users'),
      db.n('SELECT COUNT(*) FROM users WHERE verified'),
      db.n('SELECT COUNT(*) FROM users WHERE verify_requested AND NOT verified'),
      db.n('SELECT COALESCE(SUM(views),0) FROM listings'),
      db.n("SELECT COUNT(*) FROM contacts WHERE created_at > now() - interval '30 days'"),
      db.n("SELECT COUNT(*) FROM reports WHERE status = 'open'"),
      db.n("SELECT COUNT(*) FROM listings WHERE status = 'published' AND license_expires BETWEEN CURRENT_DATE AND CURRENT_DATE + 14"),
      db.all("SELECT district, city, COUNT(*)::int AS n FROM listings WHERE status = 'published' GROUP BY district, city ORDER BY n DESC LIMIT 5"),
      db.n("SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days'")
    ]);
    ctx.json(200, { users, verified_owners: verified, verify_requests: vreq, listings: byStatus, views, contacts_30d: contacts, open_reports: reports, expiring_14d: expiring, top_districts: top, new_users_7d: newUsers });
  });
  route('GET', '/api/admin/listings', 'admin', async (ctx) => {
    const status = ctx.query.status;
    const rows = status
      ? await db.all('SELECT * FROM listings WHERE status = ? ORDER BY updated_at DESC LIMIT 200', String(status))
      : await db.all("SELECT * FROM listings WHERE status != 'draft' ORDER BY updated_at DESC LIMIT 200");
    const ser = await serializeMany(rows, ctx.user, { owner: true });
    const phones = new Map((await db.all('SELECT id, phone FROM users WHERE id = ANY(?)', [...new Set(rows.map((r) => r.owner_id))])).map((u) => [u.id, u.phone]));
    ctx.json(200, { listings: ser.map((l, i) => ({ ...l, owner_id: rows[i].owner_id, owner_phone: phones.get(rows[i].owner_id) })) });
  });
  const adminListing = async (id) => {
    const l = await db.one('SELECT * FROM listings WHERE id = ?', intOrNull(id));
    if (!l) throw new HttpError(404, 'غير موجود');
    return l;
  };
  route('POST', '/api/admin/listings/:id/approve', 'admin', async (ctx) => {
    const l = await adminListing(ctx.params.id);
    if (l.license_expires < today()) throw bad('ترخيص الإعلان منتهٍ');
    if ((await mediaCount(l.id)) < 1) throw bad('الإعلان بلا فيديو أو صور');
    await publishListing(l); await audit(ctx.user.id, 'approve_listing', l.id);
    ctx.json(200, { ok: true });
  });
  route('POST', '/api/admin/listings/:id/reject', 'admin', async (ctx) => {
    const reason = str(ctx.body.reason, 300) || 'لم يستوفِ الشروط';
    const l = await adminListing(ctx.params.id);
    await db.run("UPDATE listings SET status = 'rejected', reject_reason = ? WHERE id = ?", reason, l.id);
    await notify(l.owner_id, `رُفض إعلانك «${l.title}»: ${reason}`, l.id);
    await audit(ctx.user.id, 'reject_listing', l.id);
    ctx.json(200, { ok: true });
  });
  route('POST', '/api/admin/listings/:id/takedown', 'admin', async (ctx) => {
    const l = await adminListing(ctx.params.id);
    await db.run("UPDATE listings SET status = 'suspended' WHERE id = ?", l.id);
    await notify(l.owner_id, `أوقفت الإدارة إعلانك «${l.title}»`, l.id);
    await audit(ctx.user.id, 'takedown_listing', l.id);
    ctx.json(200, { ok: true });
  });
  route('POST', '/api/admin/listings/:id/feature', 'admin', async (ctx) => {
    const l = await adminListing(ctx.params.id);
    const days = Math.min(Math.max(intOrNull(ctx.body.days) || 0, 0), 365);
    const until = days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null;
    await db.run('UPDATE listings SET featured_until = ? WHERE id = ?', until, l.id);
    await audit(ctx.user.id, 'feature_listing', `${l.id}:${days}d`);
    ctx.json(200, { featured_until: until });
  });
  route('GET', '/api/admin/users', 'admin', async (ctx) => {
    const rows = await db.all(`SELECT u.id, u.name, u.phone, u.role, u.verified, u.verify_requested, u.banned, u.created_at,
      (SELECT COUNT(*)::int FROM listings WHERE owner_id = u.id) AS listings_count FROM users u ORDER BY u.id DESC LIMIT 300`);
    ctx.json(200, { users: rows });
  });
  route('POST', '/api/admin/users/:id/reset-code', 'admin', async (ctx) => {
    const u = await db.one('SELECT id, phone, name FROM users WHERE id = ?', intOrNull(ctx.params.id));
    if (!u) throw new HttpError(404, 'غير موجود');
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    // رمز واحد صالح فقط لكل مستخدم
    await db.run('UPDATE password_resets SET used_at = now() WHERE user_id = ? AND used_at IS NULL', u.id);
    await db.run('INSERT INTO password_resets (user_id, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?)',
      u.id, sha(code + ':' + u.id), new Date(Date.now() + RESET_MINUTES * 60000), ctx.user.id);
    await audit(ctx.user.id, 'reset_code_user', u.id);
    const text = `رمز استعادة كلمة السر في Tikhome: ${code}\nصالح لمدة ${RESET_MINUTES} دقيقة. لا تشاركه مع أحد.`;
    ctx.json(201, { code, expires_minutes: RESET_MINUTES, whatsapp_url: `https://wa.me/${toIntlPhone(u.phone)}?text=${encodeURIComponent(text)}` });
  });
  route('POST', '/api/admin/users/:id/:action', 'admin', async (ctx) => {
    const id = intOrNull(ctx.params.id); const a = ctx.params.action;
    const u = await db.one('SELECT * FROM users WHERE id = ?', id);
    if (!u) throw new HttpError(404, 'غير موجود');
    if (u.id === ctx.user.id && ['ban', 'demote'].includes(a)) throw bad('لا يمكنك تنفيذ ذلك على حسابك');
    const set = { ban: 'banned = TRUE', unban: 'banned = FALSE', verify: 'verified = TRUE, verify_requested = FALSE', unverify: 'verified = FALSE', promote: "role = 'admin'", demote: "role = 'user'" }[a];
    if (!set) throw bad('إجراء غير معروف');
    await db.run(`UPDATE users SET ${set} WHERE id = ?`, id);
    if (a === 'ban' || a === 'demote') await db.run('DELETE FROM sessions WHERE user_id = ?', id);
    if (a === 'verify') await notify(id, 'تم توثيق حسابك كمالك موثّق');
    await audit(ctx.user.id, a + '_user', id);
    ctx.json(200, { ok: true });
  });
  route('GET', '/api/admin/reports', 'admin', async (ctx) => {
    ctx.json(200, { reports: await db.all(`SELECT r.*, l.title FROM reports r JOIN listings l ON l.id = r.listing_id ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 200`) });
  });
  route('POST', '/api/admin/reports/:id/close', 'admin', async (ctx) => {
    await db.run("UPDATE reports SET status = 'closed' WHERE id = ?", intOrNull(ctx.params.id));
    await audit(ctx.user.id, 'close_report', ctx.params.id);
    ctx.json(200, { ok: true });
  });
  route('GET', '/api/admin/plans', 'admin', async (ctx) => ctx.json(200, { plans: await db.all('SELECT * FROM plans ORDER BY id') }));
  route('POST', '/api/admin/plans', 'admin', async (ctx) => {
    const b = ctx.body;
    const name = str(b.name, 60); if (!name) throw bad('اسم الباقة مطلوب');
    const r = await db.one('INSERT INTO plans (name, price_sar, max_listings, featured_days, active, duration_days) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      name, Math.max(intOrNull(b.price_sar) || 0, 0), Math.max(intOrNull(b.max_listings) || 1, 1), Math.max(intOrNull(b.featured_days) || 0, 0), b.active !== false,
      Math.min(Math.max(intOrNull(b.duration_days) || 30, 1), 3650));
    await audit(ctx.user.id, 'create_plan', r.id);
    ctx.json(201, { id: r.id });
  });
  route('PUT', '/api/admin/plans/:id', 'admin', async (ctx) => {
    const b = ctx.body;
    const p = await db.one('SELECT * FROM plans WHERE id = ?', intOrNull(ctx.params.id));
    if (!p) throw new HttpError(404, 'غير موجود');
    if (b.duration_days != null) await db.run('UPDATE plans SET duration_days = ? WHERE id = ?', Math.min(Math.max(intOrNull(b.duration_days) || 30, 1), 3650), p.id);
    await db.run('UPDATE plans SET name = ?, price_sar = ?, max_listings = ?, featured_days = ?, active = ? WHERE id = ?',
      str(b.name, 60) || p.name, b.price_sar != null ? Math.max(intOrNull(b.price_sar) || 0, 0) : p.price_sar,
      b.max_listings != null ? Math.max(intOrNull(b.max_listings) || 1, 1) : p.max_listings,
      b.featured_days != null ? Math.max(intOrNull(b.featured_days) || 0, 0) : p.featured_days,
      b.active == null ? p.active : !!b.active, p.id);
    await audit(ctx.user.id, 'update_plan', p.id);
    ctx.json(200, { ok: true });
  });
  route('GET', '/api/admin/subscriptions', 'admin', async (ctx) => {
    ctx.json(200, { subscriptions: await db.all(`SELECT s.*, u.name AS user_name, u.phone, p.name AS plan_name FROM subscriptions s
      JOIN users u ON u.id = s.user_id JOIN plans p ON p.id = s.plan_id ORDER BY s.id DESC LIMIT 200`) });
  });
  route('POST', '/api/admin/subscriptions', 'admin', async (ctx) => {
    const b = ctx.body;
    const user = await db.one('SELECT id FROM users WHERE phone = ?', toLatin(str(b.phone, 20)));
    const plan = await db.one('SELECT id FROM plans WHERE id = ?', intOrNull(b.plan_id));
    if (!user || !plan) throw bad('الجوال أو الباقة غير صحيحين');
    const days = Math.min(Math.max(intOrNull(b.days) || 30, 1), 3650);
    const ends = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    await db.run('INSERT INTO subscriptions (user_id, plan_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?, ?)', user.id, plan.id, today(), ends, str(b.note, 200));
    await notify(user.id, 'تم تفعيل باقتك حتى ' + ends);
    await audit(ctx.user.id, 'assign_subscription', `${user.id}:${plan.id}:${days}d`);
    ctx.json(201, { ends_at: ends });
  });
  route('GET', '/api/admin/payments', 'admin', async (ctx) => {
    ctx.json(200, { payments: await db.all(`SELECT y.ref, y.status, y.amount_halalas, y.provider_id, y.created_at, y.paid_at, u.name AS user_name, u.phone, p.name AS plan_name
      FROM payments y JOIN users u ON u.id = y.user_id JOIN plans p ON p.id = y.plan_id ORDER BY y.id DESC LIMIT 200`) });
  });
  route('GET', '/api/admin/settings', 'admin', async (ctx) => ctx.json(200, { settings: await db.settings(true) }));
  route('PUT', '/api/admin/settings', 'admin', async (ctx) => {
    const allowed = { require_review: /^[01]$/, license_warning_days: /^\d{1,3}$/, allow_registration: /^[01]$/, max_video_mb: /^\d{1,3}$/, max_photos: /^\d{1,2}$/, whatsapp_template: /^[\s\S]{5,400}$/, support_whatsapp: /^(|0?5\d{8}|9665\d{8})$/ };
    for (const [k, v] of Object.entries(ctx.body)) {
      if (!allowed[k]) continue;
      if (!allowed[k].test(String(v))) throw bad('قيمة غير صحيحة: ' + k);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', k, String(v));
    }
    db.clearSettings();
    await audit(ctx.user.id, 'update_settings', Object.keys(ctx.body).join(','));
    ctx.json(200, { ok: true });
  });
  route('GET', '/api/admin/audit', 'admin', async (ctx) => {
    ctx.json(200, { log: await db.all('SELECT a.*, u.name AS admin_name FROM audit_log a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 200') });
  });

  // ------------------------------------------------------------ المعالج
  const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };
  const sendJson = (res, status, obj, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS, ...headers });
    res.end(JSON.stringify(obj));
  };
  function readBody(req, limit = 1024 * 1024) {
    // على Vercel قد يكون الجسم مقروءاً مسبقاً
    if (req.readableEnded && req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body ?? {})));
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'الطلب أكبر من الحد المسموح')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function clientIp(req) {
    // على Vercel تُعاد كتابة هذه الترويسات ولا يمكن تزويرها؛ محلياً نأخذ عنوان الاتصال فقط
    if (process.env.VERCEL || process.env.TRUST_PROXY === '1') {
      const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (ip) return ip;
    }
    return String(req.socket?.remoteAddress || 'unknown');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      // CSRF: كل طلب غير GET يجب أن يحمل ترويسة لا يستطيع موقع آخر إرسالها
      // استثناء إشعارات ميسّر: لا تغيّر شيئاً بنفسها، فقط تطلب إعادة التحقق من خادم ميسّر
      const providerHook = url.pathname === '/api/billing/callback' || url.pathname === '/api/billing/webhook';
      if (req.method !== 'GET' && !providerHook && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'طلب غير مسموح');
      // فحص الحالة: يعرض سبب فشل الاتصال بوضوح (بدون أي أسرار) لتسهيل الإعداد
      if (url.pathname === '/api/health') {
        const out = { ok: true, storage: storage.kind, db: 'ok' };
        try { await db.ready(); } catch (e) { out.ok = false; out.db = describeDbError(e); console.error('health db', e); }
        if (out.db === 'ok' && storage.kind === 'supabase') {
          try { await storage.ready(); out.bucket = 'ok'; } catch (e) { out.ok = false; out.bucket = String(e.message || e).slice(0, 200); console.error('health storage', e); }
        }
        return sendJson(res, out.ok ? 200 : 500, out);
      }
      await db.ready();
      if (url.pathname === '/api/cron/sweep') {
        const secret = process.env.CRON_SECRET;
        if (!secret || req.headers.authorization !== 'Bearer ' + secret) throw new HttpError(401, 'غير مصرّح');
        return sendJson(res, 200, await licenseSweep());
      }
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'المسار غير موجود');
      const user = await currentUser(req);
      if (r.access && !user) throw new HttpError(401, 'سجّل الدخول أولاً');
      if (r.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'للمدير فقط');
      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const buf = await readBody(req);
        if (buf.length) { try { body = JSON.parse(buf.toString('utf8')); } catch { if (!providerHook) throw bad('صيغة JSON غير صحيحة'); } }
        if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
      }
      const ctx = {
        req, ip: clientIp(req), user, body, query: Object.fromEntries(url.searchParams), params: r.re.exec(url.pathname).groups || {},
        json: (status, obj, headers) => sendJson(res, status, obj, headers),
        redirect: (location) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
      };
      return await r.handler(ctx);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: 'خطأ في الخادم' });
    }
  }
  handle.licenseSweep = licenseSweep;
  return handle;
}

module.exports = { createApp, magicOk };
