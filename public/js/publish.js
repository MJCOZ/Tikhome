'use strict';

// ====== نشر إعلان: المالك ينشر بنفسه (فيديو أو صور) ======
A.renderPublish = function renderPublish(app) {
  app.replaceChildren();
  if (!A.user) {
    app.append(h('div', { class: 'empty' }, h('div', { style: { fontSize: '20px', fontWeight: 700 } }, 'انشر عقارك بنفسك'),
      h('div', {}, 'بدون مكتب عقاري. سجّل دخولك أولاً.'),
      h('button', { class: 'btn', onclick: () => (location.hash = '#/login') }, 'تسجيل الدخول')));
    return;
  }
  const f = { kind: 'rent', property_type: 'apartment', floor: 1, entrance: 'private', media_type: 'video', lat: null, lng: null };
  let files = []; let previewUrls = [];
  const err = h('div', { class: 'err', role: 'alert' });

  const pills = (key, opts) => {
    const box = h('div', { class: 'pills' });
    const paint = () => [...box.children].forEach((b, i) => b.classList.toggle('on', f[key] === opts[i][0]));
    opts.forEach(([val, label]) => box.append(h('button', { type: 'button', class: 'pill', onclick: () => { f[key] = val; paint(); if (key === 'media_type') resetFiles(); } }, label)));
    paint(); return box;
  };
  const inp = (key, attrs = {}) => h('input', { ...attrs, value: f[key] ?? '', oninput: (e) => (f[key] = e.target.value) });

  // ----- الوسائط -----
  const previews = h('div'); const fileInput = h('input', { type: 'file', multiple: true, 'aria-label': 'اختر ملفات', style: { display: 'none' } });
  function resetFiles() { files = []; previewUrls.forEach(URL.revokeObjectURL); previewUrls = []; fileInput.value = ''; fileInput.accept = f.media_type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp'; fileInput.multiple = f.media_type === 'photos'; hint.textContent = hintText(); renderPreviews(); }
  const hintText = () => (f.media_type === 'video' ? `فيديو واحد قصير (حتى ${A.config.max_video_mb} ميغابايت): المدخل، الصالة، الغرف، الإطلالة` : `صور العقار (حتى ${A.config.max_photos} صورة) وتُعرض مجتمعة بتمرير سريع`);
  const hint = h('div', { class: 'muted' });
  function renderPreviews() {
    previews.replaceChildren();
    if (!files.length) return;
    if (f.media_type === 'video') previews.append(h('video', { class: 'preview', src: previewUrls[0], controls: true, playsinline: true }));
    else previews.append(h('div', { class: 'thumbs' }, files.map((_, i) => h('div', {}, h('img', { src: previewUrls[i], alt: 'صورة ' + (i + 1) }),
      h('button', { type: 'button', 'aria-label': 'حذف الصورة', onclick: () => { files.splice(i, 1); URL.revokeObjectURL(previewUrls[i]); previewUrls.splice(i, 1); renderPreviews(); } }, '×')))));
  }
  fileInput.addEventListener('change', () => {
    let picked = [...fileInput.files];
    if (f.media_type === 'video') { picked = picked.slice(0, 1); files = []; previewUrls.forEach(URL.revokeObjectURL); previewUrls = []; }
    else picked = picked.slice(0, A.config.max_photos - files.length);
    for (const p of picked) {
      const mb = p.size / 1048576;
      if (f.media_type === 'video' && mb > A.config.max_video_mb) { A.toast(`الفيديو أكبر من ${A.config.max_video_mb} ميغابايت`); continue; }
      if (f.media_type === 'photos' && mb > (A.config.max_photo_mb || 8)) { A.toast(`إحدى الصور أكبر من ${A.config.max_photo_mb || 8} ميغابايت`); continue; }
      files.push(p); previewUrls.push(URL.createObjectURL(p));
    }
    fileInput.value = ''; renderPreviews();
  });

  // ----- الموقع على الخريطة -----
  const mapBox = h('div', { class: 'minimap' });
  let marker = null; let mini = null;
  setTimeout(() => {
    if (typeof L === 'undefined') { mapBox.append(h('div', { class: 'empty', style: { position: 'static', height: '100%' } }, 'الخريطة غير متاحة الآن')); return; }
    mini = L.map(mapBox, { zoomControl: true }).setView([24.7136, 46.6753], 11);
    A.addBaseLayers(mini);
    mini.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng));
    app._cleanup = () => mini.remove();
  }, 0);
  function setPoint(lat, lng) {
    f.lat = Number(lat.toFixed(6)); f.lng = Number(lng.toFixed(6));
    if (!mini) return;
    if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng]).addTo(mini);
    mini.setView([lat, lng], Math.max(mini.getZoom(), 15));
  }

  // ----- الإرسال -----
  const progress = h('i'); const bar = h('div', { class: 'progress', style: { display: 'none' } }, progress);
  const submit = h('button', { class: 'btn', type: 'button' }, 'أرسل الإعلان');
  submit.addEventListener('click', async () => {
    err.textContent = '';
    if (!files.length) { err.textContent = f.media_type === 'video' ? 'اختر فيديو للعقار' : 'اختر صورة واحدة على الأقل'; return; }
    submit.disabled = true; submit.textContent = 'جارٍ الإرسال...';
    let id = null;
    try {
      const body = { ...f, floor: f.floor === '' ? null : Number(f.floor) };
      const c = await A.api('/api/listings', { method: 'POST', body }); id = c.listing.id;
      bar.style.display = 'block';
      const poster = f.media_type === 'video' ? await A.videoPoster(files[0]) : null;
      await A.uploadFiles(id, files, (p) => (progress.style.width = Math.round(p * 100) + '%'), poster);
      const r = await A.api(`/api/listings/${id}/submit`, { method: 'POST' });
      done(r.status);
    } catch (e) {
      err.textContent = e.message; submit.disabled = false; submit.textContent = 'أرسل الإعلان';
      if (id) A.toast('حُفظ إعلانك كمسودة في "حسابي"، ويمكنك إكماله من هناك');
    }
  });
  function done(status) {
    app.replaceChildren(h('div', { class: 'empty' }, h('div', { style: { fontSize: '20px', fontWeight: 700 } }, status === 'published' ? 'تم نشر إعلانك' : 'استلمنا إعلانك'),
      h('div', {}, status === 'published' ? 'أصبح ظاهراً للباحثين الآن.' : 'سيُراجَع قبل النشر وسيصلك إشعار بالنتيجة.'),
      h('button', { class: 'btn', onclick: () => (location.hash = '#/me') }, 'إعلاناتي')));
  }

  app.append(h('div', { class: 'page' },
    h('h1', {}, 'انشر عقارك بنفسك'),
    h('div', { class: 'muted' }, 'بدون مكتب عقاري. أكمل البيانات وأضف فيديو قصيراً أو صوراً.'),
    A.user.verified ? null : h('div', { class: 'card' }, h('div', { class: 'muted' }, 'حسابك غير موثّق. وثّق حسابك من صفحة "حسابي" لتظهر لإعلانك شارة "مالك موثّق".')),

    h('h2', {}, '١. نوع العرض'),
    h('div', { class: 'card' }, A.field('العرض', pills('kind', [['rent', 'إيجار'], ['sale', 'بيع']])),
      A.field('نوع العقار', pills('property_type', [['apartment', 'شقة'], ['villa', 'فيلا'], ['floor', 'دور'], ['office', 'مكتب'], ['shop', 'محل']])),
      A.field('عنوان الإعلان', inp('title', { maxlength: 120, placeholder: 'مثال: شقة 3 غرف بمدخل خاص' })),
      A.field('السعر (ر.س' + ')', inp('price', { type: 'number', inputmode: 'numeric', min: 1 })),
      f.kind === 'rent' ? h('div', { class: 'muted' }, 'سعر الإيجار السنوي.') : null),

    h('h2', {}, '٢. الموقع'),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, A.field('المدينة', inp('city', { placeholder: 'الرياض' })), A.field('الحي', inp('district', { placeholder: 'اسم الحي' }))),
      h('div', { class: 'muted' }, 'اضغط على الخريطة لتحديد موقع العقار بدقة:'), mapBox,
      h('button', { class: 'btn sec sm', type: 'button', onclick: () => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => setPoint(p.coords.latitude, p.coords.longitude), () => A.toast('لم نحصل على إذن الموقع')) : A.toast('الموقع غير مدعوم') }, 'استخدم موقعي الحالي')),

    h('h2', {}, '٣. موقع الشقة في المبنى'),
    h('div', { class: 'card' },
      A.field('الدور', pills('floor', [[0, 'أرضي'], [1, 'الأول'], [2, 'الثاني'], [3, 'الثالث'], [4, 'الرابع']])),
      A.field('المدخل', pills('entrance', [['private', 'مدخل خاص'], ['shared', 'مدخل مشترك']])),
      h('div', { class: 'grid2' }, A.field('المساحة (م²)', inp('area', { type: 'number', inputmode: 'numeric' })), A.field('الغرف', inp('beds', { type: 'number', inputmode: 'numeric' }))),
      A.field('دورات المياه', inp('baths', { type: 'number', inputmode: 'numeric' })),
      A.field('وصف مختصر (اختياري)', h('textarea', { rows: 3, maxlength: 2000, oninput: (e) => (f.description = e.target.value) }))),

    h('h2', {}, '٤. ترخيص الإعلان'),
    h('div', { class: 'card' }, h('div', { class: 'muted' }, 'لا يُنشر إعلان عقاري دون رقم ترخيص إعلان ساري من الهيئة العامة للعقار. أدخل رقم الترخيص وتاريخ انتهائه، وسيُوقف إعلانك تلقائياً عند انتهائه مع تنبيه قبلها.'),
      A.field('رقم ترخيص الإعلان', inp('license_no', { maxlength: 40 })),
      A.field('تاريخ انتهاء الترخيص', inp('license_expires', { type: 'date', min: new Date().toISOString().slice(0, 10) }))),

    h('h2', {}, '٥. الفيديو أو الصور'),
    h('div', { class: 'card' }, pills('media_type', [['video', 'فيديو قصير'], ['photos', 'صور فقط']]), hint, fileInput,
      h('button', { class: 'btn sec', type: 'button', onclick: () => fileInput.click() }, 'اختيار الملفات من جوالك'), previews, bar),
    err, submit));
  resetFiles();
};
