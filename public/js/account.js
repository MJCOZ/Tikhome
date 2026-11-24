'use strict';

// ====== الدخول والتسجيل ======
A.renderLogin = function renderLogin(app) {
  app.replaceChildren();
  let mode = 'login';
  const err = h('div', { class: 'err', role: 'alert' });
  const phone = h('input', { type: 'tel', inputmode: 'numeric', autocomplete: 'username', placeholder: '05xxxxxxxx', maxlength: 14 });
  const name = h('input', { autocomplete: 'name', maxlength: 60 });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', minlength: 8 });
  const nameField = A.field('الاسم', name); nameField.style.display = 'none';
  const title = h('h1', {}, 'تسجيل الدخول');
  const btn = h('button', { class: 'btn', type: 'submit' }, 'دخول');
  const toggle = h('button', { class: 'btn ghost', type: 'button' }, 'ليس لديك حساب؟ سجّل الآن');
  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    nameField.style.display = mode === 'register' ? '' : 'none';
    title.textContent = mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب';
    btn.textContent = mode === 'login' ? 'دخول' : 'إنشاء الحساب';
    toggle.textContent = mode === 'login' ? 'ليس لديك حساب؟ سجّل الآن' : 'لديك حساب؟ سجّل الدخول';
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  });
  const form = h('form', { class: 'card' }, A.field('رقم الجوال', phone), nameField, A.field('كلمة السر (8 أحرف على الأقل)', pass), err, btn, toggle);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      await A.api('/api/auth/' + mode, { method: 'POST', body: { phone: phone.value, name: name.value, password: pass.value } });
      await A.refreshMe(); location.hash = '#/feed';
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  });
  app.append(h('div', { class: 'page' }, title, h('div', { class: 'muted' }, 'رقم جوالك لا يظهر للباحثين، ويتم التواصل عبر واتساب برسالة جاهزة.'), form));
};

// ====== بطاقة إعلان المالك ======
function myCard(l, reload) {
  const act = async (path, method = 'POST', body) => { try { await A.api(path, { method, body }); reload(); } catch (e) { A.toast(e.message); } };
  const renew = () => {
    const d = h('input', { type: 'date', min: new Date().toISOString().slice(0, 10), value: l.license_expires });
    const no = h('input', { value: l.license_no, maxlength: 40 });
    const s = A.sheet(h('h3', {}, 'تجديد الترخيص'), A.field('رقم الترخيص', no), A.field('تاريخ الانتهاء الجديد', d),
      h('button', { class: 'btn', onclick: async () => {
        try { await A.api('/api/listings/' + l.id, { method: 'PUT', body: { license_no: no.value, license_expires: d.value } }); s.close(); A.toast('تم التحديث، أرسل الإعلان للمراجعة'); reload(); } catch (e) { A.toast(e.message); }
      } }, 'حفظ'));
  };
  const thumb = l.media_type === 'photos' && l.media[0] ? h('img', { src: l.media[0].url, alt: '', style: { width: '64px', height: '84px', objectFit: 'cover', borderRadius: '10px' } }) : null;
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `${l.title} · ${l.district}`), h('span', { class: 'status ' + l.status }, A.statusLabel(l.status))),
    h('div', { class: 'row' }, thumb, h('div', { class: 'muted' }, A.fmtPrice(l), h('br'), `المشاهدات: ${l.views ?? 0} · طلبات التواصل: ${l.contacts ?? 0}`, h('br'), `ينتهي الترخيص: ${l.license_expires}`)),
    l.status === 'rejected' && l.reject_reason ? h('div', { class: 'err' }, 'سبب الرفض: ' + l.reject_reason) : null,
    l.status === 'suspended' ? h('div', { class: 'err' }, 'أوقفت الإدارة هذا الإعلان. تواصل مع الدعم لمعرفة السبب.') : null,
    l.status === 'draft' && !l.media.length ? h('div', { class: 'muted' }, 'الإعلان بلا فيديو أو صور. احذفه وأنشئ إعلاناً جديداً، أو أكمل الرفع من التطبيق.') : null,
    h('div', { class: 'row' },
      ['draft', 'rejected', 'paused'].includes(l.status) && l.media.length ? h('button', { class: 'btn sm', onclick: () => act(`/api/listings/${l.id}/${l.status === 'paused' ? 'resume' : 'submit'}`) }, l.status === 'paused' ? 'استئناف' : 'إرسال للمراجعة') : null,
      l.status === 'published' ? h('button', { class: 'btn sec sm', onclick: () => act(`/api/listings/${l.id}/pause`) }, 'إيقاف مؤقت') : null,
      l.status === 'published' ? h('button', { class: 'btn ghost sm', onclick: () => (location.hash = '#/l/' + l.id) }, 'عرض') : null,
      ['expired', 'published', 'rejected', 'draft', 'paused'].includes(l.status) ? h('button', { class: 'btn sec sm', onclick: renew }, 'تجديد الترخيص') : null,
      h('button', { class: 'btn danger sm', onclick: () => confirm('حذف الإعلان نهائياً؟') && act('/api/listings/' + l.id, 'DELETE') }, 'حذف')));
}

