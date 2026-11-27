'use strict';
// ====== الاستكشاف للشاشات الكبيرة (آيباد/كمبيوتر): خريطة بملء الشاشة + لوحة نتائج وتفاصيل بأسلوب خرائط Google ======

A.typeLabel = (t) => ({ apartment: 'شقة', villa: 'فيلا', floor: 'دور', land: 'أرض', office: 'مكتب', shop: 'محل' }[t] || '');
A.searchInArea = true; // تحديث النتائج عند تحريك الخريطة

function thumbOf(l) {
  const m = l.media[0];
  if (!m) return null;
  return l.media_type === 'photos' ? m.url : m.poster;
}

// بطاقة عقار في قائمة النتائج
function resultCard(l, { onOpen, onHover }) {
  const t = thumbOf(l);
  const el = h('button', { class: 'rcard', type: 'button', 'data-id': l.id, onclick: () => onOpen(l),
    onmouseenter: () => onHover(l.id, true), onmouseleave: () => onHover(l.id, false), onfocus: () => onHover(l.id, true), onblur: () => onHover(l.id, false) },
    h('div', { class: 'rthumb' }, t ? h('img', { src: t, alt: '', loading: 'lazy' }) : null,
      l.media_type === 'video' ? h('span', { class: 'rvid' }, A.icon('play'), 'فيديو') : l.media.length > 1 ? h('span', { class: 'rvid' }, `${l.media.length} صور`) : null),
    h('div', { class: 'rbody' },
      h('div', { class: 'rprice' }, A.fmtPrice(l), l.featured ? h('small', { class: 'feat' }, 'مميز') : null),
      h('div', { class: 'rtitle' }, `${l.title}`),
      h('div', { class: 'muted' }, [A.typeLabel(l.property_type), l.district, l.city].filter(Boolean).join(' · ')),
      h('div', { class: 'muted' }, [l.area && l.area + ' م²', l.beds && l.beds + ' غرف', A.floorLabel(l.floor), A.entranceLabel(l.entrance)].filter(Boolean).join(' · ')),
      l.owner_verified ? h('span', { class: 'tag g', style: { alignSelf: 'flex-start' } }, 'مالك موثّق') : null));
  return el;
}

// معرض الوسائط في لوحة التفاصيل
function mediaGallery(l) {
  if (l.media_type === 'video' && l.media[0]) {
    const v = h('video', { src: l.media[0].url, poster: l.media[0].poster || null, controls: true, playsinline: true, autoplay: true, loop: true, preload: 'metadata', 'aria-label': 'فيديو العقار' });
    v.muted = true;
    return h('div', { class: 'gallery' }, v);
  }
  if (!l.media.length) return h('div', { class: 'gallery ph' });
  let i = 0;
  const img = h('img', { src: l.media[0].url, alt: l.title });
  const count = h('span', { class: 'gcount' });
  const thumbs = h('div', { class: 'gthumbs' }, l.media.map((m, j) => h('button', { type: 'button', 'aria-label': 'صورة ' + (j + 1), onclick: () => show(j) }, h('img', { src: m.url, alt: '', loading: 'lazy' }))));
  function show(j) {
    i = (j + l.media.length) % l.media.length; img.src = l.media[i].url;
    count.textContent = `${i + 1} / ${l.media.length}`;
    [...thumbs.children].forEach((b, k) => b.classList.toggle('on', k === i));
  }
  const nav = l.media.length > 1 ? [
    h('button', { class: 'gnav next', type: 'button', 'aria-label': 'الصورة التالية', onclick: () => show(i + 1) }, '‹'),
    h('button', { class: 'gnav prev', type: 'button', 'aria-label': 'الصورة السابقة', onclick: () => show(i - 1) }, '›')] : [];
  const g = h('div', {}, h('div', { class: 'gallery' }, img, ...nav, l.media.length > 1 ? count : null), l.media.length > 1 ? thumbs : null);
  show(0);
  return g;
}

