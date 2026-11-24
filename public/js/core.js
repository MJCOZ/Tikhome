'use strict';
// ====== الأدوات الأساسية (بدون innerHTML: كل نص يُدرج كنص آمن) ======
window.A = {
  user: null, plan: null, unread: 0, config: { max_video_mb: 60, max_photos: 12 },
  filters: {}, viewing: null
};

const SVG_NS = 'http://www.w3.org/2000/svg';
A.h = function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};
const h = A.h;

const ICONS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  map: 'M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21zM12 10m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0',
  plus: 'M12 5v14M5 12h14',
  bookmark: 'M7 4h10v16l-5-3.5L7 20z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  heart: 'M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z',
  pin: 'M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21zM12 10m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  chat: 'M4 20l1.3-4.2A8 8 0 1 1 8.4 19L4 20z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  play: 'M8 5l11 7-11 7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4'
};
A.icon = function icon(name) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', ICONS[name] || ''); s.append(p);
  return s;
};

A.api = async function api(path, { method = 'GET', body } = {}) {
  const opt = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch { throw new Error('تعذّر الاتصال بالخادم'); }
  let data = {}; try { data = await res.json(); } catch { /* */ }
  if (!res.ok) { const e = new Error(data.error || 'حدث خطأ'); e.status = res.status; throw e; }
  return data;
};

// رفع مباشر إلى التخزين: (1) رابط موقّع من الخادم (2) PUT للملف (3) تأكيد الملفات
A.uploadFiles = async function uploadFiles(listingId, files, onProgress) {
  const { uploads } = await A.api(`/api/listings/${listingId}/uploads`, { method: 'POST', body: { files: files.map((f) => ({ mime: f.type, size: f.size })) } });
  const total = files.reduce((s, f) => s + f.size, 0) || 1; let done = 0;
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i]; const f = files[i];
    await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(u.method || 'PUT', u.upload_url);
      for (const [k, v] of Object.entries(u.headers || {})) x.setRequestHeader(k, v);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress((done + e.loaded) / total);
      x.onload = () => (x.status < 300 ? resolve() : reject(new Error('تعذّر رفع الملف')));
      x.onerror = () => reject(new Error('تعذّر الاتصال بخادم التخزين'));
      x.send(f);
    });
    done += f.size;
  }
  return A.api(`/api/listings/${listingId}/media`, { method: 'POST', body: { paths: uploads.map((u) => u.path) } });
};

let toastTimer;
A.toast = function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
};

A.sheet = function sheet(...content) {
  const prev = document.activeElement;
  const close = () => { scrim.remove(); if (prev && prev.focus) prev.focus(); };
  const sh = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, ...content);
  const scrim = h('div', { class: 'scrim', onclick: (e) => e.target === scrim && close() }, sh);
  scrim.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(scrim);
  const f = sh.querySelector('button,input,select'); if (f) f.focus();
  return { close, el: sh };
};

A.fmtPrice = (l) => Number(l.price).toLocaleString('ar-SA-u-nu-latn') + ' ر.س' + (l.kind === 'rent' ? ' / سنة' : '');
A.floorLabel = (n) => (n == null ? '' : n === 0 ? 'الدور الأرضي' : ['', 'الدور الأول', 'الدور الثاني', 'الدور الثالث', 'الدور الرابع', 'الدور الخامس'][n] || 'الدور ' + n);
A.entranceLabel = (e) => (e === 'private' ? 'مدخل خاص' : e === 'shared' ? 'مدخل مشترك' : '');
A.kindLabel = (k) => (k === 'rent' ? 'إيجار' : 'بيع');
A.statusLabel = (s) => ({ draft: 'مسودة', pending: 'قيد المراجعة', published: 'منشور', rejected: 'مرفوض', paused: 'موقوف مؤقتاً', suspended: 'أوقفته الإدارة', expired: 'الترخيص منتهٍ' }[s] || s);

A.field = function field(label, input) {
  return h('div', { class: 'field' }, h('label', {}, label), input);
};
A.requireLogin = function requireLogin(msg = 'سجّل الدخول للمتابعة') {
  if (A.user) return true;
  A.toast(msg); location.hash = '#/login';
  return false;
};
A.refreshMe = async function refreshMe() {
  try {
    const d = await A.api('/api/me');
    A.user = d.user; A.plan = d.plan; A.unread = d.unread || 0;
  } catch { A.user = null; }
  A.renderTabs();
};

A.share = async function share(l) {
  const url = location.origin + '/#/l/' + l.id;
  try {
    if (navigator.share) await navigator.share({ title: l.title, url });
    else { await navigator.clipboard.writeText(url); A.toast('تم نسخ الرابط'); }
  } catch { /* أُلغيت المشاركة */ }
};

// ====== الشريط السفلي ======
A.renderTabs = function renderTabs() {
  const cur = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'feed';
  const defs = [['feed', 'الرئيسية', 'home'], ['map', 'الخريطة', 'map'], ['publish', 'نشر', 'plus'], ['saved', 'المحفوظات', 'bookmark'], ['me', A.user ? 'حسابي' : 'دخول', 'user']];
  const nav = document.getElementById('tabs'); nav.replaceChildren();
  for (const [key, label, ic] of defs) {
    const on = cur === key || (key === 'feed' && cur === 'l');
    nav.append(h('button', { class: on ? 'on' : '', 'aria-label': label, 'aria-current': on ? 'page' : null, onclick: () => (location.hash = '#/' + key) },
      A.icon(ic), label, key === 'me' && A.unread ? h('span', { class: 'badge-dot' }, A.unread) : null));
  }
};
