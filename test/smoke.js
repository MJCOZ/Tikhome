'use strict';
// اختبار تكامل: يشغّل الخادم على منفذ عشوائي ببيانات مؤقتة ثم يجرّب المسارات الأساسية.
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqar-'));
process.env.ADMIN_PHONE = '0500000000';
process.env.ADMIN_PASSWORD = 'AdminPass#123';
const { server } = require('../server');

const jar = {};
async function call(who, method, url, body, extra = {}) {
  const headers = { 'X-Requested-With': 'fetch', ...(jar[who] ? { Cookie: jar[who] } : {}), ...extra };
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  let data = {}; try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data };
}
let base, passed = 0;
const ok = (name) => { passed++; console.log('✓', name); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;

  // CSRF
  let r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403); ok('حماية CSRF');

  // تسجيل مالك
  r = await call('owner', 'POST', '/api/auth/register', { name: 'مالك تجريبي', phone: '0555555551', password: 'Owner#12345' });
  assert.ok(r.status < 300, JSON.stringify(r.data)); ok('تسجيل مالك');

  // إنشاء إعلان صور
  const exp = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  r = await call('owner', 'POST', '/api/listings', { kind: 'rent', title: 'شقة دور ثاني', city: 'الرياض', district: 'الملقا', price: 40000, floor: 2, entrance: 'private', media_type: 'photos', license_no: '7100012345', license_expires: exp, lat: 24.8, lng: 46.6 });
  assert.equal(r.status, 201, JSON.stringify(r.data)); const id = r.data.listing.id; ok('إنشاء إعلان');

  // رفع صورة (PNG صغير)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
  r = await call('owner', 'POST', `/api/listings/${id}/media`, fd);
  assert.ok(r.status < 300, JSON.stringify(r.data)); ok('رفع صورة');

  // رفض ملف مزيّف
  const bad = new FormData(); bad.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  r = await call('owner', 'POST', `/api/listings/${id}/media`, bad);
  assert.ok(r.status >= 400); ok('رفض ملف ليس صورة حقيقية');

  // غير منشور قبل الموافقة
  r = await call('anon', 'GET', '/api/listings');
  assert.equal(r.data.listings.length, 0); ok('الإعلان غير ظاهر قبل المراجعة');

  r = await call('owner', 'POST', `/api/listings/${id}/submit`);
  assert.ok(r.status < 300, JSON.stringify(r.data)); ok('إرسال للمراجعة');

  // المالك ليس مديراً
  r = await call('owner', 'GET', '/api/admin/stats'); assert.ok([401, 403].includes(r.status)); ok('المالك لا يصل للوحة المدير');

  // المدير
  r = await call('admin', 'POST', '/api/auth/login', { phone: '0500000000', password: 'AdminPass#123' });
  assert.ok(r.status < 300, JSON.stringify(r.data)); ok('دخول المدير');
  r = await call('admin', 'GET', '/api/admin/listings?status=pending'); assert.equal(r.data.listings.length, 1); ok('الإعلان بانتظار المراجعة');
  r = await call('admin', 'POST', `/api/admin/listings/${id}/approve`); assert.equal(r.status, 200); ok('موافقة المدير');

  r = await call('anon', 'GET', '/api/listings'); assert.equal(r.data.listings.length, 1);
  const pub = r.data.listings[0]; assert.equal(pub.floor, 2); assert.equal(pub.entrance, 'private');
  assert.ok(!JSON.stringify(pub).includes('0555555551')); ok('ظهور الإعلان دون كشف رقم المالك');

  r = await call('anon', 'POST', `/api/listings/${id}/contact`, {});
  assert.ok(JSON.stringify(r.data).includes('wa.me') && JSON.stringify(r.data).includes('7100012345')); ok('رابط واتساب برقم الترخيص');

  r = await call('admin', 'GET', '/api/admin/stats'); assert.equal(r.data.users, 2); ok('إحصائيات');
  r = await call('admin', 'POST', `/api/admin/listings/${id}/takedown`);
  r = await call('anon', 'GET', '/api/listings'); assert.equal(r.data.listings.length, 0); ok('الإيقاف يخفي الإعلان');

  console.log(`\nنجح ${passed} اختباراً`);
  server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error('✗ فشل:', e); process.exit(1); });
