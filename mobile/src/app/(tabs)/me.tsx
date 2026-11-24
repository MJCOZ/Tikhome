import { useCallback, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { Alert, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, API_URL, Listing, mediaUrl, uploadMedia } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtPrice, statusColor, statusLabel } from '../../lib/format';
import { pickMedia } from '../../lib/pick';
import { C, row } from '../../lib/theme';
import { DateField } from '../../components/DateField';
import { Sheet } from '../../components/Sheet';
import { Btn, Card, Empty, Field, Input, T, toast, s } from '../../components/ui';

type Note = { id: number; text: string; listing_id: number | null };
type PlanRow = { id: number; name: string; price_sar: number; max_listings: number; duration_days: number; featured_days: number };

// الباقات المدفوعة: صفحة دفع ميسّر داخل متصفح التطبيق ثم التحقق من الخادم
function Plans({ onPaid }: { onPaid: () => void }) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sub, setSub] = useState<{ name: string; ends_at: string; plan_id: number } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const [p, s, c] = await Promise.all([api<{ plans: PlanRow[] }>('/api/plans'), api<{ subscription: any }>('/api/billing/subscription'), api<{ payments: boolean }>('/api/config')]);
      setPlans(p.plans.filter((x) => x.price_sar > 0)); setSub(s.subscription); setEnabled(!!c.payments);
    } catch { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const buy = async (plan: PlanRow) => {
    setBusy(plan.id);
    try {
      const returnTo = ExpoLinking.createURL('billing');
      const d = await api<{ ref: string; url: string }>('/api/billing/checkout', { method: 'POST', body: { plan_id: plan.id, return_to: returnTo } });
      await WebBrowser.openAuthSessionAsync(d.url, returnTo);
      // سواء عاد المستخدم تلقائياً أو أغلق الصفحة: نسأل الخادم عن الحالة الفعلية
      const r = await api<{ payment: { status: string } }>('/api/billing/payments/' + d.ref);
      if (r.payment.status === 'paid') { toast(`تم الدفع وتفعيل باقة ${plan.name}`); onPaid(); load(); }
      else if (r.payment.status === 'initiated') toast('لم يكتمل الدفع. إن خُصم المبلغ ستُفعّل الباقة خلال دقائق.');
      else toast('لم يتم الدفع');
    } catch (e: any) { toast(e.message); }
    setBusy(null);
  };

  if (!plans.length) return null;
  return (
    <>
      <T style={s.h2}>الباقات</T>
      {sub ? <T style={s.muted}>{`باقتك الحالية: ${sub.name} حتى ${sub.ends_at}`}</T> : null}
      {plans.map((p) => (
        <Card key={p.id}>
          <View style={[row, { justifyContent: 'space-between', alignItems: 'center' }]}>
            <T style={{ fontWeight: '700', fontSize: 16 }}>{p.name}</T>
            <T style={{ color: C.gold, fontWeight: '800', fontSize: 18 }}>{`${p.price_sar} ر.س`}</T>
          </View>
          <T style={s.muted}>{`حتى ${p.max_listings} إعلان · ${p.duration_days || 30} يوماً${p.featured_days ? ` · تمييز ${p.featured_days} أيام` : ''}`}</T>
          {enabled ? <Btn small title={sub && sub.plan_id === p.id ? 'تجديد' : 'اشترك الآن'} loading={busy === p.id} onPress={() => buy(p)} />
            : <T style={s.muted}>الدفع الإلكتروني غير مفعّل بعد. تواصل مع الإدارة للاشتراك.</T>}
        </Card>
      ))}
    </>
  );
}

