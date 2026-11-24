import { useEffect, useState } from 'react';
import { FlatList, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, API_URL, Listing, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFilters } from '../lib/filters';
import { entranceLabel, floorLabel, fmtPrice } from '../lib/format';
import { C, row } from '../lib/theme';
import { Sheet } from './Sheet';
import { Btn, Input, T, toast, s as ui } from './ui';

function VideoMedia({ url, active }: { url: string; active: boolean }) {
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const player = useVideoPlayer(url, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => { if (active && !paused) player.play(); else player.pause(); }, [active, paused, player]);
  useEffect(() => { player.muted = muted; }, [muted, player]);
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)} accessibilityLabel="تشغيل أو إيقاف الفيديو">
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        {paused ? <View style={st.playHint}><Ionicons name="play" size={34} color="#fff" /></View> : null}
      </Pressable>
      <Pressable style={[st.round, st.soundBtn]} onPress={() => setMuted((m) => !m)} accessibilityLabel={muted ? 'تشغيل الصوت' : 'كتم الصوت'}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color="#fff" />
      </Pressable>
    </>
  );
}

function PhotoMedia({ urls, width, height }: { urls: string[]; width: number; height: number }) {
  const [i, setI] = useState(0);
  return (
    <>
      <FlatList horizontal pagingEnabled data={urls} keyExtractor={(u) => u} showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setI(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / width))}
        renderItem={({ item }) => <Image source={{ uri: item }} style={{ width, height }} contentFit="cover" transition={150} />} />
      {urls.length > 1 ? (
        <View style={[st.dots, { flexDirection: 'row' }]} pointerEvents="none">
          {urls.map((u, j) => <View key={u} style={[st.dot, j === i && { backgroundColor: '#fff', width: 16 }]} />)}
        </View>
      ) : null}
    </>
  );
}

