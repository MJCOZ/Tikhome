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
process.env.MOYASAR_SECRET_KEY = 'sk_test_fake';
process.env.MOYASAR_WEBHOOK_SECRET = 'whsec_fake';

// خادم وهمي يحاكي واجهة Moyasar للفواتير
const http = require('node:http');
const invoices = new Map();
const fakeMoyasar = http.createServer((req, res) => {
  const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers.authorization !== 'Basic ' + Buffer.from('sk_test_fake:').toString('base64')) return send(401, { message: 'unauthorized' });
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1/invoices') {
      const b = JSON.parse(body); const id = 'inv_' + (invoices.size + 1);
      const inv = { id, status: 'initiated', amount: b.amount, currency: b.currency, url: 'https://checkout.moyasar.test/' + id, metadata: b.metadata, success_url: b.success_url };
      invoices.set(id, inv); return send(201, inv);
    }
    const m = /^\/v1\/invoices\/(.+)$/.exec(req.url);
    if (req.method === 'GET' && m && invoices.has(m[1])) return send(200, invoices.get(m[1]));
    send(404, { message: 'not found' });
  });
});

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

  await new Promise((r) => fakeMoyasar.listen(0, '127.0.0.1', r));
  process.env.MOYASAR_API_URL = 'http://127.0.0.1:' + fakeMoyasar.address().port + '/v1';
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

    // فيديو مع صورة مصغّرة
    r = await call('owner', 'POST', '/api/listings', { kind: 'sale', title: 'فيلا بفيديو', city: 'جدة', district: 'الشاطئ', price: 2500000, media_type: 'video', license_no: '7100099999', license_expires: exp });
    const vid = r.data.listing.id;
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(200)]);
    r = await call('owner', 'POST', `/api/listings/${vid}/uploads`, { files: [{ mime: 'video/mp4', size: mp4.length }, { mime: 'image/png', size: png.length, role: 'poster' }] });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.poster && r.data.uploads.length === 1);
    await fetch(base + r.data.uploads[0].upload_url, { method: 'PUT', headers: r.data.uploads[0].headers, body: mp4 });
    await fetch(base + r.data.poster.upload_url, { method: 'PUT', headers: r.data.poster.headers, body: png });
    r = await call('owner', 'POST', `/api/listings/${vid}/media`, { paths: [r.data.uploads[0].path], poster: r.data.poster.path });
    assert.equal(r.status, 201, JSON.stringify(r.data)); assert.ok(r.data.media[0].poster); ok('رفع فيديو مع صورة مصغّرة');
    assert.equal((await fetch(base + r.data.media[0].poster)).status, 200);
    r = await call('owner', 'POST', `/api/listings/${id}/uploads`, { files: [{ mime: 'image/png', size: 10, role: 'poster' }] });
    assert.equal(r.status, 400); ok('الصورة المصغّرة مرفوضة لإعلان الصور');
    r = await call('owner', 'POST', `/api/listings/${vid}/uploads`, { files: [{ mime: 'image/png', size: png.length, role: 'poster' }] });
    await fetch(base + r.data.poster.upload_url, { method: 'PUT', headers: r.data.poster.headers, body: Buffer.from('not an image at all') });
    r = await call('owner', 'POST', `/api/listings/${vid}/media`, { poster: r.data.poster.path });
    assert.equal(r.status, 400); ok('رفض صورة مصغّرة مزيّفة');
    r = await call('owner', 'POST', `/api/listings/${vid}/uploads`, { files: [{ mime: 'image/png', size: png.length, role: 'poster' }] });
    await fetch(base + r.data.poster.upload_url, { method: 'PUT', headers: r.data.poster.headers, body: png });
    const newPoster = r.data.poster.path;
    r = await call('owner', 'POST', `/api/listings/${vid}/media`, { poster: newPoster });
    assert.equal(r.status, 201); assert.ok(r.data.media[0].poster.endsWith(newPoster)); ok('استبدال الصورة المصغّرة لفيديو موجود');

    // استعادة كلمة السر برمز يصدره المدير
    r = await call('owner', 'POST', '/api/admin/users/1/reset-code'); assert.equal(r.status, 403);
    const owner = (await call('admin', 'GET', '/api/admin/users')).data.users.find((u) => u.phone === '0555555551');
    r = await call('admin', 'POST', `/api/admin/users/${owner.id}/reset-code`);
    assert.equal(r.status, 201); assert.match(r.data.code, /^\d{6}$/); assert.ok(r.data.whatsapp_url.includes('wa.me/966555555551'));
    const code = r.data.code; const wrong = code === '000000' ? '111111' : '000000';
    r = await call('reset', 'POST', '/api/auth/reset', { phone: '0555555551', code: wrong, new_password: 'NewPass#2026' }); assert.equal(r.status, 400);
    r = await call('reset', 'POST', '/api/auth/reset', { phone: '0555555551', code, new_password: 'NewPass#2026' }, { 'X-Client': 'mobile' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.token);
    r = await call('mobile', 'GET', '/api/me'); assert.equal(r.data.user, null); ok('الرمز يغيّر كلمة السر وينهي الجلسات القديمة');
    r = await call('reset2', 'POST', '/api/auth/reset', { phone: '0555555551', code, new_password: 'Another#2026' }); assert.equal(r.status, 400); ok('الرمز يُستخدم مرة واحدة');
    r = await call('o2', 'POST', '/api/auth/login', { phone: '0555555551', password: 'NewPass#2026' }); assert.equal(r.status, 200); ok('الدخول بكلمة السر الجديدة');
    r = await call('admin', 'POST', `/api/admin/users/${owner.id}/reset-code`); const c2 = r.data.code;
    for (let i = 0; i < 5; i++) await call('bf', 'POST', '/api/auth/reset', { phone: '0555555551', code: String((Number(c2) + 1 + i) % 1e6).padStart(6, '0'), new_password: 'Brute#20266' });
    r = await call('bf', 'POST', '/api/auth/reset', { phone: '0555555551', code: c2, new_password: 'Brute#20266' }); assert.equal(r.status, 400); ok('الرمز يُلغى بعد 5 محاولات خاطئة');
    await call('admin', 'PUT', '/api/admin/settings', { support_whatsapp: '0551234567' });
    r = await call('anon', 'GET', '/api/auth/support'); assert.equal(r.data.whatsapp, '966551234567'); ok('رقم واتساب الدعم');

    // الدفع عبر Moyasar
    r = await call('anon', 'GET', '/api/config'); assert.equal(r.data.payments, true);
    r = await call('o2', 'POST', '/api/billing/checkout', { plan_id: 1 }); assert.equal(r.status, 400); ok('لا دفع للباقة المجانية');
    await call('admin', 'PUT', '/api/admin/plans/2', { price_sar: 99, duration_days: 30 });
    r = await call('o2', 'POST', '/api/billing/checkout', { plan_id: 2, return_to: 'https://evil.example/steal' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); assert.ok(r.data.url.startsWith('https://checkout.moyasar.test/'));
    const ref1 = r.data.ref; const inv1 = [...invoices.values()].at(-1);
    assert.equal(inv1.amount, 9900); assert.ok(!inv1.success_url.includes('evil')); ok('إنشاء فاتورة بالمبلغ الصحيح بالهللة');
    r = await call('o2', 'GET', '/api/billing/payments/' + ref1); assert.equal(r.data.payment.status, 'initiated'); assert.equal(r.data.plan.id, 1);
    inv1.status = 'paid'; inv1.amount = 100;
    r = await call('o2', 'GET', '/api/billing/payments/' + ref1); assert.equal(r.data.payment.status, 'initiated'); ok('رفض الدفع إذا اختلف المبلغ');
    inv1.amount = 9900;
    let red = await fetch(base + '/api/billing/return?ref=' + ref1, { redirect: 'manual' });
    assert.equal(red.status, 302); assert.equal(red.headers.get('location'), `/?payment=paid&ref=${ref1}#/me`);
    r = await call('o2', 'GET', '/api/me'); assert.equal(r.data.plan.id, 2); ok('الدفع يفعّل الباقة تلقائياً');
    await fetch(base + '/api/billing/return?ref=' + ref1, { redirect: 'manual' });
    await fetch(base + '/api/billing/callback?ref=' + ref1, { method: 'POST', body: 'x=1' });
    r = await call('admin', 'GET', '/api/admin/subscriptions'); assert.equal(r.data.subscriptions.filter((x) => x.note && x.note.includes(ref1)).length, 1); ok('لا يتكرر التفعيل');
    r = await call('mobileapp', 'POST', '/api/auth/login', { phone: '0555555551', password: 'NewPass#2026' });
    r = await call('o2', 'POST', '/api/billing/checkout', { plan_id: 2, return_to: 'exp://192.168.1.5:8081/--/billing' });
    const ref2 = r.data.ref; const inv2 = [...invoices.values()].at(-1); inv2.status = 'paid';
    r = await call('x', 'GET', '/api/billing/payments/' + ref2); assert.equal(r.status, 401);
    red = await fetch(base + '/api/billing/return?ref=' + ref2 + '&to=' + encodeURIComponent('exp://192.168.1.5:8081/--/billing'), { redirect: 'manual' });
    assert.ok(red.headers.get('location').startsWith('exp://192.168.1.5:8081/--/billing?payment=paid')); ok('العودة إلى التطبيق بعد الدفع');
    r = await call('admin', 'GET', '/api/admin/subscriptions');
    const mine = r.data.subscriptions.filter((x) => x.phone === '0555555551').sort((a, b) => a.id - b.id);
    assert.equal(mine.length, 2); assert.equal(mine[1].starts_at, mine[0].ends_at); ok('التجديد يُضاف لنهاية الاشتراك الحالي');
    r = await fetch(base + '/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret_token: 'wrong', data: {} }) });
    assert.equal(r.status, 401);
    r = await call('o2', 'POST', '/api/billing/checkout', { plan_id: 2 }); const ref3 = r.data.ref; const inv3 = [...invoices.values()].at(-1); inv3.status = 'paid';
    r = await fetch(base + '/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret_token: 'whsec_fake', type: 'payment_paid', data: { invoice_id: inv3.id } }) });
    assert.equal(r.status, 200);
    r = await call('admin', 'GET', '/api/admin/payments'); assert.equal(r.data.payments.find((x) => x.ref === ref3).status, 'paid'); ok('إشعار ميسّر (webhook) محمي ويفعّل الدفع');

    r = await call('anon', 'GET', '/api/cron/sweep'); assert.equal(r.status, 401);
    process.env.CRON_SECRET = 'test-cron';
    r = await call('anon', 'GET', '/api/cron/sweep', undefined, { Authorization: 'Bearer test-cron' }); assert.equal(r.status, 200); ok('المهمة اليومية محمية بمفتاح');

    for (let i = 0; i < 10; i++) await call('x', 'POST', '/api/auth/login', { phone: '0511111111', password: 'wrong-pass' });
    r = await call('x', 'POST', '/api/auth/login', { phone: '0511111111', password: 'wrong-pass' });
    assert.equal(r.status, 429); ok('تقييد محاولات الدخول');

    console.log(`\nنجح ${passed} اختباراً`);
  } finally {
    server.close(); fakeMoyasar.close(); await server.db.pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`); await admin.end();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
})().catch((e) => { console.error('✗ فشل:', e); process.exit(1); });
