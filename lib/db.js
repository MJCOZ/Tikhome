'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- user | admin
  verified INTEGER NOT NULL DEFAULT 0,        -- هوية موثّقة (نفاذ أو يدوياً)
  verify_requested INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                         -- rent | sale
  property_type TEXT NOT NULL DEFAULT 'apartment',
  title TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  price INTEGER NOT NULL,
  area INTEGER,
  beds INTEGER,
  baths INTEGER,
  floor INTEGER,                              -- رقم الدور
  entrance TEXT,                              -- private | shared
  description TEXT,
  lat REAL, lng REAL,
  media_type TEXT NOT NULL DEFAULT 'video',   -- video | photos
  license_no TEXT NOT NULL,
  license_expires TEXT NOT NULL,              -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | published | rejected | paused | expired
  reject_reason TEXT,
  featured_until TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, kind, city);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, listing_id)
);
CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  listing_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id INTEGER,
  channel TEXT NOT NULL,                      -- whatsapp | call
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id INTEGER,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',        -- open | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_sar INTEGER NOT NULL DEFAULT 0,
  max_listings INTEGER NOT NULL DEFAULT 1,
  featured_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- helpers ----------
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

const DEFAULT_SETTINGS = {
  require_review: '1',                     // كل إعلان يراجعه المدير قبل النشر
  license_warning_days: '14',              // تنبيه المالك قبل انتهاء الترخيص
  whatsapp_template: 'السلام عليكم، أنا مهتم بـ{title} في {district} (رقم ترخيص الإعلان {license}). هل ما زال متاحاً؟',
  allow_registration: '1',
  max_video_mb: '60',
  max_photos: '12'
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

// الباقات الافتراضية: الأسعار صفر، تحددها أنت من لوحة التحكم
if (db.prepare('SELECT COUNT(*) AS n FROM plans').get().n === 0) {
  const ins = db.prepare('INSERT INTO plans (name, price_sar, max_listings, featured_days) VALUES (?, ?, ?, ?)');
  ins.run('مالك (مجانية)', 0, 2, 0);
  ins.run('مكتب عقاري', 0, 50, 7);
  ins.run('مطوّر', 0, 500, 30);
}

// أول مدير: كلمة سر عشوائية تُطبع مرة واحدة وتُحفظ في data/FIRST_ADMIN.txt
let firstAdminInfo = null;
if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n === 0) {
  const phone = (process.env.ADMIN_PHONE || '0500000000').trim();
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT OR REPLACE INTO users (phone, name, pass_hash, role, verified) VALUES (?, 'المدير', ?, 'admin', 1)")
    .run(phone, hashPassword(password));
  firstAdminInfo = { phone, password };
  if (!process.env.ADMIN_PASSWORD) {
    fs.writeFileSync(path.join(DATA_DIR, 'FIRST_ADMIN.txt'),
      `رقم الجوال: ${phone}\nكلمة السر: ${password}\nغيّرها بعد أول دخول ثم احذف هذا الملف.\n`, { mode: 0o600 });
  }
}

module.exports = { db, DATA_DIR, hashPassword, verifyPassword, getSetting, firstAdminInfo };
