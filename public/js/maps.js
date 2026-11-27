'use strict';
// ====== واجهة خريطة موحّدة: خرائط Google الرسمية عند وجود المفتاح، وإلا الخريطة المجانية (Leaflet + OpenStreetMap) ======
// A.createMap(el, { lat, lng, zoom, onIdle, onClick }) → { bounds(), setView(), addPin(), clearPins(), remove(), kind }

A.shortPrice = (p) => (p >= 1e6 ? (p / 1e6).toFixed(1) + ' م' : p >= 1000 ? Math.round(p / 1000) + ' ألف' : String(p));

let gmPromise = null;
A.loadGoogleMaps = function loadGoogleMaps() {
  if (!A.config.google_maps_key) return Promise.reject(new Error('no key'));
  if (gmPromise) return gmPromise;
  gmPromise = new Promise((resolve, reject) => {
    const cb = '__tkGoogleMapsReady';
    window[cb] = () => resolve();
    // مفتاح مرفوض (غير مفعّل أو مقيّد على نطاق آخر): نرجع للخريطة المجانية
    window.gm_authFailure = () => { A.gmFailed = true; A.toast('مفتاح خرائط Google غير مفعّل لهذا الموقع، عُرضت الخريطة البديلة'); window.dispatchEvent(new Event('tk-gm-failed')); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(A.config.google_maps_key)}&language=ar&region=SA&loading=async&callback=${cb}&v=weekly`;
    s.async = true;
    s.onerror = () => { gmPromise = null; reject(new Error('load failed')); };
    document.head.append(s);
    setTimeout(() => reject(new Error('timeout')), 15000);
  });
  return gmPromise;
};

async function googleMap(el, o) {
  await A.loadGoogleMaps();
  const { Map, OverlayView } = await google.maps.importLibrary('maps');
  class Pin extends OverlayView {
    constructor(pos, node) { super(); this.pos = pos; this.node = node; OverlayView.preventMapHitsAndGesturesFrom(node); }
    onAdd() { this.node.style.position = 'absolute'; this.getPanes().overlayMouseTarget.appendChild(this.node); }
    draw() { const p = this.getProjection().fromLatLngToDivPixel(this.pos); if (p) { this.node.style.left = p.x + 'px'; this.node.style.top = p.y + 'px'; } }
    onRemove() { this.node.remove(); }
  }
  const map = new Map(el, {
    center: { lat: o.lat, lng: o.lng }, zoom: o.zoom, gestureHandling: 'greedy', clickableIcons: false,
    mapTypeControl: true, streetViewControl: false, fullscreenControl: false, zoomControl: true,
    mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_LEFT },
  });
  if (o.onIdle) map.addListener('idle', o.onIdle);
  if (o.onClick) map.addListener('click', (e) => o.onClick(e.latLng.lat(), e.latLng.lng()));
  let pins = [];
  return {
    kind: 'google',
    bounds() { const b = map.getBounds(); if (!b) return null; const sw = b.getSouthWest(), ne = b.getNorthEast(); return [sw.lat(), sw.lng(), ne.lat(), ne.lng()]; },
    setView(lat, lng, zoom) { map.panTo({ lat, lng }); if (zoom) map.setZoom(zoom); },
    addPin(lat, lng, node, onClick) {
      if (onClick) node.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      const p = new Pin(new google.maps.LatLng(lat, lng), node); p.setMap(map); pins.push(p); return p;
    },
    clearPins() { pins.forEach((p) => p.setMap(null)); pins = []; },
    remove() { pins.forEach((p) => p.setMap(null)); pins = []; google.maps.event.clearInstanceListeners(map); },
  };
}

function leafletMap(el, o) {
  if (typeof L === 'undefined') throw new Error('no map library');
  const map = L.map(el, { zoomControl: true }).setView([o.lat, o.lng], o.zoom);
  A.addBaseLayers(map);
  const layer = L.layerGroup().addTo(map);
  if (o.onIdle) map.on('moveend', o.onIdle);
  if (o.onClick) map.on('click', (e) => o.onClick(e.latlng.lat, e.latlng.lng));
  return {
    kind: 'leaflet',
    bounds() { const b = map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; },
    setView(lat, lng, zoom) { map.setView([lat, lng], zoom || map.getZoom()); },
    addPin(lat, lng, node, onClick) {
      const m = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: node, iconSize: [0, 0] }), keyboard: true }).addTo(layer);
      if (onClick) m.on('click', onClick);
      return m;
    },
    clearPins() { layer.clearLayers(); },
    remove() { map.remove(); },
  };
}

A.createMap = async function createMap(el, o) {
  if (A.config.google_maps_key && !A.gmFailed) {
    try { return await googleMap(el, o); } catch (e) { console.warn('Google Maps unavailable, using fallback', e); }
  }
  return leafletMap(el, o);
};
