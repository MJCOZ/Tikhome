'use strict';
const { api } = A; // h معرّفة في core.js
const root = document.getElementById('root');

// ====== دخول المدير ======
function loginView(msg) {
  const phone = h('input', { type: 'tel', autocomplete: 'username', placeholder: '05xxxxxxxx' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'err', role: 'alert' }, msg || '');
  const form = h('form', { class: 'card loginbox' }, h('h1', {}, 'Tikhome — لوحة التحكم'), A.field('رقم الجوال', phone), A.field('كلمة السر', pass), err, h('button', { class: 'btn', type: 'submit' }, 'دخول'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/auth/login', { method: 'POST', body: { phone: phone.value, password: pass.value } }); start(); } catch (ex) { err.textContent = ex.message; }
  });
  root.replaceChildren(form);
}

// ====== أدوات الجداول ======
const table = (heads, rows) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))), h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))) : h('tr', {}, h('td', { colspan: heads.length }, 'لا توجد بيانات')))));
// إصدار رمز استعادة كلمة السر وإرساله للمستخدم عبر واتساب
async function issueResetCode(u) {
  if (!confirm(`إصدار رمز استعادة كلمة السر لـ ${u.name} (${u.phone})؟ تأكد أن الطلب من صاحب الرقم نفسه.`)) return;
  const d = await api(`/api/admin/users/${u.id}/reset-code`, { method: 'POST' });
  const s = A.sheet(h('h3', {}, 'رمز الاستعادة'),
    h('div', { class: 'muted' }, `أرسل هذا الرمز إلى ${u.phone} فقط. صالح ${d.expires_minutes} دقيقة ولمرة واحدة.`),
    h('div', { style: { fontSize: '32px', fontWeight: 800, letterSpacing: '6px', textAlign: 'center', direction: 'ltr' } }, d.code),
    h('a', { class: 'btn', href: d.whatsapp_url, target: '_blank', rel: 'noopener' }, 'إرسال عبر واتساب'),
    h('button', { class: 'btn sec', onclick: () => s.close() }, 'إغلاق'));
}
const btn = (label, fn, cls = 'sec') => h('button', { class: 'btn ' + cls, onclick: async (e) => { e.currentTarget.disabled = true; try { await fn(); } catch (ex) { A.toast(ex.message); } refresh(); } }, label);
const post = (path, body) => api(path, { method: 'POST', body });
const money = (n) => Number(n).toLocaleString('ar-SA-u-nu-latn');

