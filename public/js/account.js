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
  const forgot = h('button', { class: 'btn ghost', type: 'button', onclick: () => A.renderForgot(app, phone.value) }, 'نسيت كلمة السر؟');
  const form = h('form', { class: 'card' }, A.field('رقم الجوال', phone), nameField, A.field('كلمة السر (8 أحرف على الأقل)', pass), err, btn, toggle, forgot);
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

// ====== ملف المعلن العام بأسلوب تيك توك ======
A.renderProfile = async function renderProfile(app, id) {
  app.replaceChildren();
  const page = h('div', { class: 'page profile' }, h('div', { class: 'muted' }, 'جارٍ التحميل...'));
  app.append(page);
  let d;
  try { d = await A.api('/api/users/' + id); } catch (e) {
    page.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'الحساب غير موجود'), h('button', { class: 'btn sec', onclick: () => history.back() }, 'رجوع')));
    return;
  }
  const p = d.profile; const st = d.stats;
  const stat = (n, label) => h('div', { class: 'pstat' }, h('b', {}, A.compact(n)), h('small', {}, label));
  const tile = (l) => {
    const m = l.media[0]; const src = m && (l.media_type === 'photos' ? m.url : m.poster);
    return h('button', { class: 'ptile', type: 'button', 'aria-label': l.title, onclick: () => { location.hash = '#/l/' + l.id; } },
      src ? h('img', { src, alt: '', loading: 'lazy' }) : h('div', { class: 'ph' }),
      l.media_type === 'video' ? h('span', { class: 'pvid' }, A.icon('play')) : null,
      h('div', { class: 'pmeta' }, h('span', {}, A.icon('heart'), A.compact(l.like_count)), h('span', {}, A.compact(l.comment_count), ' 💬')),
      h('div', { class: 'pprice' }, A.shortPrice ? A.shortPrice(l.price) : l.price));
  };
  page.replaceChildren(
    h('div', { class: 'phead' },
      h('button', { class: 'btn ghost sm pback', type: 'button', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/feed')) }, '→ رجوع'),
      A.avatar(p.name, 'xl'),
      h('h1', {}, p.name, p.verified ? h('span', { class: 'vbadge' }, '✓') : null),
      p.verified ? h('div', { class: 'tag g' }, 'مالك موثّق') : null,
      p.bio ? h('div', { class: 'pbio' }, p.bio) : null,
      h('div', { class: 'pstats' }, stat(st.listings, 'إعلان'), stat(st.likes, 'إعجاب'), stat(st.comments, 'تعليق'), stat(st.views, 'مشاهدة')),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        p.is_me ? h('button', { class: 'btn sec sm', onclick: () => A.editProfile(() => A.renderProfile(app, id)) }, 'تعديل الملف') : null,
        h('button', { class: 'btn ghost sm', onclick: async () => {
          const url = location.origin + '/#/u/' + p.id;
          try { if (navigator.share) await navigator.share({ title: p.name, url }); else { await navigator.clipboard.writeText(url); A.toast('تم نسخ رابط الملف'); } } catch { /* */ }
        } }, 'مشاركة الملف'))),
    d.listings.length ? h('div', { class: 'pgrid' }, d.listings.map(tile))
      : h('div', { class: 'muted', style: { textAlign: 'center', padding: '30px 0' } }, p.is_me ? 'لم تنشر إعلاناً بعد.' : 'لا توجد إعلانات منشورة حالياً.'));
};

A.editProfile = function editProfile(done) {
  const name = h('input', { maxlength: 60, value: A.user.name });
  const bio = h('textarea', { rows: 3, maxlength: 300, placeholder: 'مثال: مكتب عقاري في شمال الرياض، شقق وفلل للإيجار والبيع' });
  bio.value = A.user.bio || '';
  const s = A.sheet(h('h3', {}, 'تعديل الملف العام'), A.field('الاسم الظاهر', name), A.field('نبذة (تظهر في ملفك)', bio),
    h('button', { class: 'btn', onclick: async () => {
      try { await A.api('/api/me/profile', { method: 'PUT', body: { name: name.value, bio: bio.value } }); await A.refreshMe(); A.toast('تم الحفظ'); s.close(); if (done) done(); } catch (e) { A.toast(e.message); }
    } }, 'حفظ'));
};

