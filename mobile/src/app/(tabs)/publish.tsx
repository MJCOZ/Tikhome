import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Listing, PickedFile, uploadMedia } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toLatin } from '../../lib/format';
import { pickMedia } from '../../lib/pick';
import { C, row } from '../../lib/theme';
import { DateField } from '../../components/DateField';
import { Btn, Card, Empty, Field, Input, Pills, T, toast, s } from '../../components/ui';

type Form = {
  kind: 'rent' | 'sale'; property_type: string; title: string; price: string; city: string; district: string;
  floor: number | ''; entrance: 'private' | 'shared' | ''; area: string; beds: string; baths: string; description: string;
  license_no: string; license_expires: string; media_type: 'video' | 'photos'; lat: number | null; lng: number | null;
};
const EMPTY: Form = { kind: 'rent', property_type: 'apartment', title: '', price: '', city: '', district: '', floor: 1, entrance: 'private', area: '', beds: '', baths: '', description: '', license_no: '', license_expires: '', media_type: 'video', lat: null, lng: null };

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return <VideoView player={player} style={{ width: '100%', height: 220, borderRadius: 12, backgroundColor: '#000' }} contentFit="contain" nativeControls />;
}

export default function Publish() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [f, setF] = useState<Form>(EMPTY);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [config, setConfig] = useState({ max_video_mb: 50, max_photos: 12, max_photo_mb: 8 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((o) => ({ ...o, [k]: v }));

  useEffect(() => { api('/api/config').then(setConfig).catch(() => {}); }, []);

  if (!user) {
    return <Empty title="انشر عقارك بنفسك" text="بدون مكتب عقاري. سجّل دخولك أولاً."><Btn title="تسجيل الدخول" onPress={() => router.push('/login')} /></Empty>;
  }
  if (done) {
    return (
      <Empty title={done === 'published' ? 'تم نشر إعلانك' : 'استلمنا إعلانك'} text={done === 'published' ? 'أصبح ظاهراً للباحثين الآن.' : 'سيُراجَع قبل النشر وسيصلك إشعار بالنتيجة.'}>
        <Btn title="إعلاناتي" onPress={() => { setDone(null); router.navigate('/me'); }} />
        <Btn title="نشر إعلان آخر" kind="sec" onPress={() => setDone(null)} />
      </Empty>
    );
  }

  const choose = async (camera = false) => {
    const r = await pickMedia(f.media_type, { camera, limit: config.max_photos - (f.media_type === 'photos' ? files.length : 0), maxVideoMb: config.max_video_mb, maxPhotoMb: config.max_photo_mb });
    if (r.error) toast(r.error);
    if (!r.files.length) return;
    setFiles((old) => (f.media_type === 'video' ? r.files.slice(0, 1) : [...old, ...r.files].slice(0, config.max_photos)));
  };
  const setPoint = (lat: number, lng: number) => {
    setF((o) => ({ ...o, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }));
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };
  const myLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return toast('لم نحصل على إذن الموقع');
    const p = await Location.getCurrentPositionAsync({});
    setPoint(p.coords.latitude, p.coords.longitude);
  };

  const submit = async () => {
    setErr('');
    if (!files.length) return setErr(f.media_type === 'video' ? 'اختر فيديو للعقار' : 'اختر صورة واحدة على الأقل');
    setBusy('جارٍ حفظ الإعلان...');
    let id: number | null = null;
    try {
      const body = { ...f, price: toLatin(f.price), area: toLatin(f.area), beds: toLatin(f.beds), baths: toLatin(f.baths), floor: f.floor === '' ? null : f.floor, entrance: f.entrance || null };
      const c = await api<{ listing: Listing }>('/api/listings', { method: 'POST', body });
      id = c.listing.id;
      await uploadMedia(id, files, (i, n) => setBusy(n > 1 ? `جارٍ رفع الملفات ${Math.min(i + 1, n)} من ${n}...` : 'جارٍ رفع الملف...'));
      setBusy('جارٍ الإرسال...');
      const r = await api<{ status: string }>(`/api/listings/${id}/submit`, { method: 'POST' });
      setF(EMPTY); setFiles([]); setDone(r.status);
    } catch (e: any) {
      setErr(e.message);
      if (id) toast('حُفظ إعلانك كمسودة في "حسابي"، ويمكنك إكماله من هناك');
    }
    setBusy('');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <T style={s.h1}>انشر عقارك بنفسك</T>
      <T style={s.muted}>بدون مكتب عقاري. أكمل البيانات وأضف فيديو قصيراً أو صوراً.</T>
      {!user.verified ? <Card><T style={s.muted}>حسابك غير موثّق. وثّق حسابك من صفحة "حسابي" لتظهر لإعلانك شارة "مالك موثّق".</T></Card> : null}

      <T style={s.h2}>١. نوع العرض</T>
      <Card>
        <Field label="العرض"><Pills value={f.kind} options={[['rent', 'إيجار'], ['sale', 'بيع']]} onChange={(v) => v && set('kind')(v)} /></Field>
        <Field label="نوع العقار"><Pills value={f.property_type} options={[['apartment', 'شقة'], ['villa', 'فيلا'], ['floor', 'دور'], ['office', 'مكتب'], ['shop', 'محل'], ['land', 'أرض']]} onChange={(v) => v && set('property_type')(v)} /></Field>
        <Field label="عنوان الإعلان"><Input maxLength={120} placeholder="مثال: شقة 3 غرف بمدخل خاص" value={f.title} onChangeText={set('title')} /></Field>
        <Field label={f.kind === 'rent' ? 'السعر (ر.س) — الإيجار السنوي' : 'السعر (ر.س)'}><Input keyboardType="number-pad" value={f.price} onChangeText={set('price')} /></Field>
      </Card>

      <T style={s.h2}>٢. الموقع</T>
      <Card>
        <View style={[row, { gap: 10 }]}>
          <View style={{ flex: 1 }}><Field label="المدينة"><Input placeholder="الرياض" value={f.city} onChangeText={set('city')} /></Field></View>
          <View style={{ flex: 1 }}><Field label="الحي"><Input placeholder="اسم الحي" value={f.district} onChangeText={set('district')} /></Field></View>
        </View>
        <T style={s.muted}>اضغط على الخريطة لتحديد موقع العقار بدقة:</T>
        <View style={st.minimap}>
          <MapView ref={mapRef} style={StyleSheet.absoluteFill} userInterfaceStyle="dark"
            initialRegion={{ latitude: 24.7136, longitude: 46.6753, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
            onPress={(e) => setPoint(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}>
            {f.lat != null && f.lng != null ? <Marker coordinate={{ latitude: f.lat, longitude: f.lng }} /> : null}
          </MapView>
        </View>
        <Btn small kind="sec" title="استخدم موقعي الحالي" onPress={myLocation} />
      </Card>

      <T style={s.h2}>٣. موقع الشقة في المبنى</T>
      <Card>
        <Field label="الدور"><Pills value={f.floor} options={[[0, 'أرضي'], [1, 'الأول'], [2, 'الثاني'], [3, 'الثالث'], [4, 'الرابع']]} onChange={(v) => set('floor')(v === '' ? '' : Number(v))} allowClear /></Field>
        <Field label="المدخل"><Pills value={f.entrance} options={[['private', 'مدخل خاص'], ['shared', 'مدخل مشترك']]} onChange={(v) => set('entrance')(v as Form['entrance'])} allowClear /></Field>
        <View style={[row, { gap: 10 }]}>
          <View style={{ flex: 1 }}><Field label="المساحة (م²)"><Input keyboardType="number-pad" value={f.area} onChangeText={set('area')} /></Field></View>
          <View style={{ flex: 1 }}><Field label="الغرف"><Input keyboardType="number-pad" value={f.beds} onChangeText={set('beds')} /></Field></View>
          <View style={{ flex: 1 }}><Field label="دورات المياه"><Input keyboardType="number-pad" value={f.baths} onChangeText={set('baths')} /></Field></View>
        </View>
        <Field label="وصف مختصر (اختياري)"><Input multiline maxLength={2000} value={f.description} onChangeText={set('description')} /></Field>
      </Card>

      <T style={s.h2}>٤. ترخيص الإعلان</T>
      <Card>
        <T style={s.muted}>لا يُنشر إعلان عقاري دون رقم ترخيص إعلان ساري من الهيئة العامة للعقار. سيُوقف إعلانك تلقائياً عند انتهاء الترخيص مع تنبيه قبلها.</T>
        <Field label="رقم ترخيص الإعلان"><Input maxLength={40} keyboardType="number-pad" value={f.license_no} onChangeText={set('license_no')} /></Field>
        <Field label="تاريخ انتهاء الترخيص"><DateField value={f.license_expires} onChange={set('license_expires')} /></Field>
      </Card>

      <T style={s.h2}>٥. الفيديو أو الصور</T>
      <Card>
        <Pills value={f.media_type} options={[['video', 'فيديو قصير'], ['photos', 'صور فقط']]} onChange={(v) => { if (v && v !== f.media_type) { set('media_type')(v); setFiles([]); } }} />
        <T style={s.muted}>{f.media_type === 'video' ? `فيديو واحد قصير (حتى ${config.max_video_mb} ميغابايت): المدخل، الصالة، الغرف، الإطلالة` : `صور العقار (حتى ${config.max_photos} صورة)`}</T>
        <View style={[row, { gap: 8 }]}>
          <Btn kind="sec" small style={{ flex: 1 }} title="من المعرض" onPress={() => choose(false)} />
          <Btn kind="sec" small style={{ flex: 1 }} title={f.media_type === 'video' ? 'صوّر فيديو' : 'التقط صورة'} onPress={() => choose(true)} />
        </View>
        {f.media_type === 'video' && files[0] ? <VideoPreview uri={files[0].uri} /> : null}
        {f.media_type === 'photos' && files.length ? (
          <View style={[row, { flexWrap: 'wrap', gap: 8 }]}>
            {files.map((x, i) => (
              <View key={x.uri + i}>
                <Image source={{ uri: x.uri }} style={{ width: 92, height: 120, borderRadius: 10 }} contentFit="cover" />
                <Pressable onPress={() => setFiles((a) => a.filter((_, j) => j !== i))} style={st.remove} accessibilityLabel="حذف الصورة"><Text style={{ color: '#fff', fontWeight: '800' }}>×</Text></Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {err ? <T style={{ color: '#ffb4ae' }}>{err}</T> : null}
      {busy ? <T style={{ color: C.accSoft }}>{busy}</T> : null}
      <Btn title="أرسل الإعلان" onPress={submit} loading={!!busy} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  minimap: { height: 200, borderRadius: 12, overflow: 'hidden', backgroundColor: C.panel2 },
  remove: { position: 'absolute', top: 4, left: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: '#000a', alignItems: 'center', justifyContent: 'center' },
});