// ====== التبويبات ======
const TABS = {
  stats: ['الإحصائيات', async () => {
    const s = await api('/api/admin/stats');
    const st = (k, v) => h('div', { class: 'stat' }, h('small', {}, k), h('b', {}, v));
    const L = s.listings;
    return h('div', {},
      h('div', { class: 'stats' }, st('المستخدمون', s.users), st('مستخدمون جدد (7 أيام)', s.new_users_7d), st('ملاك موثّقون', s.verified_owners), st('طلبات توثيق', s.verify_requests),
        st('إعلانات منشورة', L.published || 0), st('بانتظار المراجعة', L.pending || 0), st('منتهية الترخيص', L.expired || 0), st('إجمالي المشاهدات', money(s.views)),
        st('طلبات تواصل (30 يوماً)', s.contacts_30d), st('بلاغات مفتوحة', s.open_reports), st('تراخيص تنتهي خلال 14 يوماً', s.expiring_14d)),
      h('h2', {}, 'أكثر الأحياء إعلانات'), table(['المدينة', 'الحي', 'عدد الإعلانات'], s.top_districts.map((d) => [d.city, d.district, d.n])));
  }],
  review: ['المراجعة', async () => {
    const d = await api('/api/admin/listings?status=pending');
    return h('div', {}, h('h2', {}, 'إعلانات بانتظار الموافقة'), listingsTable(d.listings, true));
  }],
  listings: ['كل الإعلانات', async () => {
    const status = TABS.listings.status || '';
    const d = await api('/api/admin/listings' + (status ? '?status=' + status : ''));
    const sel = h('select', { onchange: (e) => { TABS.listings.status = e.target.value; refresh(); } }, [['', 'الكل'], ['published', 'منشور'], ['pending', 'قيد المراجعة'], ['rejected', 'مرفوض'], ['paused', 'أوقفه المالك'], ['suspended', 'أوقفته الإدارة'], ['expired', 'منتهٍ']].map(([v, t]) => h('option', { value: v, selected: v === status }, t)));
    return h('div', {}, A.field('الحالة', sel), listingsTable(d.listings, false));
  }],
  users: ['المستخدمون', async () => {
    const d = await api('/api/admin/users');
    return table(['الاسم', 'الجوال', 'الدور', 'الحالة', 'إعلانات', 'إجراءات'], d.users.map((u) => [
      u.name, u.phone, u.role === 'admin' ? 'مدير' : 'مستخدم',
      [u.verified ? 'موثّق' : u.verify_requested ? 'طلب توثيق' : 'غير موثّق', u.banned ? ' · موقوف' : ''].join(''), u.listings_count,
      h('div', { class: 'acts' },
        !u.verified ? btn('توثيق', () => post(`/api/admin/users/${u.id}/verify`), '') : btn('إلغاء التوثيق', () => post(`/api/admin/users/${u.id}/unverify`)),
        u.banned ? btn('رفع الإيقاف', () => post(`/api/admin/users/${u.id}/unban`)) : btn('إيقاف', () => post(`/api/admin/users/${u.id}/ban`), 'danger'),
        btn('رمز استعادة', () => issueResetCode(u)),
        u.role === 'admin' ? btn('إزالة صلاحية المدير', () => post(`/api/admin/users/${u.id}/demote`)) : btn('ترقية لمدير', () => confirm('منح صلاحيات المدير الكاملة لهذا المستخدم؟') && post(`/api/admin/users/${u.id}/promote`)))]));
  }],
  reports: ['البلاغات', async () => {
    const d = await api('/api/admin/reports');
    return table(['الإعلان', 'السبب', 'التاريخ', 'الحالة', 'إجراءات'], d.reports.map((r) => [`#${r.listing_id} ${r.title}`, r.reason, r.created_at, r.status === 'open' ? 'مفتوح' : 'مغلق',
      h('div', { class: 'acts' }, r.status === 'open' ? btn('إغلاق', () => post(`/api/admin/reports/${r.id}/close`)) : null,
        btn('إيقاف الإعلان', () => post(`/api/admin/listings/${r.listing_id}/takedown`), 'danger'))]));
  }],
  plans: ['الباقات والاشتراكات', async () => {
    const [p, s, pay] = await Promise.all([api('/api/admin/plans'), api('/api/admin/subscriptions'), api('/api/admin/payments')]);
    const name = h('input', { placeholder: 'اسم الباقة' }); const price = h('input', { type: 'number', placeholder: 'السعر ر.س' });
    const max = h('input', { type: 'number', placeholder: 'أقصى عدد إعلانات' }); const feat = h('input', { type: 'number', placeholder: 'أيام التمييز' });
    const phone = h('input', { placeholder: 'جوال المشترك 05xxxxxxxx' }); const plan = h('select', {}, p.plans.map((x) => h('option', { value: x.id }, x.name)));
    const days = h('input', { type: 'number', placeholder: 'المدة بالأيام', value: 30 });
    const inline = (pl, key) => { const i = h('input', { type: 'number', value: pl[key], style: { width: '90px' } }); i.addEventListener('change', async () => { try { await api('/api/admin/plans/' + pl.id, { method: 'PUT', body: { [key]: Number(i.value) } }); A.toast('تم الحفظ'); } catch (e) { A.toast(e.message); } }); return i; };
    return h('div', {},
      h('h2', {}, 'الباقات'), h('div', { class: 'muted' }, 'عدّل السعر والحدود مباشرة في الجدول. الباقة التي سعرها أكبر من صفر يدفعها المستخدم عبر ميسّر وتُفعَّل تلقائياً، ويمكنك أيضاً التفعيل اليدوي من النموذج بالأسفل.'),
      table(['الباقة', 'السعر (ر.س)', 'المدة (أيام)', 'أقصى إعلانات', 'أيام التمييز', 'مفعّلة'], p.plans.map((x) => [x.name, inline(x, 'price_sar'), inline(x, 'duration_days'), inline(x, 'max_listings'), inline(x, 'featured_days'),
        btn(x.active ? 'نعم' : 'لا', () => api('/api/admin/plans/' + x.id, { method: 'PUT', body: { active: !x.active } }))])),
      h('h2', {}, 'إضافة باقة'), h('div', { class: 'card' }, h('div', { class: 'grid2' }, name, price, max, feat), btn('إضافة', async () => { await post('/api/admin/plans', { name: name.value, price_sar: price.value, max_listings: max.value, featured_days: feat.value }); }, '')),
      h('h2', {}, 'تفعيل اشتراك لمستخدم'), h('div', { class: 'card' }, h('div', { class: 'grid2' }, phone, plan, days), btn('تفعيل', async () => { const r = await post('/api/admin/subscriptions', { phone: phone.value, plan_id: plan.value, days: days.value }); A.toast('يسري حتى ' + r.ends_at); }, '')),
      h('h2', {}, 'المدفوعات (ميسّر)'), table(['المستخدم', 'الجوال', 'الباقة', 'المبلغ', 'الحالة', 'رقم الفاتورة', 'التاريخ'], pay.payments.map((x) => [x.user_name, x.phone, x.plan_name, money(x.amount_halalas / 100) + ' ر.س',
        ({ initiated: 'بانتظار الدفع', paid: 'مدفوع', failed: 'فشل', expired: 'منتهٍ' })[x.status] || x.status, x.provider_id || '-', String(x.created_at).slice(0, 16).replace('T', ' ')])),
      h('h2', {}, 'الاشتراكات'), table(['المستخدم', 'الجوال', 'الباقة', 'من', 'إلى'], s.subscriptions.map((x) => [x.user_name, x.phone, x.plan_name, x.starts_at, x.ends_at])));
  }],
  settings: ['الإعدادات', async () => {
    const { settings: s } = await api('/api/admin/settings');
    const inputs = {};
    const row = (key, label, type = 'text') => { inputs[key] = type === 'select' ? h('select', {}, [['1', 'نعم'], ['0', 'لا']].map(([v, t]) => h('option', { value: v, selected: s[key] === v }, t))) : key === 'whatsapp_template' ? h('textarea', { rows: 3 }, s[key]) : h('input', { type, value: s[key] ?? '', inputmode: type === 'tel' ? 'numeric' : null, placeholder: type === 'tel' ? '05xxxxxxxx' : null }); if (key === 'whatsapp_template') inputs[key].value = s[key]; return A.field(label, inputs[key]); };
    return h('div', { class: 'card' },
      row('require_review', 'مراجعة كل إعلان قبل النشر', 'select'), row('allow_registration', 'السماح بالتسجيل الجديد', 'select'),
      row('license_warning_days', 'التنبيه قبل انتهاء الترخيص (أيام)'), row('max_video_mb', 'أقصى حجم للفيديو (ميغابايت)'), row('max_photos', 'أقصى عدد صور للإعلان'),
      row('whatsapp_template', 'رسالة واتساب الجاهزة (المتغيرات: {title} {district} {license})'),
      row('support_whatsapp', 'رقم واتساب الدعم (يتواصل معه من نسي كلمة السر)', 'tel'),
      btn('حفظ الإعدادات', async () => { await api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) }); A.toast('تم الحفظ'); }, ''));
  }],
  audit: ['السجل', async () => {
    const d = await api('/api/admin/audit');
    return table(['التاريخ', 'المدير', 'الإجراء', 'الهدف'], d.log.map((x) => [x.created_at, x.admin_name || '-', x.action, x.target]));
  }]
};

