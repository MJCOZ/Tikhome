'use strict';
// ====== التوجيه ======
async function route() {
  const app = document.getElementById('app');
  if (app._cleanup) { try { app._cleanup(); } catch { /* */ } app._cleanup = null; }
  const parts = (location.hash.replace(/^#\/?/, '') || 'feed').split('/');
  A.renderTabs();
  switch (parts[0]) {
    case 'feed': return A.renderFeed(app);
    case 'l': return A.renderFeed(app, Number(parts[1]) || null);
    case 'map': return A.renderMap(app);
    case 'publish': return A.renderPublish(app);
    case 'saved': return A.renderSaved(app);
    case 'me': return A.renderMe(app);
    case 'login': return A.renderLogin(app);
    default: location.hash = '#/feed';
  }
}
window.addEventListener('hashchange', route);
(async () => {
  try { A.config = await A.api('/api/config'); } catch { /* القيم الافتراضية */ }
  await A.refreshMe();
  route();
})();
