'use strict';
// طبقة قاعدة البيانات: PostgreSQL (Supabase) عبر مكتبة pg
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pg = require('pg');

// BIGINT و COUNT كأرقام، والتواريخ (DATE) كنص YYYY-MM-DD كما كانت
pg.types.setTypeParser(20, (v) => (v == null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

const DEFAULT_SETTINGS = {
  require_review: '1',
  license_warning_days: '14',
  whatsapp_template: 'السلام عليكم، أنا مهتم بـ{title} في {district} (رقم ترخيص الإعلان {license}). هل ما زال متاحاً؟',
  allow_registration: '1',
  max_video_mb: '50', // حد الملف في خطة Supabase المجانية 50 ميغابايت
  max_photos: '12',
  support_whatsapp: '' // رقم الدعم الذي يتواصل معه المستخدم عند نسيان كلمة السر
};

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

function createDb(url = connectionString()) {
  if (!url) throw new Error('DATABASE_URL غير محدد');
  const local = /@(localhost|127\.0\.0\.1)[:/]|host=\/|^postgres(ql)?:\/\/[^@]*@\/|\?host=/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    ssl: local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false }
  });

  // يحوّل علامات ? إلى $1, $2 ... حتى تبقى الاستعلامات مقروءة
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  const query = (sql, params = []) => pool.query(toPg(sql), params);
  const db = {
    pool,
    query,
    all: async (sql, ...p) => (await query(sql, p)).rows,
    one: async (sql, ...p) => (await query(sql, p)).rows[0],
    run: async (sql, ...p) => query(sql, p),
    n: async (sql, ...p) => Number(Object.values((await query(sql, p)).rows[0] || { n: 0 })[0]) || 0
  };

  let settingsCache = null; let settingsAt = 0;
  db.settings = async (fresh = false) => {
    if (!fresh && settingsCache && Date.now() - settingsAt < 30000) return settingsCache;
    const rows = await db.all('SELECT key, value FROM settings');
    settingsCache = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    settingsAt = Date.now();
    return settingsCache;
  };
  db.getSetting = async (k) => (await db.settings())[k];
  db.clearSettings = () => { settingsCache = null; };

  let ready = null;
  db.ready = () => (ready ||= migrate(db).catch((e) => { ready = null; throw e; }));
  return db;
}

async function migrate(db) {
  const client = await db.pool.connect();
  try {
    // معاملة واحدة مع قفل حتى لا تتعارض نسختان من الدالة عند التشغيل المتزامن
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274)');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
    }
    const plans = await client.query('SELECT COUNT(*)::int AS n FROM plans');
    if (plans.rows[0].n === 0) {
      await client.query(`INSERT INTO plans (name, price_sar, max_listings, featured_days) VALUES
        ('مالك (مجانية)', 0, 2, 0), ('مكتب عقاري', 0, 50, 7), ('مطوّر', 0, 500, 30)`);
    }
    // أول مدير: يُنشأ فقط إذا حُدد ADMIN_PASSWORD في متغيرات البيئة
    const admins = await client.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
    if (admins.rows[0].n === 0) {
      const phone = (process.env.ADMIN_PHONE || '0500000000').trim();
      if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8) {
        await client.query(`INSERT INTO users (phone, name, pass_hash, role, verified) VALUES ($1, 'المدير', $2, 'admin', TRUE)
          ON CONFLICT (phone) DO UPDATE SET role = 'admin', verified = TRUE, pass_hash = EXCLUDED.pass_hash`,
        [phone, hashPassword(process.env.ADMIN_PASSWORD)]);
        console.log('تم إنشاء حساب المدير الأول برقم', phone);
      } else {
        console.warn('لا يوجد مدير: حدّد ADMIN_PHONE و ADMIN_PASSWORD (8 أحرف على الأقل) في متغيرات البيئة');
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createDb, hashPassword, verifyPassword, DEFAULT_SETTINGS };
