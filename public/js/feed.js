'use strict';

// ====== الفلاتر ======
A.filterCount = () => Object.values(A.filters).filter((v) => v !== '' && v != null).length;

A.openFilters = function openFilters(onApply) {
  const f = { ...A.filters };
  const pill = (key, val, label) => h('button', { class: 'pill' + (f[key] === val ? ' on' : ''), type: 'button', onclick: (e) => {
    f[key] = f[key] === val ? '' : val;
    [...e.target.parentNode.children].forEach((b) => b.classList.remove('on'));
    if (f[key]) e.target.classList.add('on');
  } }, label);
  const input = (key, ph, type = 'number') => h('input', { type, inputmode: type === 'number' ? 'numeric' : null, placeholder: ph, value: f[key] || '', oninput: (e) => (f[key] = e.target.value) });
  const s = A.sheet(
    h('h3', {}, 'تصفية العقارات'),
    A.field('نوع العرض', h('div', { class: 'pills' }, pill('kind', 'rent', 'إيجار'), pill('kind', 'sale', 'بيع'))),
    A.field('المدينة', input('city', 'مثال: الرياض', 'text')),
    A.field('الحي', input('district', 'اسم الحي', 'text')),
    h('div', { class: 'grid2' }, A.field('السعر من', input('min', 'ر.س')), A.field('السعر إلى', input('max', 'ر.س'))),
    A.field('عدد الغرف (على الأقل)', h('div', { class: 'pills' }, [1, 2, 3, 4, 5].map((n) => pill('beds', String(n), n + '+')))),
    A.field('الدور', h('div', { class: 'pills' }, [0, 1, 2, 3].map((n) => pill('floor', String(n), A.floorLabel(n))))),
    A.field('المدخل', h('div', { class: 'pills' }, pill('entrance', 'private', 'مدخل خاص'), pill('entrance', 'shared', 'مدخل مشترك'))),
    A.field('نوع المحتوى', h('div', { class: 'pills' }, pill('media', 'video', 'فيديو'), pill('media', 'photos', 'صور'))),
    h('div', { class: 'row' },
      h('button', { class: 'btn', style: { flex: 1 }, onclick: () => { A.filters = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null)); s.close(); onApply(); } }, 'عرض النتائج'),
      h('button', { class: 'btn sec', onclick: () => { A.filters = {}; s.close(); onApply(); } }, 'مسح')),
    h('button', { class: 'btn ghost', onclick: async () => {
      if (!A.requireLogin('سجّل الدخول لحفظ البحث')) return s.close();
      try { await A.api('/api/searches', { method: 'POST', body: f }); A.toast('حُفظ البحث وسيصلك تنبيه بالعقارات المطابقة'); s.close(); } catch (e) { A.toast(e.message); }
    } }, 'احفظ هذا البحث وأبلغني بالجديد'));
};

// ====== التواصل والتفاصيل والإبلاغ ======
A.openContact = async function openContact(l) {
  let d;
  try { d = await A.api(`/api/listings/${l.id}/contact`, { method: 'POST', body: { channel: 'whatsapp' } }); } catch (e) { return A.toast(e.message); }
  const s = A.sheet(
    h('h3', {}, 'تواصل مع المعلن'),
    h('div', { class: 'muted' }, 'ستُفتح محادثة واتساب برسالة جاهزة، يمكنك تعديلها قبل الإرسال:'),
    h('div', { class: 'msg' }, d.message),
    h('a', { class: 'btn', href: d.url, target: '_blank', rel: 'noopener', onclick: () => setTimeout(s.close, 200) }, 'افتح واتساب'),
    h('button', { class: 'btn sec', onclick: async () => {
      try { const c = await A.api(`/api/listings/${l.id}/contact`, { method: 'POST', body: { channel: 'call' } }); location.href = c.url; } catch (e) { A.toast(e.message); }
    } }, 'اتصال هاتفي'));
};

A.openReport = function openReport(l) {
  const ta = h('textarea', { rows: 3, maxlength: 500, placeholder: 'مثال: العقار مباع، السعر غير صحيح، الإعلان مضلل' });
  const s = A.sheet(h('h3', {}, 'إبلاغ عن الإعلان'), A.field('السبب', ta),
    h('button', { class: 'btn', onclick: async () => {
      try { await A.api(`/api/listings/${l.id}/report`, { method: 'POST', body: { reason: ta.value } }); A.toast('وصل بلاغك، شكراً لك'); s.close(); } catch (e) { A.toast(e.message); }
    } }, 'إرسال البلاغ'));
};