function MyCard({ l, reload }: { l: Listing; reload: () => void }) {
  const [renew, setRenew] = useState(false);
  const [no, setNo] = useState(l.license_no);
  const [exp, setExp] = useState(l.license_expires);
  const [busy, setBusy] = useState('');
  const act = async (path: string, method = 'POST', body?: unknown) => {
    try { await api(path, { method, body }); reload(); } catch (e: any) { toast(e.message); }
  };
  const addMedia = async () => {
    const r = await pickMedia(l.media_type, { limit: 12 - l.media.length });
    if (r.error) toast(r.error);
    if (!r.files.length) return;
    try { setBusy('جارٍ الرفع...'); await uploadMedia(l.id, r.files); reload(); } catch (e: any) { toast(e.message); }
    setBusy('');
  };
  const thumb = l.media_type === 'photos' ? l.media[0]?.url : l.media[0]?.poster;
  const canSubmit = ['draft', 'rejected', 'paused'].includes(l.status) && l.media.length > 0;
  return (
    <Card>
      <View style={[row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
        <T style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{`${l.title} · ${l.district}`}</T>
        <T style={{ color: statusColor(l.status), fontWeight: '700', fontSize: 12 }}>{statusLabel(l.status)}</T>
      </View>
      <View style={[row, { gap: 10 }]}>
        {thumb ? <Image source={{ uri: mediaUrl(thumb) }} style={{ width: 64, height: 84, borderRadius: 10 }} contentFit="cover" /> : null}
        <T style={[s.muted, { flex: 1, lineHeight: 20 }]}>{`${fmtPrice(l)}\nالمشاهدات: ${l.views ?? 0} · طلبات التواصل: ${l.contacts ?? 0}\nينتهي الترخيص: ${l.license_expires}`}</T>
      </View>
      {l.status === 'rejected' && l.reject_reason ? <T style={{ color: '#ffb4ae' }}>{'سبب الرفض: ' + l.reject_reason}</T> : null}
      {l.status === 'suspended' ? <T style={{ color: '#ffb4ae' }}>أوقفت الإدارة هذا الإعلان. تواصل مع الدعم لمعرفة السبب.</T> : null}
      {busy ? <T style={{ color: C.accSoft }}>{busy}</T> : null}
      <View style={[row, { flexWrap: 'wrap', gap: 8 }]}>
        {canSubmit ? <Btn small title={l.status === 'paused' ? 'استئناف' : 'إرسال للمراجعة'} onPress={() => act(`/api/listings/${l.id}/${l.status === 'paused' ? 'resume' : 'submit'}`)} /> : null}
        {l.status !== 'suspended' && (l.media_type === 'photos' ? l.media.length < 12 : l.media.length === 0)
          ? <Btn small kind="sec" title={l.media_type === 'video' ? 'أضف الفيديو' : 'أضف صوراً'} onPress={addMedia} /> : null}
        {l.status === 'published' ? <Btn small kind="sec" title="إيقاف مؤقت" onPress={() => act(`/api/listings/${l.id}/pause`)} /> : null}
        {l.status === 'published' ? <Btn small kind="ghost" title="عرض" onPress={() => router.push(`/listing/${l.id}`)} /> : null}
        {l.status !== 'suspended' ? <Btn small kind="sec" title="تجديد الترخيص" onPress={() => setRenew(true)} /> : null}
        <Btn small kind="danger" title="حذف" onPress={() => Alert.alert('حذف الإعلان', 'حذف الإعلان نهائياً؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress: () => act('/api/listings/' + l.id, 'DELETE') }])} />
      </View>
      <Sheet visible={renew} onClose={() => setRenew(false)} title="تجديد الترخيص">
        <Field label="رقم الترخيص"><Input value={no} onChangeText={setNo} maxLength={40} keyboardType="number-pad" /></Field>
        <Field label="تاريخ الانتهاء الجديد"><DateField value={exp} onChange={setExp} /></Field>
        <Btn title="حفظ" onPress={async () => {
          try { await api('/api/listings/' + l.id, { method: 'PUT', body: { license_no: no, license_expires: exp } }); setRenew(false); toast('تم التحديث'); reload(); } catch (e: any) { toast(e.message); }
        }} />
      </Sheet>
    </Card>
  );
}

export default function Me() {
  const insets = useSafeAreaInsets();
  const { user, plan, refresh, logout } = useAuth();
  const [mine, setMine] = useState<Listing[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pwd, setPwd] = useState(false);
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [a, b] = await Promise.all([api<{ listings: Listing[] }>('/api/my/listings'), api<{ notifications: Note[] }>('/api/notifications')]);
      setMine(a.listings); setNotes(b.notifications);
      await refresh();
    } catch (e: any) { toast(e.message); }
    setRefreshing(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!user) return <Empty title="حسابي" text="سجّل الدخول لنشر عقارك ومتابعة إعلاناتك."><Btn title="تسجيل الدخول" onPress={() => router.push('/login')} /></Empty>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.acc} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <T style={s.h1}>{user.name}</T>
      <T style={s.muted}>{`${user.phone} · ${user.verified ? 'مالك موثّق' : 'غير موثّق'} · الباقة: ${plan ? plan.name : '-'}`}</T>
      <View style={[row, { flexWrap: 'wrap', gap: 8 }]}>
        {user.role === 'admin' ? <Btn small title="لوحة التحكم" onPress={() => Linking.openURL(API_URL + '/admin')} /> : null}
        {!user.verified && !user.verify_requested ? <Btn small kind="sec" title="اطلب توثيق حسابي" onPress={async () => { try { await api('/api/me/verify-request', { method: 'POST' }); toast('وصل طلب التوثيق'); load(); } catch (e: any) { toast(e.message); } }} /> : null}
        {user.verify_requested && !user.verified ? <T style={{ color: C.gold }}>طلب التوثيق قيد المراجعة</T> : null}
        <Btn small kind="ghost" title="تغيير كلمة السر" onPress={() => setPwd(true)} />
        <Btn small kind="danger" title="خروج" onPress={logout} />
      </View>

      <Plans onPaid={load} />

      <T style={s.h2}>الإشعارات</T>
      {notes.length ? <Card>{notes.slice(0, 8).map((n) => <T key={n.id} style={s.muted}>{'• ' + n.text}</T>)}</Card> : <T style={s.muted}>لا توجد إشعارات.</T>}

      <T style={s.h2}>إعلاناتي</T>
      {mine.length ? mine.map((l) => <MyCard key={l.id} l={l} reload={load} />)
        : <Card><T style={s.muted}>لم تنشر إعلاناً بعد.</T><Btn title="انشر أول إعلان" onPress={() => router.navigate('/publish')} /></Card>}

      <Sheet visible={pwd} onClose={() => setPwd(false)} title="تغيير كلمة السر">
        <Field label="الحالية"><Input secureTextEntry value={oldP} onChangeText={setOldP} /></Field>
        <Field label="الجديدة (8 أحرف على الأقل)"><Input secureTextEntry value={newP} onChangeText={setNewP} /></Field>
        <Btn title="حفظ" onPress={async () => {
          try { await api('/api/me/password', { method: 'POST', body: { old_password: oldP, new_password: newP } }); toast('تم التغيير'); setPwd(false); setOldP(''); setNewP(''); } catch (e: any) { toast(e.message); }
        }} />
      </Sheet>
    </ScrollView>
  );
}