function listingsTable(rows, review) {
  return table(['الإعلان', 'المعلن', 'الترخيص', 'الوسائط', 'الحالة', 'إجراءات'], rows.map((l) => [
    h('div', {}, h('b', {}, `#${l.id} ${l.title}`), h('div', { class: 'muted' }, `${A.kindLabel(l.kind)} · ${l.city} / ${l.district}`, h('br'), A.fmtPrice(l), h('br'), [A.floorLabel(l.floor), A.entranceLabel(l.entrance)].filter(Boolean).join(' · '))),
    h('div', {}, l.owner_name, h('div', { class: 'muted' }, l.owner_phone, l.owner_verified ? ' · موثّق' : '')),
    h('div', {}, l.license_no, h('div', { class: 'muted' }, 'ينتهي ' + l.license_expires)),
    h('div', { class: 'thumbrow' }, l.media.map((m) => m.mime.startsWith('video/') ? h('video', { src: m.url, controls: true, preload: 'metadata', playsinline: true }) : h('img', { src: m.url, alt: '' }))),
    h('div', {}, h('span', { class: 'status ' + l.status }, A.statusLabel(l.status)), l.reject_reason ? h('div', { class: 'muted' }, l.reject_reason) : null, h('div', { class: 'muted' }, `مشاهدات ${l.views} · تواصل ${l.contacts}`)),
    h('div', { class: 'acts' },
      ['pending', 'rejected', 'paused', 'suspended'].includes(l.status) ? btn(l.status === 'suspended' ? 'رفع الإيقاف ونشر' : 'موافقة ونشر', () => post(`/api/admin/listings/${l.id}/approve`), '') : null,
      l.status !== 'rejected' ? btn('رفض', async () => { const reason = prompt('سبب الرفض (يصل للمالك):'); if (reason !== null) await post(`/api/admin/listings/${l.id}/reject`, { reason }); }, 'danger') : null,
      l.status === 'published' ? btn('إيقاف', () => post(`/api/admin/listings/${l.id}/takedown`)) : null,
      l.status === 'published' ? btn(l.featured ? 'إلغاء التمييز' : 'تمييز 7 أيام', () => post(`/api/admin/listings/${l.id}/feature`, { days: l.featured ? 0 : 7 })) : null,
      btn('حذف', () => confirm('حذف الإعلان نهائياً؟') && api('/api/listings/' + l.id, { method: 'DELETE' }), 'danger'))]));
}

let current = 'stats';
async function refresh() {
  const body = h('div', {}, 'جارٍ التحميل...');
  const tabs = h('div', { class: 'atabs', role: 'tablist' }, Object.entries(TABS).map(([k, [label]]) => h('button', { class: k === current ? 'on' : '', role: 'tab', 'aria-selected': String(k === current), onclick: () => { current = k; refresh(); } }, label)));
  root.replaceChildren(h('div', { class: 'atop' }, h('h1', { style: { margin: 0 } }, 'Tikhome — لوحة التحكم'),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost sm', href: '/' }, 'التطبيق'), btn('خروج', async () => { await post('/api/auth/logout'); loginView(); }, 'ghost'))), tabs, body);
  try { body.replaceChildren(await TABS[current][1]()); } catch (e) { body.textContent = e.message; }
}

async function start() {
  await A.refreshMe();
  if (!A.user) return loginView();
  if (A.user.role !== 'admin') return loginView('هذا الحساب ليس حساب مدير');
  refresh();
}
A.renderTabs = () => {};
start();
