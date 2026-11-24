'use strict';
// اختبار تكامل: يشغّل الخادم على قاعدة Postgres مؤقتة وتخزين محلي ثم يجرّب المسارات الأساسية.
// يحتاج TEST_DATABASE_URL يشير إلى خادم Postgres محلي (تُنشأ قاعدة tikhome_test وتُحذف تلقائياً).
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const pg = require('pg');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/postgres';
const TEST_DB = 'tikhome_test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tikhome-'));
process.env.ADMIN_PHONE = '0500000000';
process.env.ADMIN_PASSWORD = 'AdminPass#123';
delete process.env.SUPABASE_URL;

const jar = {}; const tokens = {};
let base, passed = 0;
const ok = (name) => { passed++; console.log('✓', name); };

async function call(who, method, url, body, extra = {}) {
  const headers = { 'X-Requested-With': 'fetch', ...extra };
  if (tokens[who]) headers.Authorization = 'Bearer ' + tokens[who];
  else if (jar[who]) headers.Cookie = jar[who];
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  let data = {}; try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data };
}
// يحاكي ما يفعله التطبيق: طلب رابط موقّع، رفع الملف مباشرة، ثم تأكيده
async function upload(who, id, buf, mime) {
  let r = await call(who, 'POST', `/api/listings/${id}/uploads`, { files: [{ mime, size: buf.length }] });
  if (r.status >= 300) return r;
  const u = r.data.uploads[0];
  const put = await fetch(base + u.upload_url, { method: 'PUT', headers: u.headers, body: buf });
  assert.equal(put.status, 200);
  return call(who, 'POST', `/api/listings/${id}/media`, { paths: [u.path] });
}