// لوحة تفاصيل العقار
function detailPanel(l, { onBack }) {
  const spec = (k, v) => (v == null || v === '' ? null : h('div', { class: 'spec' }, h('small', {}, k), h('b', {}, v)));
  const saveBtn = h('button', { class: 'act' + (l.saved ? ' on' : ''), type: 'button', onclick: () => A.toggleSave(l, saveBtn) }, A.icon('heart'), 'حفظ');
  return h('div', { class: 'detail' },
    h('div', { class: 'dtop' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: onBack }, '→ النتائج')),
    mediaGallery(l),
    h('div', { class: 'dbody' },
      h('div', { class: 'price' }, A.fmtPrice(l), l.featured ? h('small', {}, 'مميز') : null),
      h('h2', { class: 'dtitle' }, l.title),
      h('div', { class: 'muted' }, [A.kindLabel(l.kind), A.typeLabel(l.property_type), l.district, l.city].filter(Boolean).join(' · ')),
      h('div', { class: 'acts' },
        h('button', { class: 'act primary', type: 'button', onclick: () => A.openContact(l) }, A.icon('chat'), 'واتساب'),
        saveBtn,
        h('button', { class: 'act', type: 'button', onclick: () => A.share(l) }, A.icon('share'), 'مشاركة'),
        h('button', { class: 'act', type: 'button', onclick: () => A.openReport(l) }, h('span', { style: { fontSize: '18px' } }, '⚑'), 'إبلاغ')),
      h('div', { class: 'specs3' },
        spec('المساحة', l.area && l.area + ' م²'), spec('الغرف', l.beds), spec('دورات المياه', l.baths),
        spec('الدور', A.floorLabel(l.floor)), spec('المدخل', A.entranceLabel(l.entrance)), spec('النوع', A.typeLabel(l.property_type))),
      h('div', { class: 'card bview' }, A.buildingView(l.floor),
        h('div', {}, h('b', {}, 'موقع الشقة في المبنى'), h('div', { class: 'muted' }, [A.floorLabel(l.floor) || 'الدور غير محدد', A.entranceLabel(l.entrance)].filter(Boolean).join(' · ')))),
      l.description ? h('div', { class: 'msg' }, l.description) : null,
      h('div', { class: 'muted' }, `المعلن: ${l.owner_name || 'مالك'}${l.owner_verified ? ' (موثّق)' : ''}`, h('br'),
        `ترخيص الإعلان: ${l.license_no} · ينتهي ${l.license_expires}`, h('br'), 'يُوقف الإعلان تلقائياً عند انتهاء الترخيص.')));
}