export function ListingItem({ l, width, height, active, mountMedia = true, onChange }: {
  l: Listing; width: number; height: number; active: boolean; mountMedia?: boolean; onChange?: (l: Listing) => void;
}) {
  const { user } = useAuth();
  const { setMapFocus } = useFilters();
  const [details, setDetails] = useState(false);
  const [contact, setContact] = useState<{ url: string; message: string } | null>(null);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState('');

  const requireLogin = (msg: string) => { if (user) return true; toast(msg); router.push('/login'); return false; };
  const toggleSave = async () => {
    if (!requireLogin('سجّل الدخول لحفظ العقار')) return;
    try {
      const d = await api<{ saved: boolean }>(`/api/listings/${l.id}/save`, { method: l.saved ? 'DELETE' : 'POST' });
      onChange?.({ ...l, saved: d.saved });
    } catch (e: any) { toast(e.message); }
  };
  const openContact = async () => {
    try { setContact(await api(`/api/listings/${l.id}/contact`, { method: 'POST', body: { channel: 'whatsapp' } })); } catch (e: any) { toast(e.message); }
  };
  const call = async () => {
    try { const d = await api<{ url: string }>(`/api/listings/${l.id}/contact`, { method: 'POST', body: { channel: 'call' } }); Linking.openURL(d.url); } catch (e: any) { toast(e.message); }
  };
  const share = () => Share.share({ message: `${l.title} · ${l.district}\n${API_URL}/#/l/${l.id}` }).catch(() => {});
  const sendReport = async () => {
    try { await api(`/api/listings/${l.id}/report`, { method: 'POST', body: { reason } }); setReport(false); setReason(''); toast('وصل بلاغك، شكراً لك'); } catch (e: any) { toast(e.message); }
  };

  const video = l.media_type === 'video' && l.media[0];
  const meta = [l.area && l.area + ' م²', l.beds && l.beds + ' غرف', floorLabel(l.floor)].filter(Boolean).join(' · ');
  const spec = (k: string, v: unknown) => (v == null || v === '' ? null : (
    <View style={st.spec} key={k}><Text style={ui.muted}>{k}</Text><Text style={[ui.t, { fontWeight: '700' }]}>{String(v)}</Text></View>
  ));

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      {!mountMedia ? null : video ? <VideoMedia url={mediaUrl(video.url)} active={active} />
        : l.media.length ? <PhotoMedia urls={l.media.map((m) => mediaUrl(m.url))} width={width} height={height} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: C.panel2 }]} />}
      <View style={st.shade} pointerEvents="none" />

      <View style={st.side}>
        <Pressable style={st.round} onPress={toggleSave} accessibilityLabel="حفظ العقار">
          <Ionicons name={l.saved ? 'heart' : 'heart-outline'} size={24} color={l.saved ? C.red : '#fff'} />
        </Pressable>
        <Pressable style={st.round} onPress={() => { setMapFocus(l); router.navigate('/map'); }} accessibilityLabel="عرض على الخريطة">
          <Ionicons name="location-outline" size={24} color="#fff" />
        </Pressable>
        <Pressable style={st.round} onPress={share} accessibilityLabel="مشاركة">
          <Ionicons name="share-social-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={st.info} pointerEvents="box-none">
        <View style={[row, { alignItems: 'center', gap: 8 }]}>
          <T style={st.price}>{fmtPrice(l)}</T>
          {l.featured ? <Text style={st.featured}>مميز</Text> : null}
        </View>
        <T style={{ fontSize: 17, fontWeight: '700' }} numberOfLines={2}>{`${l.title} · ${l.district}`}</T>
        {meta ? <T style={{ color: C.mute }}>{meta}</T> : null}
        <View style={[row, { flexWrap: 'wrap', gap: 6 }]}>
          {entranceLabel(l.entrance) ? <Text style={[st.tag, st.tagG]}>{entranceLabel(l.entrance)}</Text> : null}
          <Text style={st.tag}>✓ إعلان مرخص {l.license_no}</Text>
          {l.owner_verified ? <Text style={[st.tag, st.tagG]}>مالك موثّق</Text> : null}
        </View>
        <View style={[row, { gap: 8, marginTop: 4 }]}>
          <Btn title="تواصل عبر واتساب" onPress={openContact} style={{ flex: 1 }} icon={<Ionicons name="logo-whatsapp" size={20} color={C.accInk} />} />
          <Btn title="التفاصيل" kind="sec" onPress={() => setDetails(true)} />
        </View>
      </View>

      <Sheet visible={details} onClose={() => setDetails(false)} title={`${l.title} · ${l.district}`}>
        <View style={[row, { flexWrap: 'wrap', gap: 8 }]}>
          {spec('المساحة', l.area && l.area + ' م²')}{spec('الغرف', l.beds)}{spec('دورات المياه', l.baths)}
          {spec('الدور', floorLabel(l.floor))}{spec('المدخل', entranceLabel(l.entrance))}{spec('المدينة', l.city)}
        </View>
        {l.description ? <T style={{ color: C.mute, lineHeight: 22 }}>{l.description}</T> : null}
        <T style={ui.muted}>{`المعلن: ${l.owner_name || 'مالك'}${l.owner_verified ? ' (موثّق)' : ''}\nترخيص الإعلان: ${l.license_no} · ينتهي ${l.license_expires}\nيُوقف الإعلان تلقائياً عند انتهاء الترخيص.`}</T>
        <View style={[row, { gap: 8 }]}>
          <Btn title="مشاركة" kind="sec" small onPress={share} />
          <Btn title="إبلاغ عن الإعلان" kind="sec" small onPress={() => { setDetails(false); setReport(true); }} />
        </View>
      </Sheet>

      <Sheet visible={!!contact} onClose={() => setContact(null)} title="تواصل مع المعلن">
        <T style={ui.muted}>ستُفتح محادثة واتساب برسالة جاهزة، يمكنك تعديلها قبل الإرسال:</T>
        <View style={[ui.card, { backgroundColor: C.panel2 }]}><T>{contact?.message || ''}</T></View>
        <Btn title="افتح واتساب" onPress={() => { if (contact) Linking.openURL(contact.url).catch(() => toast('تعذّر فتح واتساب')); setContact(null); }} />
        <Btn title="اتصال هاتفي" kind="sec" onPress={() => { setContact(null); call(); }} />
      </Sheet>

      <Sheet visible={report} onClose={() => setReport(false)} title="إبلاغ عن الإعلان">
        <Input multiline maxLength={500} value={reason} onChangeText={setReason} placeholder="مثال: العقار مباع، السعر غير صحيح، الإعلان مضلل" />
        <Btn title="إرسال البلاغ" onPress={sendReport} />
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  // تدرّج داكن أسفل الشاشة لقراءة النص فوق الفيديو
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.85))' },
  side: { position: 'absolute', left: 12, bottom: 220, gap: 14 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0E1411B3', alignItems: 'center', justifyContent: 'center' },
  soundBtn: { position: 'absolute', left: 12, top: 110 },
  playHint: { position: 'absolute', alignSelf: 'center', top: '42%', width: 70, height: 70, borderRadius: 35, backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center' },
  info: { position: 'absolute', right: 16, left: 72, bottom: 18, gap: 6 },
  price: { color: C.gold, fontSize: 26, fontWeight: '800' },
  featured: { backgroundColor: C.gold, color: '#2a1d00', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  tag: { color: C.ink, backgroundColor: '#ffffff1f', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, fontSize: 12, overflow: 'hidden' },
  tagG: { backgroundColor: '#1FB58F40', color: C.accSoft },
  dots: { position: 'absolute', top: 70, alignSelf: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff70' },
  spec: { backgroundColor: C.panel2, borderRadius: 12, padding: 10, minWidth: '30%', gap: 2 },
});