(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  const u = new URL(ADMIN_URL); u.pathname = '/' + TEST_DB;
  process.env.DATABASE_URL = u.toString();

  const { createServer } = require('../server');
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    let r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403); ok('حماية CSRF');

    r = await call('owner', 'POST', '/api/auth/register', { name: 'مالك تجريبي', phone: '0555555551', password: 'Owner#12345' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); assert.ok(!r.data.token); ok('تسجيل مالك (الويب: كوكي فقط)');

    r = await call('mobile', 'POST', '/api/auth/login', { phone: '0555555551', password: 'Owner#12345' }, { 'X-Client': 'mobile' });
    assert.ok(r.data.token); tokens.mobile = r.data.token;
    r = await call('mobile', 'GET', '/api/me'); assert.equal(r.data.user.phone, '0555555551'); ok('دخول الجوال بتوكن Bearer');

    const exp = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    r = await call('owner', 'POST', '/api/listings', { kind: 'rent', title: 'شقة دور ثاني', city: 'الرياض', district: 'الملقا', price: 40000, floor: 2, entrance: 'private', media_type: 'photos', license_no: '7100012345', license_expires: exp, lat: 24.8, lng: 46.6 });
    assert.equal(r.status, 201, JSON.stringify(r.data)); const id = r.data.listing.id; ok('إنشاء إعلان');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
    r = await upload('owner', id, png, 'image/png');
    assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.media.length, 1); ok('رفع صورة برابط موقّع');

    r = await upload('owner', id, Buffer.from('<script>alert(1)</script>....'), 'image/png');
    assert.equal(r.status, 400); ok('رفض ملف ليس صورة حقيقية');

    r = await call('owner', 'POST', `/api/listings/${id}/uploads`, { files: [{ mime: 'video/mp4', size: 1000 }] });
    assert.equal(r.status, 400); ok('رفض فيديو في إعلان صور');

    r = await call('owner', 'POST', `/api/listings/${id}/media`, { paths: ['l999/' + 'a'.repeat(32) + '.png'] });
    assert.equal(r.status, 400); ok('رفض مسار ملف لإعلان آخر');

    r = await call('anon', 'GET', '/api/listings'); assert.equal(r.data.listings.length, 0); ok('الإعلان غير ظاهر قبل المراجعة');
    r = await call('owner', 'POST', `/api/listings/${id}/submit`); assert.equal(r.data.status, 'pending'); ok('إرسال للمراجعة');
    r = await call('owner', 'GET', '/api/admin/stats'); assert.equal(r.status, 403); ok('المالك لا يصل للوحة المدير');

    r = await call('admin', 'POST', '/api/auth/login', { phone: '0500000000', password: 'AdminPass#123' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); ok('دخول المدير');
    r = await call('admin', 'GET', '/api/admin/listings?status=pending'); assert.equal(r.data.listings.length, 1); ok('الإعلان بانتظار المراجعة');
    r = await call('admin', 'POST', `/api/admin/listings/${id}/approve`); assert.equal(r.status, 200); ok('موافقة المدير');

    r = await call('anon', 'GET', '/api/listings'); assert.equal(r.data.listings.length, 1);
    const pub = r.data.listings[0]; assert.equal(pub.floor, 2); assert.equal(pub.entrance, 'private');
    assert.ok(!JSON.stringify(pub).includes('0555555551')); ok('ظهور الإعلان دون كشف رقم المالك');
    const img = await fetch(base + pub.media[0].url); assert.equal(img.status, 200); ok('الوسائط متاحة للعرض');

    r = await call('anon', 'POST', `/api/listings/${id}/contact`, {});
    assert.ok(r.data.url.includes('wa.me') && r.data.message.includes('7100012345')); ok('رابط واتساب برقم الترخيص');

    // إصلاح: إضافة صورة لإعلان منشور تعيده للمراجعة
    r = await upload('owner', id, png, 'image/png'); assert.equal(r.data.status, 'pending'); ok('تغيير الوسائط بعد النشر يعيد الإعلان للمراجعة');
    await call('admin', 'POST', `/api/admin/listings/${id}/approve`);

    // إصلاح: إيقاف الإدارة لا يستطيع المالك رفعه
    r = await call('admin', 'POST', `/api/admin/listings/${id}/takedown`); assert.equal(r.status, 200);
    r = await call('anon', 'GET', '/api/listings'); assert.equal(r.data.listings.length, 0); ok('الإيقاف يخفي الإعلان');
    r = await call('owner', 'POST', `/api/listings/${id}/resume`); assert.equal(r.status, 400);
    r = await call('owner', 'POST', `/api/listings/${id}/submit`); assert.equal(r.status, 403); ok('المالك لا يستطيع رفع إيقاف الإدارة');
    await call('admin', 'POST', `/api/admin/listings/${id}/approve`);

    // إصلاح: حذف كل الوسائط يعيد الإعلان مسودة
    r = await call('owner', 'GET', '/api/my/listings');
    for (const m of r.data.listings[0].media) r = await call('owner', 'DELETE', '/api/media/' + m.id);
    assert.equal(r.data.status, 'draft');
    r = await call('anon', 'GET', '/api/listings'); assert.equal(r.data.listings.length, 0); ok('إعلان بلا وسائط لا يبقى منشوراً');

    r = await call('admin', 'GET', '/api/admin/stats'); assert.equal(r.data.users, 2); ok('إحصائيات');

    r = await call('anon', 'GET', '/api/cron/sweep'); assert.equal(r.status, 401);
    process.env.CRON_SECRET = 'test-cron';
    r = await call('anon', 'GET', '/api/cron/sweep', undefined, { Authorization: 'Bearer test-cron' }); assert.equal(r.status, 200); ok('المهمة اليومية محمية بمفتاح');

    for (let i = 0; i < 10; i++) await call('x', 'POST', '/api/auth/login', { phone: '0511111111', password: 'wrong-pass' });
    r = await call('x', 'POST', '/api/auth/login', { phone: '0511111111', password: 'wrong-pass' });
    assert.equal(r.status, 429); ok('تقييد محاولات الدخول');

    console.log(`\nنجح ${passed} اختباراً`);
  } finally {
    server.close(); await server.db.pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`); await admin.end();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
})().catch((e) => { console.error('✗ فشل:', e); process.exit(1); });