A.openDetails = function openDetails(l) {
  const spec = (k, v) => (v == null || v === '' ? null : h('div', { class: 'spec' }, h('small', {}, k), h('b', {}, v)));
  const s = A.sheet(
    h('h3', {}, `${l.title} · ${l.district}`),
    h('div', { class: 'specs' }, spec('المساحة', l.area && l.area + ' م²'), spec('الغرف', l.beds), spec('دورات المياه', l.baths),
      spec('الدور', A.floorLabel(l.floor)), spec('المدخل', A.entranceLabel(l.entrance)), spec('المدينة', l.city)),
    l.description ? h('div', { class: 'msg' }, l.description) : null,
    h('div', { class: 'muted' }, `المعلن: ${l.owner_name || 'مالك'}${l.owner_verified ? ' (موثّق)' : ''}`,
      h('br'), `ترخيص الإعلان: ${l.license_no} · ينتهي ${l.license_expires}`,
      h('br'), 'يُوقف الإعلان تلقائياً عند انتهاء الترخيص.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn sec sm', onclick: () => A.share(l) }, 'مشاركة الرابط'),
      h('button', { class: 'btn sec sm', onclick: () => { s.close(); A.openReport(l); } }, 'إبلاغ عن الإعلان')));
};

// ====== وضع العرض الكامل (مثل الريلز): إخفاء الأيقونات والنصوص والتبويبات ======
A.setClean = function setClean(on, item) {
  document.body.classList.toggle('clean', on);
  // نبقى على نفس الإعلان بعد تغيّر ارتفاع الشاشة
  if (item) requestAnimationFrame(() => item.scrollIntoView({ block: 'start' }));
};

// ====== التفاعل بأسلوب تيك توك ======
A.compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n || 0));
A.avatar = (name, cls = '') => h('span', { class: 'avatar ' + cls, 'aria-hidden': 'true' }, String(name || '؟').trim().charAt(0));

A.toggleLike = async function toggleLike(l, btn, count) {
  if (!A.requireLogin('سجّل الدخول للإعجاب بالعقار')) return;
  const was = l.liked;
  l.liked = !was; l.like_count += was ? -1 : 1; btn.classList.toggle('on', l.liked); count.textContent = A.compact(l.like_count);
  try {
    const d = await A.api(`/api/listings/${l.id}/like`, { method: was ? 'DELETE' : 'POST' });
    l.liked = d.liked; l.like_count = d.like_count;
  } catch (e) { l.liked = was; A.toast(e.message); }
  btn.classList.toggle('on', l.liked); count.textContent = A.compact(l.like_count);
};

A.timeAgo = (t) => {
  const s = Math.max(1, (Date.now() - new Date(t)) / 1000);
  if (s < 60) return 'الآن'; if (s < 3600) return `قبل ${Math.floor(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`; if (s < 2592000) return `قبل ${Math.floor(s / 86400)} يوم`;
  return new Date(t).toISOString().slice(0, 10);
};

A.openComments = function openComments(l, onCount) {
  const list = h('div', { class: 'clist' }, h('div', { class: 'muted' }, 'جارٍ التحميل...'));
  const title = h('h3', {}, 'التعليقات');
  const setCount = (n) => { l.comment_count = n; title.textContent = `التعليقات (${n})`; if (onCount) onCount(n); };
  const row = (c) => h('div', { class: 'comment' },
    h('button', { class: 'cav', type: 'button', onclick: () => { s.close(); location.hash = '#/u/' + c.user.id; } }, A.avatar(c.user.name)),
    h('div', { class: 'cbody' },
      h('div', { class: 'chead' }, h('b', {}, c.user.name), c.user.verified ? h('span', { class: 'vbadge', title: 'موثّق' }, '✓') : null,
        c.is_owner ? h('span', { class: 'tag g sm' }, 'المعلن') : null, h('span', { class: 'muted' }, A.timeAgo(c.created_at))),
      h('div', { class: 'ctext' }, c.text)),
    c.can_delete ? h('button', { class: 'cdel', type: 'button', 'aria-label': 'حذف التعليق', onclick: async (e) => {
      if (!confirm('حذف التعليق؟')) return;
      try { const d = await A.api('/api/comments/' + c.id, { method: 'DELETE' }); e.currentTarget.closest('.comment').remove(); setCount(d.comment_count); } catch (ex) { A.toast(ex.message); }
    } }, '×') : null);
  const input = h('textarea', { rows: 1, maxlength: 500, placeholder: A.user ? 'أضف تعليقاً...' : 'سجّل الدخول لإضافة تعليق', 'aria-label': 'تعليقك' });
  const send = h('button', { class: 'btn sm', type: 'submit' }, 'نشر');
  const form = h('form', { class: 'cform' }, input, send);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!A.requireLogin('سجّل الدخول لإضافة تعليق')) { s.close(); return; }
    const text = input.value.trim(); if (!text) return;
    send.disabled = true;
    try {
      const d = await A.api(`/api/listings/${l.id}/comments`, { method: 'POST', body: { text } });
      input.value = ''; list.querySelector('.cempty')?.remove(); list.prepend(row(d.comment)); setCount(d.comment_count);
    } catch (ex) { A.toast(ex.message); }
    send.disabled = false;
  });
  const s = A.sheet(title, list, form);
  (async () => {
    try {
      const d = await A.api(`/api/listings/${l.id}/comments`);
      setCount(d.comment_count);
      list.replaceChildren(...(d.comments.length ? d.comments.map(row) : [h('div', { class: 'muted cempty' }, 'لا توجد تعليقات بعد. كن أول من يسأل عن العقار.')]));
    } catch (e) { list.replaceChildren(h('div', { class: 'err' }, e.message)); }
  })();
};

