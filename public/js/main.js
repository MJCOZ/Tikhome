'use strict';
// ====== التوجيه ======
async function route() {
  const app = document.getElementById('app');
  // إغلاق أي نافذة مفتوحة عند الانتقال لصفحة أخرى
  document.querySelectorAll('.scrim').forEach((x) => x.remove());
  // وضع العرض الكامل خاص بالخلاصة فقط
  if (!['feed', 'l', 'videos', ''].includes((location.hash.replace(/^#\/?/, '') || 'feed').split('/')[0])) document.body.classList.remove('clean');
  if (app._cleanup) { try { app._cleanup(); } catch { /* */ } app._cleanup = null; }
  const parts = (location.hash.replace(/^#\/?/, '') || 'feed').split('/');
  app.className = parts[0] === 'map' ? 'full' : '';
  A.renderTabs();
  switch (parts[0]) {
    case 'feed': return A.renderFeed(app);
    case 'l': return A.renderFeed(app, Number(parts[1]) || null);
    case 'map': return A.renderMap(app);
    case 'publish': return A.renderPublish(app);
    case 'saved': return A.renderSaved(app);
    case 'me': return A.renderMe(app);
    case 'login': return A.renderLogin(app);
    case 'u': return A.renderProfile(app, Number(parts[1]) || 0);
    default: location.hash = '#/feed';
  }
}
window.addEventListener('hashchange', route);
// إذا رُفض مفتاح خرائط Google نعيد الرسم بالخريطة البديلة
window.addEventListener('tk-gm-failed', () => route());
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