// ====== نسيت كلمة السر: التواصل مع الدعم ثم إدخال الرمز ======
A.renderForgot = async function renderForgot(app, initialPhone = '') {
  app.replaceChildren();
  const err = h('div', { class: 'err', role: 'alert' });
  const phone = h('input', { type: 'tel', inputmode: 'numeric', placeholder: '05xxxxxxxx', maxlength: 14, value: initialPhone });
  const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '6 أرقام', style: { letterSpacing: '4px', textAlign: 'center' } });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'تغيير كلمة السر');
  let support = null;
  try { support = (await A.api('/api/auth/support')).whatsapp; } catch { /* */ }
  const ask = support
    ? h('a', { class: 'btn sec', target: '_blank', rel: 'noopener', onclick: (e) => { e.currentTarget.href = `https://wa.me/${support}?text=${encodeURIComponent('نسيت كلمة السر في Tikhome. رقم حسابي: ' + (phone.value || ''))}`; } , href: '#' }, 'اطلب رمزاً من الدعم عبر واتساب')
    : h('div', { class: 'muted' }, 'تواصل مع إدارة المنصة لطلب رمز الاستعادة.');
  const form = h('form', { class: 'card' }, A.field('رقم الجوال', phone), ask,
    A.field('رمز الاستعادة', code), A.field('كلمة السر الجديدة (8 أحرف على الأقل)', pass), err, btn,
    h('button', { class: 'btn ghost', type: 'button', onclick: () => A.renderLogin(app) }, 'رجوع لتسجيل الدخول'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      await A.api('/api/auth/reset', { method: 'POST', body: { phone: phone.value, code: code.value, new_password: pass.value } });
      await A.refreshMe(); A.toast('تم تغيير كلمة السر'); location.hash = '#/feed';
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  });
  app.append(h('div', { class: 'page' }, h('h1', {}, 'استعادة كلمة السر'),
    h('div', { class: 'muted' }, 'لأمان حسابك، يرسل لك فريق الدعم رمزاً من 6 أرقام على واتساب رقمك المسجّل.'), form));
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
  const thumbUrl = l.media[0] && (l.media_type === 'photos' ? l.media[0].url : l.media[0].poster);
  const thumb = thumbUrl ? h('img', { src: thumbUrl, alt: '', style: { width: '64px', height: '84px', objectFit: 'cover', borderRadius: '10px' } }) : null;
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `${l.title} · ${l.district}`), h('span', { class: 'status ' + l.status }, A.statusLabel(l.status))),
    h('div', { class: 'row' }, thumb, h('div', { class: 'muted' }, A.fmtPrice(l), h('br'), `المشاهدات: ${l.views ?? 0} · الإعجابات: ${l.like_count ?? 0} · التعليقات: ${l.comment_count ?? 0} · طلبات التواصل: ${l.contacts ?? 0}`, h('br'), `ينتهي الترخيص: ${l.license_expires}`)),
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
        h('button', { class: 'btn sm', onclick: () => (location.hash = '#/u/' + A.user.id) }, 'ملفي العام'),
        h('button', { class: 'btn sec sm', onclick: () => A.editProfile(load) }, 'تعديل الملف'),
        h('button', { class: 'btn ghost sm', onclick: pwd }, 'تغيير كلمة السر'),
        h('button', { class: 'btn danger sm', onclick: async () => { await A.api('/api/auth/logout', { method: 'POST' }); A.user = null; A.renderTabs(); location.hash = '#/feed'; } }, 'خروج')),
      plansSection(),
      h('h2', {}, 'الإشعارات'),
      notes.notifications.length ? h('div', { class: 'card' }, notes.notifications.slice(0, 8).map((n) => h('div', { class: 'muted' }, '• ' + n.text))) : h('div', { class: 'muted' }, 'لا توجد إشعارات.'),
      h('h2', {}, 'إعلاناتي'),
      mine.listings.length ? mine.listings.map((l) => myCard(l, load)) : h('div', { class: 'card' }, h('div', { class: 'muted' }, 'لم تنشر إعلاناً بعد.'), h('button', { class: 'btn', onclick: () => (location.hash = '#/publish') }, 'انشر أول إعلان')));
  }
  function plansSection() {
    const box = h('div');
    (async () => {
      try {
        const [{ plans }, { subscription }] = await Promise.all([A.api('/api/plans'), A.api('/api/billing/subscription')]);
        const paid = plans.filter((p) => p.price_sar > 0);
        if (!paid.length) return;
        box.replaceChildren(h('div', {}, h('h2', {}, 'الباقات'),
          subscription ? h('div', { class: 'muted' }, `باقتك الحالية: ${subscription.name} حتى ${subscription.ends_at}`) : null,
          paid.map((p) => h('div', { class: 'card' },
            h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, p.name), h('span', { class: 'price', style: { fontSize: '18px' } }, `${p.price_sar} ر.س`)),
            h('div', { class: 'muted' }, `حتى ${p.max_listings} إعلان · ${p.duration_days || 30} يوماً${p.featured_days ? ` · تمييز ${p.featured_days} أيام` : ''}`),
            A.config.payments ? h('button', { class: 'btn sm', onclick: async (e) => {
              e.currentTarget.disabled = true;
              try { const d = await A.api('/api/billing/checkout', { method: 'POST', body: { plan_id: p.id } }); location.href = d.url; } catch (ex) { A.toast(ex.message); e.currentTarget.disabled = false; }
            } }, subscription && subscription.plan_id === p.id ? 'تجديد' : 'اشترك الآن')
              : h('div', { class: 'muted' }, 'الدفع الإلكتروني غير مفعّل بعد. تواصل مع الإدارة للاشتراك.')))));
      } catch { /* */ }
    })();
    return box;
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
        l.media[0] && (l.media_type === 'photos' || l.media[0].poster) ? h('img', { src: l.media_type === 'photos' ? l.media[0].url : l.media[0].poster, alt: '', style: { width: '64px', height: '84px', objectFit: 'cover', borderRadius: '10px' } }) : h('div', { class: 'ph', style: { position: 'static', width: '64px', height: '84px', borderRadius: '10px', flex: 'none' } }),
        h('div', { class: 'muted' }, h('b', { style: { color: 'var(--ink)', fontSize: '15px' } }, `${l.title} · ${l.district}`), h('br'), [A.floorLabel(l.floor), A.entranceLabel(l.entrance)].filter(Boolean).join(' · '), h('br'), h('span', { class: 'price', style: { fontSize: '16px' } }, A.fmtPrice(l)))))
        : h('div', { class: 'card muted' }, 'لم تحفظ عقاراً بعد. اضغط على القلب في أي إعلان ليظهر هنا.'),
      h('h2', {}, 'عمليات البحث المحفوظة'),
      q.searches.length ? q.searches.map((x) => h('div', { class: 'card', style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } }, h('span', { class: 'muted' }, label(x.query)),
        h('button', { class: 'btn danger sm', onclick: async () => { await A.api('/api/searches/' + x.id, { method: 'DELETE' }); load(); } }, 'حذف'))) : h('div', { class: 'muted' }, 'احفظ بحثاً من زر التصفية وسيصلك تنبيه عند نشر عقار مطابق.'));
  }
  try { await load(); } catch (e) { A.toast(e.message); }
};
