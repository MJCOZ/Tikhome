'use strict';

// ====== الخريطة مع موقع الشقة في المبنى (الدور + المدخل) ======
A.buildingView = function buildingView(floor) {
  const top = Math.max(3, floor == null ? 3 : floor);
  const rows = [];
  for (let n = top; n >= 0; n--) rows.push(h('div', { class: n === floor ? 'on' : '' }, A.floorLabel(n).replace('الدور ', '')));
  rows.push(h('i'));
  return h('div', { class: 'building', 'aria-label': floor == null ? 'الدور غير محدد' : A.floorLabel(floor) }, rows);
};

A.renderMap = function renderMap(app) {
  app.replaceChildren();
  if (typeof L === 'undefined') {
    app.append(h('div', { class: 'empty' }, h('div', { style: { fontWeight: 700 } }, 'تعذّر تحميل الخريطة'), h('div', {}, 'تحقق من الاتصال بالإنترنت ثم أعد المحاولة.')));
    return;
  }
  const wrap = h('div', { class: 'mapwrap' }, h('div', { id: 'map' }));
  const cardHost = h('div');
  app.append(wrap, h('div', { class: 'maptop' },
    h('button', { class: 'chip', onclick: () => A.openFilters(load) }, 'تصفية'),
    h('button', { class: 'chip', onclick: locate }, 'موقعي')), cardHost);

  const focus = A.mapFocus; A.mapFocus = null;
  const map = L.map('map', { zoomControl: false }).setView(focus && focus.lat ? [focus.lat, focus.lng] : [24.7136, 46.6753], focus && focus.lat ? 15 : 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let selected = focus ? focus.id : null; let data = [];

  function showCard(l) {
    selected = l.id; draw();
    cardHost.replaceChildren(h('div', { class: 'mapcard' }, A.buildingView(l.floor),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 } },
        h('div', { class: 'muted', style: { color: 'var(--acc-soft)', fontWeight: 600 } }, 'موقع الشقة في المبنى'),
        h('div', { style: { fontWeight: 700, fontSize: '16px' } }, `${l.title} · ${l.district}`),
        h('div', { class: 'muted' }, [A.floorLabel(l.floor), A.entranceLabel(l.entrance)].filter(Boolean).join(' · ')),
        h('div', { class: 'price', style: { fontSize: '18px' } }, A.fmtPrice(l)),
        h('button', { class: 'btn sm', onclick: () => { location.hash = '#/l/' + l.id; } }, 'شاهد العقار'))));
  }
  function draw() {
    layer.clearLayers();
    for (const l of data) {
      if (l.lat == null) continue;
      const short = l.price >= 1e6 ? (l.price / 1e6).toFixed(1) + ' م' : l.price >= 1000 ? Math.round(l.price / 1000) + ' ألف' : String(l.price);
      const node = h('div', { class: 'pin' + (l.id === selected ? ' on' : '') }, short);
      const icon = L.divIcon({ className: '', html: node, iconSize: [0, 0] });
      const m = L.marker([l.lat, l.lng], { icon, keyboard: true, title: `${l.title} ${l.district}` }).addTo(layer);
      m.on('click', () => showCard(l));
    }
  }
  async function load() {
    const b = map.getBounds();
    const qs = new URLSearchParams({ ...A.filters, bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','), limit: 50 });
    try {
      data = (await A.api('/api/listings?' + qs)).listings;
      if (focus && !data.find((x) => x.id === focus.id)) data.unshift(focus);
      draw();
      const sel = data.find((l) => l.id === selected); if (sel) showCard(sel);
    } catch (e) { A.toast(e.message); }
  }
  function locate() {
    if (!navigator.geolocation) return A.toast('الموقع غير مدعوم في متصفحك');
    navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 14), () => A.toast('لم نحصل على إذن الموقع'));
  }
  map.on('moveend', load);
  load();
  app._cleanup = () => map.remove();
};
