'use strict';
// نقطة تشغيل الواجهة على Vercel: كل طلبات /api/* تُوجَّه إلى هذه الدالة (انظر vercel.json)
const { createDb } = require('../src/db');
const { createStorage } = require('../src/storage');
const { createApp } = require('../src/app');

let app;
module.exports = async function handler(req, res) {
  // نستعيد المسار الأصلي بعد إعادة التوجيه
  const u = new URL(req.url || '/api', 'http://x');
  const rewritten = u.searchParams.get('__path');
  if (rewritten !== null) {
    u.searchParams.delete('__path');
    const qs = u.searchParams.toString();
    req.url = '/api/' + rewritten.replace(/^\/+/, '') + (qs ? '?' + qs : '');
  }
  try {
    app ||= createApp({ db: createDb(), storage: createStorage() });
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'إعدادات الخادم ناقصة: ' + e.message }));
  }
  return app(req, res);
};
