'use strict';
// ====== التوجيه ======
async function route() {
  const app = document.getElementById('app');
  if (app._cleanup) { try { app._cleanup(); } catch { /* */ } app._cleanup = null; }
  const parts = (location.hash.replace(/^#\/?/, '') || 'feed').split('/');
  const wide = A.wide();
  document.body.classList.toggle('wide', wide);
  app.className = parts[0] === 'videos' || (!wide && ['feed', 'l'].includes(parts[0])) ? 'videos' : '';
  A.renderTabs();
  switch (parts[0]) {
    case 'feed': return wide ? A.renderExplore(app) : A.renderFeed(app);
    case 'l': return wide ? A.renderExplore(app, Number(parts[1]) || null) : A.renderFeed(app, Number(parts[1]) || null);
    case 'map': return wide ? A.renderExplore(app) : A.renderMap(app);
    case 'videos': return A.renderFeed(app);
    case 'publish': return A.renderPublish(app);
    case 'saved': return A.renderSaved(app);
    case 'me': return A.renderMe(app);
    case 'login': return A.renderLogin(app);
    default: location.hash = '#/feed';
  }
}
window.addEventListener('hashchange', route);
// إعادة الرسم عند تدوير الآيباد أو تغيير حجم النافذة بين الجوال والشاشة الكبيرة
A.wideQuery.addEventListener('change', () => route());
(async () => {
  try { A.config = await A.api('/api/config'); } catch { /* القيم الافتراضية */ }
  await A.refreshMe();
  // العودة من صفحة الدفع
  const q = new URLSearchParams(location.search);
  if (q.has('payment')) {
    const st = q.get('payment');
    A.toast(st === 'paid' ? 'تم الدفع وتفعيل باقتك' : st === 'initiated' ? 'لم يكتمل الدفع بعد. إن خُصم المبلغ ستُفعّل الباقة خلال دقائق.' : 'لم يتم الدفع');
    history.replaceState(null, '', '/' + location.hash);
  }
  route();
})();