A.renderExplore = function renderExplore(app, openId) {
  app.replaceChildren();
  if (typeof L === 'undefined') {
    app.append(h('div', { class: 'empty' }, h('div', { style: { fontWeight: 700 } }, 'تعذّر تحميل الخريطة'), h('div', {}, 'تحقق من الاتصال بالإنترنت ثم أعد المحاولة.')));
    return;
  }
  const list = h('div', { class: 'rlist' });
  const head = h('div', { class: 'phead' });
  const panel = h('aside', { class: 'panel', 'aria-label': 'نتائج البحث' }, head, list);
  const mapEl = h('div', { id: 'bigmap' });
  const floating = h('div', { class: 'mapfloat' });
  app.append(h('div', { class: 'explore' }, panel, h('div', { class: 'mapcol' }, mapEl, floating)));

  const focus = A.mapFocus; A.mapFocus = null;
  const map = L.map(mapEl, { zoomControl: false }).setView([24.7136, 46.6753], 11);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const markers = new Map();
  let data = []; let selected = null; let loading = false; let pending = false; let fitFirst = false;

  // ---- رأس اللوحة: نوع العرض، التصفية، الترتيب
  function renderHead() {
    const chip = (k, label) => h('button', { class: 'chip' + ((A.filters.kind || '') === k ? ' on' : ''), type: 'button', onclick: () => { if (k) A.filters.kind = k; else delete A.filters.kind; renderHead(); load(); } }, label);
    const n = A.filterCount() - (A.filters.kind ? 1 : 0) - (A.filters.q ? 1 : 0);
    const sort = h('select', { class: 'sortsel', 'aria-label': 'الترتيب', onchange: (e) => { A.filters.sort = e.target.value || undefined; if (!A.filters.sort) delete A.filters.sort; load(); } },
      [['', 'الأحدث والمميز'], ['price_asc', 'السعر: الأقل أولاً'], ['price_desc', 'السعر: الأعلى أولاً']].map(([v, t]) => h('option', { value: v, selected: (A.filters.sort || '') === v }, t)));
    const area = h('label', { class: 'areachk' }, h('input', { type: 'checkbox', checked: A.searchInArea, onchange: (e) => { A.searchInArea = e.target.checked; load(); } }), 'ابحث داخل حدود الخريطة');
    head.replaceChildren(...[
      h('div', { class: 'row' }, chip('', 'الكل'), chip('rent', 'إيجار'), chip('sale', 'بيع'),
        h('button', { class: 'chip' + (n > 0 ? ' on' : ''), type: 'button', onclick: () => A.openFilters(() => { renderHead(); load(); }) }, A.icon('filter'), n ? `تصفية (${n})` : 'تصفية')),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, area, sort),
      A.filters.q ? h('div', { class: 'row' }, h('span', { class: 'tag' }, 'بحث: ' + A.filters.q), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { delete A.filters.q; const s = document.getElementById('hsearch'); if (s) s.value = ''; renderHead(); load(); } }, 'مسح البحث')) : null].filter(Boolean));
  }

  // ---- الدبابيس
  function pinHtml(l) {
    const short = l.price >= 1e6 ? (l.price / 1e6).toFixed(1) + ' م' : l.price >= 1000 ? Math.round(l.price / 1000) + ' ألف' : String(l.price);
    return h('div', { class: 'pin' + (selected && selected.id === l.id ? ' on' : '') }, short);
  }
  function drawPins() {
    layer.clearLayers(); markers.clear();
    const all = selected && !data.find((x) => x.id === selected.id) ? [...data, selected] : data;
    for (const l of all) {
      if (l.lat == null || l.lng == null) continue;
      const m = L.marker([l.lat, l.lng], { icon: L.divIcon({ className: '', html: pinHtml(l), iconSize: [0, 0] }), keyboard: true, title: `${l.title} ${l.district}`, riseOnHover: true }).addTo(layer);
      m.on('click', () => openDetail(l, { pan: false }));
      markers.set(l.id, m);
    }
  }
  function highlight(id, on) {
    const m = markers.get(id); if (!m) return;
    const el = m.getElement() && m.getElement().querySelector('.pin');
    if (el) el.classList.toggle('hover', on);
    m.setZIndexOffset(on ? 1000 : 0);
    const card = list.querySelector(`[data-id="${id}"]`); if (card) card.classList.toggle('hover', on);
  }

  // ---- القائمة
  function renderList() {
    if (selected) return;
    list.replaceChildren(
      h('div', { class: 'muted rcount' }, loading ? 'جارٍ البحث...' : data.length ? `${data.length}${data.length >= 50 ? '+' : ''} عقار${A.searchInArea ? ' في هذه المنطقة' : ''}` : ''),
      ...data.map((l) => resultCard(l, { onOpen: (x) => openDetail(x, { pan: true }), onHover: highlight })),
      !loading && !data.length ? h('div', { class: 'rempty' }, h('b', {}, 'لا توجد عقارات هنا'),
        h('div', { class: 'muted' }, A.searchInArea ? 'حرّك الخريطة أو صغّرها لرؤية مناطق أخرى، أو ألغِ «ابحث داخل حدود الخريطة».' : 'جرّب تغيير الفلاتر.')) : null);
  }

  async function load() {
    if (loading) { pending = true; return; }
    loading = true; renderList();
    try {
      const params = { ...A.filters, limit: 50 };
      if (A.searchInArea) { const b = map.getBounds(); params.bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','); }
      data = (await A.api('/api/listings?' + new URLSearchParams(params))).listings;
    } catch (e) { A.toast(e.message); }
    loading = false; drawPins(); renderList();
    if (fitFirst) {
      fitFirst = false;
      const pts = data.filter((l) => l.lat != null).map((l) => [l.lat, l.lng]);
      if (pts.length) { map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 }); return; }
    }
    if (pending) { pending = false; load(); }
  }

  // ---- التفاصيل
  function openDetail(l, { pan }) {
    selected = l;
    history.replaceState(null, '', '#/l/' + l.id);
    list.replaceChildren(detailPanel(l, { onBack: closeDetail }));
    panel.scrollTop = 0; head.style.display = 'none';
    drawPins();
    if (pan && l.lat != null) map.flyTo([l.lat, l.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    // تسجيل المشاهدة وجلب أحدث بيانات
    A.api('/api/listings/' + l.id).then((d) => { if (selected && selected.id === l.id) { selected = d.listing; } }).catch(() => {});
  }
  function closeDetail() {
    selected = null; head.style.display = '';
    history.replaceState(null, '', '#/feed');
    list.querySelectorAll('video').forEach((v) => v.pause());
    drawPins(); renderList();
  }

  // ---- أزرار عائمة فوق الخريطة
  floating.append(h('button', { class: 'chip solid', type: 'button', onclick: () => {
    if (!navigator.geolocation) return A.toast('الموقع غير مدعوم في متصفحك');
    navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 14), () => A.toast('لم نحصل على إذن الموقع'));
  } }, A.icon('pin'), 'موقعي'));

  // البحث من الشريط العلوي
  const onSearch = () => { if (selected) closeDetail(); renderHead(); load(); };
  window.addEventListener('tk-search', onSearch);

  let t = null;
  map.on('moveend', () => { if (!A.searchInArea) return; clearTimeout(t); t = setTimeout(load, 250); });
  app._cleanup = () => { window.removeEventListener('tk-search', onSearch); list.querySelectorAll('video').forEach((v) => v.pause()); map.remove(); };

  renderHead();
  setTimeout(() => map.invalidateSize(), 0);
  (async () => {
    const start = focus || (openId ? await A.api('/api/listings/' + openId).then((d) => d.listing).catch(() => { A.toast('هذا الإعلان لم يعد متاحاً'); return null; }) : null);
    if (start) {
      if (start.lat != null) map.setView([start.lat, start.lng], 15);
      openDetail(start, { pan: false });
    } else {
      // أول فتح: نعرض كل العقارات ثم نقرّب الخريطة عليها
      fitFirst = true; const keep = A.searchInArea; A.searchInArea = false;
      await load(); A.searchInArea = keep; return;
    }
    load();
  })();
};
