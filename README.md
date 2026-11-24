# Tikhome | تيك هوم

منصة عقارية بالفيديو القصير والصور: خلاصة بنمط TikTok، وخريطة تبيّن الدور والمدخل، وتواصل عبر واتساب، ولوحة تحكم للمدير.

## المكونات

| المجلد | الوصف |
|---|---|
| `mobile/` | تطبيق الجوال (Expo SDK 58 + React Native + Expo Router) |
| `public/` | تطبيق الويب ولوحة التحكم `/admin` |
| `api/index.js` | نقطة تشغيل الواجهة على Vercel |
| `src/` | منطق الخادم (`app.js`) وقاعدة البيانات (`db.js`, `schema.sql`) والتخزين (`storage.js`) |
| `server.js` | خادم التطوير المحلي فقط |

الخدمات: **Supabase** (قاعدة البيانات PostgreSQL + تخزين الفيديو والصور) و**Vercel** (استضافة الويب والـ API) و**GitHub** (الكود والنشر التلقائي) و**Expo Go** (تجربة التطبيق على الجوال).

## خطوات التشغيل

### 1) Supabase
1. افتح مشروع Supabase الخاص بـ Tikhome.
2. من **Project Settings → Database → Connection string** انسخ رابط **Transaction pooler** (المنفذ 6543) واستبدل كلمة السر فيه.
3. من **Project Settings → API Keys** انسخ **Project URL** و**Secret key** (أو `service_role`).

لا تحتاج تنشئ جداول أو حاوية تخزين: الخادم ينشئ الجداول عند أول طلب، وينشئ حاوية `media` العامة عند أول رفع.

### 2) Vercel
1. **Add New → Project** واختر مستودع `MJCOZ/Tikhome`. اترك Root Directory على جذر المستودع.
2. في **Environment Variables** أضف القيم الموجودة في `.env.example`:
   - `DATABASE_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `ADMIN_PHONE`
   - `ADMIN_PASSWORD`
   - `CRON_SECRET`
3. اضغط **Deploy**. بعد النشر افتح `https://<مشروعك>.vercel.app/api/health`، والمفروض يرجع `{"ok":true,"storage":"supabase"}`.
4. ادخل لوحة التحكم من `/admin` برقم `ADMIN_PHONE` وكلمة `ADMIN_PASSWORD`.

### 3) الدفع عبر Moyasar (ميسّر)
1. سجّل في moyasar.com، ثم من **Settings → API Keys** انسخ **Secret Key** التجريبي (`sk_test_...`).
2. أضفه في Vercel باسم `MOYASAR_SECRET_KEY`، وأضف `MOYASAR_WEBHOOK_SECRET` بنص عشوائي طويل، ثم أعد النشر (Redeploy).
3. في لوحة ميسّر أضف **Webhook**:
   - الرابط: `https://<مشروعك>.vercel.app/api/billing/webhook`
   - الحدث: `payment_paid`
   - Secret Token: نفس قيمة `MOYASAR_WEBHOOK_SECRET`
4. من لوحة التحكم ← **الباقات** حدّد سعر الباقة ومدتها. أي باقة سعرها أكبر من صفر يظهر لها زر «اشترك الآن».
5. للتجربة استخدم بطاقات ميسّر الاختبارية من توثيقهم. لا يُخصم مبلغ حقيقي في وضع الاختبار.

كيف يعمل: الخادم ينشئ فاتورة لدى ميسّر ← المستخدم يدفع في صفحة ميسّر (مدى، Apple Pay، بطاقة) ← عند العودة أو وصول الإشعار يسأل الخادمُ ميسّرَ مباشرة عن حالة الفاتورة ويطابق المبلغ ← تُفعَّل الباقة مرة واحدة فقط. التجديد قبل الانتهاء يُضاف لنهاية الاشتراك الحالي، والمهمة اليومية تتحقق من أي دفعة لم يرجع صاحبها من صفحة الدفع.

### 4) التجربة على الجوال (Expo Go)
1. ثبّت تطبيق **Expo Go** من App Store أو Google Play.
2. على جهاز الكمبيوتر (Node.js 20 أو أحدث):

   ```bash
   cd mobile
   cp .env.example .env        # ضع رابط Vercel في EXPO_PUBLIC_API_URL
   npm install
   npx expo start --tunnel
   ```
3. امسح رمز QR: بكاميرا الآيفون، أو من داخل Expo Go على أندرويد.

## التطوير المحلي

```bash
npm install
DATABASE_URL=postgresql://postgres@localhost:5432/tikhome ADMIN_PASSWORD='StrongPass#1' npm start
```

بدون `SUPABASE_URL` تُحفظ الملفات محلياً في `data/uploads`. الاختبارات (41 فحصاً على Postgres حقيقي):

```bash
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm test
```

## كيف يعمل رفع الفيديو
دوال Vercel لا تقبل طلبات أكبر من 4.5 ميغابايت، لذلك يتم الرفع على ثلاث خطوات:
1. التطبيق يطلب رابط رفع موقّعاً: `POST /api/listings/:id/uploads`
2. يرفع الملف مباشرة إلى Supabase Storage.
3. يؤكد الملف: `POST /api/listings/:id/media`. الخادم يتحقق من الحجم ومن نوع الملف الحقيقي (من أول بايتات الملف)، ويحذف الملف إن لم يطابق.

الحد الأقصى للفيديو 50 ميغابايت، وهو حد الملف في خطة Supabase المجانية. تقدر تغيّره من لوحة التحكم إذا رقّيت الخطة.

## حالات الإعلان

| الحالة | المعنى |
|---|---|
| `draft` | مسودة |
| `pending` | قيد المراجعة |
| `published` | منشور |
| `rejected` | مرفوض |
| `paused` | أوقفه المالك، ويقدر يستأنفه |
| `suspended` | أوقفته الإدارة، ولا يرفعه إلا المدير |
| `expired` | انتهى الترخيص |

## حدود معروفة
- لا يوجد تكامل مع نفاذ: التوثيق يطلبه المستخدم ويعتمده المدير يدوياً.
- الأسعار لا تشمل حساب ضريبة القيمة المضافة ولا إصدار فاتورة ضريبية إلكترونية (فاتورة/زاتكا).
- استرجاع كلمة السر يتم برمز يصدره المدير؛ لا يوجد بعد تحقق من رقم الجوال برسالة SMS.
- ضغط الفيديو (720p) يعمل على iOS فقط؛ على أندرويد يُرفع الفيديو كما هو حتى نبني نسخة تطوير (Development Build).
- نظامياً: كل إعلان يحتاج رقم ترخيص إعلان من الهيئة العامة للعقار، والمنصة نفسها تحتاج ترخيصاً. استشر مستشاراً قانونياً قبل الإطلاق.
