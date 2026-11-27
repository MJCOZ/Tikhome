'use strict';

// ====== الخريطة مع موقع الشقة في المبنى (الدور + المدخل) ======
A.buildingView = function buildingView(floor) {
  const top = Math.max(3, floor == null ? 3 : floor);
  const rows = [];
  for (let n = top; n >= 0; n--) rows.push(h('div', { class: n === floor ? 'on' : '' }, A.floorLabel(n).replace('الدور ', '')));
  rows.push(h('i'));
  return h('div', { class: 'building', 'aria-label': floor == null ? 'الدور غير محدد' : A.floorLabel(floor) }, rows);
};

A.renderMap = async function renderMap(app) {
  app.replaceChildren();
  const mapEl = h('div', { id: 'map' });
  const cardHost = h('div');
  app.append(h('div', { class: 'mapwrap' }, mapEl), h('div', { class: 'maptop' },
    h('button', { class: 'chip', onclick: () => A.openFilters(load) }, 'تصفية'),
    h('button', { class: 'chip', onclick: locate }, 'موقعي')), cardHost);

  const focus = A.mapFocus; A.mapFocus = null;
  let selected = focus ? focus.id : null; let data = []; let map = null; let alive = true;
  app._cleanup = () => { alive = false; if (map) map.remove(); };
  try {
    map = await A.createMap(mapEl, {
      lat: focus && focus.lat != null ? focus.lat : 24.7136, lng: focus && focus.lng != null ? focus.lng : 46.6753,
      zoom: focus && focus.lat != null ? 15 : 11, onIdle: () => load(),
    });
  } catch {
    mapEl.replaceWith(h('div', { class: 'empty' }, h('div', { style: { fontWeight: 700 } }, 'تعذّر تحميل الخريطة'), h('div', {}, 'تحقق من الاتصال بالإنترنت ثم أعد المحاولة.')));
    return;
  }
  if (!alive) { map.remove(); return; }

  function showCard(l) {
    selected = l.id; draw();
    cardHost.replaceChildren(h('div', { class: 'mapcard' }, A.buildingView(l.floor),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 } },
        h('div', { class: 'muted', style: { color: 'var(--acc-soft)', fontWeight: 600 } }, 'موقع الشقة في المبنى'),
        h('div', { style: { fontWeight: 700, fontSize: '16px' } }, `${l.title} · ${l.district}`),
        h('div', { class: 'muted' }, [A.floorLabel(l.floor), A.entranceLabel(l.entrance)].filter(Boolean).join(' · ')),
        h('div', { class: 'price', style: { fontSize: '18px' } }, A.fmtPrice(l)),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => { location.hash = '#/l/' + l.id; } }, 'شاهد العقار'),
          l.lat != null ? h('a', { class: 'btn sec sm', href: A.googleMapsUrl(l), target: '_blank', rel: 'noopener' }, 'افتح في Google Maps') : null))));
  }
  function draw() {
    map.clearPins();
    for (const l of data) {
      if (l.lat == null) continue;
      const node = h('div', { class: 'pin' + (l.id === selected ? ' on' : ''), title: `${l.title} ${l.district}`, role: 'button', tabindex: '0' }, A.shortPrice(l.price));
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter') showCard(l); });
      map.addPin(l.lat, l.lng, node, () => showCard(l));
    }
  }
  async function load() {
    const b = map.bounds(); if (!b) return;
    const qs = new URLSearchParams({ ...A.filters, bbox: b.join(','), limit: 50 });
    try {
      data = (await A.api('/api/listings?' + qs)).listings;
      if (focus && !data.find((x) => x.id === focus.id)) data.unshift(focus);
      if (!alive) return;
      draw();
      const sel = data.find((l) => l.id === selected); if (sel) showCard(sel);
    } catch (e) { A.toast(e.message); }
  }
  function locate() {
    if (!navigator.geolocation) return A.toast('الموقع غير مدعوم في متصفحك');
    navigator.geolocation.getCurrentPosition((p) => map && map.setView(p.coords.latitude, p.coords.longitude, 14), () => A.toast('لم نحصل على إذن الموقع'));
  }
  if (map.kind === 'leaflet') load();
};