A.toggleSave = async function toggleSave(l, btn) {
  if (!A.requireLogin('سجّل الدخول لحفظ العقار')) return;
  try {
    const d = await A.api(`/api/listings/${l.id}/save`, { method: l.saved ? 'DELETE' : 'POST' });
    l.saved = d.saved; btn.classList.toggle('on', l.saved);
  } catch (e) { A.toast(e.message); }
};

// ====== بناء عنصر الإعلان ======
A.buildItem = function buildItem(l, { observe } = {}) {
  const el = h('section', { class: 'item', 'data-id': l.id, 'aria-label': `${l.title} ${l.district}` });
  let video = null;
  if (l.media_type === 'video' && l.media[0]) {
    video = h('video', { src: l.media[0].url, poster: l.media[0].poster || null, loop: true, muted: true, playsinline: true, preload: 'metadata', 'aria-label': 'فيديو العقار' });
    video.muted = true;
    const hint = h('div', { class: 'playhint' }, A.icon('play'));
    hint.firstChild.style.cssText = 'width:32px;height:32px;fill:#fff';
    video.addEventListener('click', () => {
      if (video.paused) { video.play(); hint.classList.remove('show'); } else { video.pause(); hint.classList.add('show'); }
    });
    el.append(video, hint);
  } else if (l.media.length) {
    const dots = h('div', { class: 'dots' }, l.media.map((_, i) => h('i', { class: i === 0 ? 'on' : '' })));
    const car = h('div', { class: 'carousel', tabindex: '0', 'aria-label': 'صور العقار' }, l.media.map((m) => h('img', { src: m.url, alt: l.title, loading: 'lazy' })));
    car.addEventListener('scroll', () => {
      const i = Math.round(Math.abs(car.scrollLeft) / car.clientWidth);
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
    }, { passive: true });
    el.append(car, dots);
  } else el.append(h('div', { class: 'ph' }));
  el.append(h('div', { class: 'shade' }));

  const sbtn = (label, icon, onclick, cls = '', count = null) => {
    const c = count == null ? null : h('small', {}, A.compact(count));
    const b = h('button', { class: 'sbtn ' + cls, type: 'button', 'aria-label': label }, h('span', { class: 'round' }, icon), c || h('small', {}, label));
    b.addEventListener('click', () => onclick(b, c));
    return b;
  };
  const side = h('div', { class: 'side' },
    h('button', { class: 'sbtn owner', type: 'button', 'aria-label': 'ملف المعلن ' + (l.owner_name || ''), onclick: () => { location.hash = '#/u/' + l.owner_id; } },
      A.avatar(l.owner_name, 'lg'), l.owner_verified ? h('span', { class: 'vbadge abs' }, '✓') : null),
    sbtn('إعجاب', A.icon('heart'), (b, c) => A.toggleLike(l, b, c), 'like' + (l.liked ? ' on' : ''), l.like_count || 0),
    sbtn('تعليق', A.icon('chat'), (b, c) => A.openComments(l, (n) => { c.textContent = A.compact(n); }), '', l.comment_count || 0),
    sbtn('حفظ', A.icon('bookmark'), (b) => A.toggleSave(l, b), 'save' + (l.saved ? ' on' : '')),
    sbtn('الموقع', A.icon('pin'), () => { A.mapFocus = l; location.hash = '#/map'; }),
    sbtn('مشاركة', A.icon('share'), () => A.share(l)),
    sbtn('تكبير', A.icon('expand'), () => A.setClean(true, el), 'expand'));
  // زر الرجوع من العرض الكامل (يظهر فقط في هذا الوضع)
  el.append(h('button', { class: 'round unclean', type: 'button', 'aria-label': 'إظهار التفاصيل والأزرار', onclick: () => A.setClean(false, el) }, A.icon('shrink')));
  if (video) el.append(h('button', { class: 'round mute', type: 'button', 'aria-label': 'تشغيل الصوت', onclick: (e) => { video.muted = !video.muted; e.currentTarget.classList.toggle('on', !video.muted); e.currentTarget.textContent = video.muted ? '🔇' : '🔊'; } }, '🔇'));

  const info = h('div', { class: 'info' },
    h('button', { class: 'ownerline', type: 'button', onclick: () => { location.hash = '#/u/' + l.owner_id; } }, '@' + (l.owner_name || 'مالك'), l.owner_verified ? h('span', { class: 'vbadge' }, '✓') : null),
    h('div', { class: 'price' }, A.fmtPrice(l), l.featured ? h('small', {}, 'مميز') : null),
    h('div', { style: { fontSize: '17px', fontWeight: 600 } }, `${l.title} · ${l.district}`),
    h('div', { class: 'muted' }, [l.area && l.area + ' م²', l.beds && l.beds + ' غرف', A.floorLabel(l.floor)].filter(Boolean).join(' · ')),
    h('div', { class: 'row' },
      A.entranceLabel(l.entrance) ? h('span', { class: 'tag g' }, A.entranceLabel(l.entrance)) : null,
      h('span', { class: 'tag' }, '✓ إعلان مرخص ' + l.license_no),
      null),
    h('div', { class: 'row', style: { marginTop: '4px' } },
      h('button', { class: 'btn', style: { flex: 1 }, onclick: () => A.openContact(l) }, A.icon('chat'), 'تواصل عبر واتساب'),
      h('button', { class: 'btn ghost', onclick: () => A.openDetails(l) }, 'التفاصيل')));
  info.querySelector('.btn svg').style.cssText = 'width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2';
  el.append(side, info);
  el._video = video;
  return el;
};