// ====== حسابي ======
A.renderMe = async function renderMe(app) {
  app.replaceChildren();
  if (!A.user) return A.renderLogin(app);
  const page = h('div', { class: 'page' }); app.append(page);
  async function load() {
    const [mine, notes] = await Promise.all([A.api('/api/my/listings'), A.api('/api/notifications')]);
    await A.refreshMe();
    page.replaceChildren(
      h('h1', {}, A.user.name),
      h('div', { class: 'muted' }, `${A.user.phone} · ${A.user.verified ? 'مالك موثّق' : 'غير موثّق'} · الباقة: ${A.plan ? A.plan.name : '-'}`),
      h('div', { class: 'row', style: { margin: '12px 0' } },
        A.user.role === 'admin' ? h('a', { class: 'btn sm', href: '/admin' }, 'لوحة التحكم') : null,
        !A.user.verified && !A.user.verify_requested ? h('button', { class: 'btn sec sm', onclick: async () => { await A.api('/api/me/verify-request', { method: 'POST' }); A.toast('وصل طلب التوثيق'); load(); } }, 'اطلب توثيق حسابي') : null,
        A.user.verify_requested && !A.user.verified ? h('span', { class: 'tag' }, 'طلب التوثيق قيد المراجعة') : null,
        h('button', { class: 'btn ghost sm', onclick: pwd }, 'تغيير كلمة السر'),
        h('button', { class: 'btn danger sm', onclick: async () => { await A.api('/api/auth/logout', { method: 'POST' }); A.user = null; A.renderTabs(); location.hash = '#/feed'; } }, 'خروج')),
      h('h2', {}, 'الإشعارات'),
      notes.notifications.length ? h('div', { class: 'card' }, notes.notifications.slice(0, 8).map((n) => h('div', { class: 'muted' }, '• ' + n.text))) : h('div', { class: 'muted' }, 'لا توجد إشعارات.'),
      h('h2', {}, 'إعلاناتي'),
      mine.listings.length ? mine.listings.map((l) => myCard(l, load)) : h('div', { class: 'card' }, h('div', { class: 'muted' }, 'لم تنشر إعلاناً بعد.'), h('button', { class: 'btn', onclick: () => (location.hash = '#/publish') }, 'انشر أول إعلان')));
  }
  function pwd() {
    const o = h('input', { type: 'password', autocomplete: 'current-password' }); const n = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const s = A.sheet(h('h3', {}, 'تغيير كلمة السر'), A.field('الحالية', o), A.field('الجديدة (8 أحرف على الأقل)', n),
      h('button', { class: 'btn', onclick: async () => { try { await A.api('/api/me/password', { method: 'POST', body: { old_password: o.value, new_password: n.value } }); A.toast('تم التغيير'); s.close(); } catch (e) { A.toast(e.message); } } }, 'حفظ'));
  }
  try { await load(); } catch (e) { A.toast(e.message); }
};

// ====== المحفوظات ======
A.renderSaved = async function renderSaved(app) {
  app.replaceChildren();
  if (!A.user) return app.append(h('div', { class: 'empty' }, h('div', { style: { fontWeight: 700, fontSize: '18px' } }, 'المحفوظات'), h('div', {}, 'سجّل الدخول لتحفظ العقارات وتصلك تنبيهات البحث.'), h('button', { class: 'btn', onclick: () => (location.hash = '#/login') }, 'تسجيل الدخول')));
  const page = h('div', { class: 'page' }); app.append(page);
  async function load() {
    const [s, q] = await Promise.all([A.api('/api/saves'), A.api('/api/searches')]);
    const label = (j) => { const o = JSON.parse(j); return [o.kind && A.kindLabel(o.kind), o.city, o.district, o.min && 'من ' + o.min, o.max && 'إلى ' + o.max, o.beds && o.beds + '+ غرف'].filter(Boolean).join(' · '); };
    page.replaceChildren(h('h1', {}, 'المحفوظات'),
      s.listings.length ? s.listings.map((l) => h('button', { class: 'card', style: { textAlign: 'right', flexDirection: 'row', alignItems: 'center' }, onclick: () => (location.hash = '#/l/' + l.id) },
        l.media[0] && l.media_type === 'photos' ? h('img', { src: l.media[0].url, alt: '', style: { width: '64px', height: '84px', objectFit: 'cover', borderRadius: '10px' } }) : h('div', { class: 'ph', style: { position: 'static', width: '64px', height: '84px', borderRadius: '10px', flex: 'none' } }),
        h('div', { class: 'muted' }, h('b', { style: { color: 'var(--ink)', fontSize: '15px' } }, `${l.title} · ${l.district}`), h('br'), [A.floorLabel(l.floor), A.entranceLabel(l.entrance)].filter(Boolean).join(' · '), h('br'), h('span', { class: 'price', style: { fontSize: '16px' } }, A.fmtPrice(l)))))
        : h('div', { class: 'card muted' }, 'لم تحفظ عقاراً بعد. اضغط على القلب في أي إعلان ليظهر هنا.'),
      h('h2', {}, 'عمليات البحث المحفوظة'),
      q.searches.length ? q.searches.map((x) => h('div', { class: 'card', style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } }, h('span', { class: 'muted' }, label(x.query)),
        h('button', { class: 'btn danger sm', onclick: async () => { await A.api('/api/searches/' + x.id, { method: 'DELETE' }); load(); } }, 'حذف'))) : h('div', { class: 'muted' }, 'احفظ بحثاً من زر التصفية وسيصلك تنبيه عند نشر عقار مطابق.'));
  }
  try { await load(); } catch (e) { A.toast(e.message); }
};