// ====== الخلاصة ======
A.renderFeed = async function renderFeed(app, startId) {
  app.replaceChildren();
  const feed = h('div', { class: 'feed', id: 'feed' });
  const kindChip = (k, label) => h('button', { class: 'chip' + ((A.filters.kind || '') === k ? ' on' : ''), onclick: () => { A.filters.kind = k; if (!k) delete A.filters.kind; A.renderFeed(app); } }, label);
  const n = A.filterCount();
  app.append(feed, h('div', { class: 'topbar' },
    kindChip('', 'الكل'), kindChip('rent', 'إيجار'), kindChip('sale', 'بيع'),
    h('button', { class: 'chip' + (n > (A.filters.kind ? 1 : 0) ? ' on' : ''), style: { marginInlineStart: 'auto' }, 'aria-label': 'تصفية', onclick: () => A.openFilters(() => A.renderFeed(app)) }, A.icon('filter'), n ? String(n) : '')));
  app.querySelector('.chip:last-child svg').style.cssText = 'width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2';

  let offset = 0, loading = false, done = false; const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target._video;
      if (v) { if (e.isIntersecting) { v.play().catch(() => {}); } else v.pause(); }
      if (e.isIntersecting && e.target === feed.lastElementChild) more();
    }
  }, { root: feed, threshold: 0.7 });
  const add = (l) => { if (seen.has(l.id)) return; seen.add(l.id); const el = A.buildItem(l); feed.append(el); io.observe(el); };
  async function more() {
    if (loading || done) return; loading = true;
    try {
      const qs = new URLSearchParams({ ...A.filters, limit: 8, offset });
      const d = await A.api('/api/listings?' + qs);
      d.listings.forEach(add); offset += d.listings.length;
      if (d.listings.length < 8) done = true;
    } catch (e) { A.toast(e.message); done = true; }
    loading = false;
    if (!feed.children.length) feed.replaceWith(h('div', { class: 'empty' }, h('div', { style: { fontSize: '18px', fontWeight: 700 } }, 'لا توجد عقارات مطابقة'),
      h('div', {}, 'جرّب تغيير الفلاتر أو العودة لاحقاً.'),
      A.filterCount() ? h('button', { class: 'btn', onclick: () => { A.filters = {}; A.renderFeed(app); } }, 'مسح الفلاتر') : null));
  }
  if (startId) {
    try { const d = await A.api('/api/listings/' + startId); add(d.listing); } catch { A.toast('هذا الإعلان لم يعد متاحاً'); }
  }
  await more();
};
